import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Play, Hammer, Loader2 } from 'lucide-react';
import { ContractValueInput } from './ContractValueInput';
import {
  classifyParam,
  defaultFormValue,
  describeType,
  formatResult,
  type FormValues,
  type ParamShape,
} from '@/lib/contract/form-values';
import { buildInvocationXdr, simulateInvocation } from '@/lib/contract/invoke';
import { errorMessage, type LoadedContract } from '@/lib/contract/spec';

interface ContractFunctionFormProps {
  loaded: LoadedContract;
  functionName: string;
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
  const params = fn.inputs.map((input) => classifyParam(input.name.toString(), input.type, loaded.spec));
  const outputs = fn.outputs;
  const returnLabel = outputs.length === 0 ? 'void' : outputs.map(describeType).join(', ');
  return { params, returnLabel, doc: fn.doc.toString() };
};

export const ContractFunctionForm = ({
  loaded,
  functionName,
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
  const [busy, setBusy] = useState<'sim' | 'build' | null>(null);
  // Bumped on every edit and on unmount, so a simulation or build that finishes afterwards is dropped.
  const edits = useRef(0);
  useEffect(() => () => { edits.current += 1; }, []);

  const setField = (name: string, next: unknown) => {
    setValues((prev) => ({ ...prev, [name]: next }));
    setSimResult(null);
    edits.current += 1;
    onClearTransaction?.();
  };

  const invocation = { loaded, functionName, params: parsed.params, values, publicKey };

  const handleSimulate = async () => {
    setError('');
    setSimResult(null);
    setBusy('sim');
    try {
      const at = edits.current;
      const tx = await simulateInvocation(invocation);
      if (edits.current === at) setSimResult(formatResult(tx.result));
    } catch (e) {
      setError(errorMessage(e, 'Simulation failed'));
    } finally {
      setBusy(null);
    }
  };

  const handleBuild = async () => {
    setError('');
    setBusy('build');
    try {
      const at = edits.current;
      const xdr = await buildInvocationXdr(invocation);
      if (edits.current === at) onBuild(xdr);
    } catch (e) {
      setError(errorMessage(e, 'Build failed'));
    } finally {
      setBusy(null);
    }
  };

  const disabled = isBuilding || isTransactionBuilt || busy !== null;

  return (
    <div className="space-y-4">
      {parsed.doc && (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{parsed.doc}</p>
      )}

      {parsed.params.length === 0 && (
        <p className="text-sm text-muted-foreground italic">This function takes no arguments.</p>
      )}

      <div className="space-y-3">
        {parsed.params.map((param) => (
          <div key={param.name} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label className="font-mono text-sm">{param.name}</Label>
              <span className="text-xs text-muted-foreground font-mono">{param.typeLabel}</span>
            </div>
            <ContractValueInput
              shape={param}
              value={values[param.name]}
              onChange={(v) => setField(param.name, v)}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Returns</span>
        <span className="font-mono">{parsed.returnLabel}</span>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="text-sm break-all whitespace-pre-wrap">{error}</AlertDescription>
        </Alert>
      )}

      {simResult !== null && (
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground mb-1">Simulation result</p>
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">{simResult}</pre>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={handleSimulate} disabled={disabled}>
          {busy === 'sim' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          Simulate
        </Button>
        <Button className="flex-1" onClick={handleBuild} disabled={disabled}>
          {busy === 'build' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Hammer className="w-4 h-4 mr-2" />}
          Build
        </Button>
      </div>
    </div>
  );
};
