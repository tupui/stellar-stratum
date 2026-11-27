import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Play, Hammer } from 'lucide-react';
import { Spinner } from '@/components/brand/Mark';
import { Dock } from '@/components/brand/Shell';
import { ContractValueInput } from './ContractValueInput';
import {
  classifyParams,
  defaultFormValue,
  describeType,
  formatResult,
  type FormValues,
  type ParamShape,
} from '@/lib/contract/form-values';
import { buildInvocationXdr, describeInvocation, simulateInvocation } from '@/lib/contract/invoke';
import { errorMessage, type LoadedContract } from '@/lib/contract/spec';
import type { AnalyzedCall } from '@/lib/protocols/detect';
import { InvocationAuthorization } from '@/components/transaction/AuthorizationTree';

interface ContractFunctionFormProps {
  loaded: LoadedContract;
  functionName: string;
  /** The Function select: it heads the left column on desktop, above the function's doc. */
  picker?: ReactNode;
  publicKey: string;
  onBuild: (xdr: string) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
  /** Called on any edit, so a transaction built from the previous values is not signed. */
  onClearTransaction?: () => void;
}

interface ParsedFunction {
  params: ParamShape[];
  returnLabel: string;
  doc: string;
}

const parseFunction = (loaded: LoadedContract, name: string): ParsedFunction => {
  const fn = loaded.spec.getFunc(name);
  const params = classifyParams(fn, loaded.spec);
  const outputs = fn.outputs;
  const returnLabel = outputs.length === 0 ? 'void' : outputs.map(describeType).join(', ');
  return { params, returnLabel, doc: fn.doc.toString() };
};

export const ContractFunctionForm = ({
  loaded,
  functionName,
  picker,
  publicKey,
  onBuild,
  isBuilding,
  isTransactionBuilt,
  onClearTransaction,
}: ContractFunctionFormProps) => {
  const parsed = useMemo(() => parseFunction(loaded, functionName), [loaded, functionName]);

  // The form is keyed by contract and function, so state starts fresh for each.
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(parsed.params.map((p) => [p.name, defaultFormValue(p)])),
  );
  const [error, setError] = useState('');
  const [simResult, setSimResult] = useState<string | null>(null);
  // What the simulated call's authorization lets it do: shown before anyone signs.
  const [authCall, setAuthCall] = useState<AnalyzedCall | null>(null);
  const [busy, setBusy] = useState<'sim' | 'build' | null>(null);
  // Bumped on every edit and on unmount, so a simulation or build that finishes afterwards is dropped.
  const edits = useRef(0);
  useEffect(() => () => { edits.current += 1; }, []);

  const setField = (name: string, next: unknown) => {
    setValues((prev) => ({ ...prev, [name]: next }));
    setSimResult(null);
    setAuthCall(null);
    edits.current += 1;
    onClearTransaction?.();
  };

  const invocation = { loaded, functionName, params: parsed.params, values, publicKey };

  const handleSimulate = async () => {
    setError('');
    setSimResult(null);
    setAuthCall(null);
    setBusy('sim');
    try {
      const at = edits.current;
      const tx = await simulateInvocation(invocation);
      if (edits.current === at) {
        setSimResult(formatResult(tx.result));
        setAuthCall(describeInvocation(tx.toXdr(), loaded.network));
      }
    } catch (e) {
      setError(errorMessage(e, 'Simulation failed'));
    } finally {
      setBusy(null);
    }
  };

  const handleBuild = async () => {
    setError('');
    setAuthCall(null);
    setBusy('build');
    try {
      const at = edits.current;
      const xdr = await buildInvocationXdr(invocation);
      if (edits.current === at) {
        setAuthCall(describeInvocation(xdr, loaded.network));
        onBuild(xdr);
      }
    } catch (e) {
      setError(errorMessage(e, 'Build failed'));
    } finally {
      setBusy(null);
    }
  };

  const disabled = isBuilding || isTransactionBuilt || busy !== null;

  return (
    // Desktop: the function and its doc at left, its arguments and the actions at right
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-8 lg:border-t lg:border-line lg:pt-4">
      <div className="flex min-w-0 flex-col gap-4">
        {picker}
        {/* The contract's own doc text, as source: its line breaks kept */}
        {parsed.doc && (
          <div className="well whitespace-pre-wrap font-mono text-[13px] leading-[1.55] text-muted-foreground [overflow-wrap:anywhere]">
            {parsed.doc}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {parsed.params.length === 0 && (
          <p className="text-[13px] text-muted-foreground">This function takes no arguments.</p>
        )}

        {parsed.params.map((param) => (
          <div key={param.name} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[13px] font-medium text-foreground">{param.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{param.typeLabel}</span>
            </div>
            <ContractValueInput
              shape={param}
              value={values[param.name]}
              onChange={(v) => setField(param.name, v)}
            />
          </div>
        ))}

        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted-foreground">Returns</span>
          <span className="font-mono text-xs text-muted-foreground">{parsed.returnLabel}</span>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription className="text-sm break-all whitespace-pre-wrap">{error}</AlertDescription>
          </Alert>
        )}

        {simResult !== null && (
          <div className="well">
            <p className="mb-1 text-[13px] text-muted-foreground">Simulation result</p>
            <pre className="whitespace-pre-wrap break-all font-mono text-xs">{simResult}</pre>
          </div>
        )}

        {authCall && <InvocationAuthorization call={authCall} network={loaded.network} />}

        {/* Simulate, then the primary: in the dock on the phone, the column's width on desktop */}
        <Dock className="sm:[&>*]:flex-1">
          <Button variant="outline" onClick={handleSimulate} disabled={disabled}>
            {busy === 'sim' ? <Spinner /> : <Play />}
            Simulate
          </Button>
          <Button onClick={handleBuild} disabled={disabled}>
            {busy === 'build' ? <Spinner /> : <Hammer />}
            Build
          </Button>
        </Dock>
      </div>
    </div>
  );
};
