import { useMemo, useState } from 'react';
import { contract } from '@stellar/stellar-sdk';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Play, Hammer, Loader2 } from 'lucide-react';
import { ContractValueInput } from './ContractValueInput';
import {
  classifyParam,
  coerceFormValue,
  defaultFormValue,
  formatResult,
  type FormValues,
  type ParamShape,
} from '@/lib/contract/form-values';
import { appConfig } from '@/lib/appConfig';
import type { LoadedContract } from '@/lib/contract/spec';
import { invocationRpcOptions } from '@/lib/contract/spec';

interface ContractFunctionFormProps {
  loaded: LoadedContract;
  functionName: string;
  publicKey: string;
  onBuild: (xdr: string) => void;
  isBuilding: boolean;
  isTransactionBuilt: boolean;
}

interface ParsedFunction {
  params: ParamShape[];
  returnLabel: string;
  doc: string;
}

const parseFunction = (loaded: LoadedContract, name: string): ParsedFunction => {
  const fn = loaded.spec.getFunc(name);
  const params = fn.inputs().map((input) => classifyParam(input.name().toString(), input.type()));
  const outputs = fn.outputs();
  const returnLabel = outputs.length === 0
    ? 'void'
    : outputs.map((t) => classifyParam('', t).typeLabel).join(', ');
  return { params, returnLabel, doc: fn.doc().toString() };
};

export const ContractFunctionForm = ({
  loaded,
  functionName,
  publicKey,
  onBuild,
  isBuilding,
  isTransactionBuilt,
}: ContractFunctionFormProps) => {
  const parsed = useMemo(() => parseFunction(loaded, functionName), [loaded, functionName]);

  // Reset form state whenever the target function changes.
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(parsed.params.map((p) => [p.name, defaultFormValue(p)])),
  );
  const [error, setError] = useState('');
  const [simResult, setSimResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<'sim' | 'build' | null>(null);

  // Keep values in sync if function changes underneath us.
  useMemo(() => {
    setValues(Object.fromEntries(parsed.params.map((p) => [p.name, defaultFormValue(p)])));
    setError('');
    setSimResult(null);
  }, [parsed]);

  const setField = (name: string, next: unknown) => {
    setValues((prev) => ({ ...prev, [name]: next }));
  };

  const buildAssembled = async () => {
    // Coerce every field. Any coercion failure surfaces as an inline error.
    const nativeArgs: Record<string, unknown> = {};
    for (const p of parsed.params) {
      nativeArgs[p.name] = coerceFormValue(p, values[p.name]);
    }
    const scArgs = loaded.spec.funcArgsToScVals(functionName, nativeArgs);
    return contract.AssembledTransaction.build({
      method: functionName,
      args: scArgs,
      fee: String(appConfig.DEFAULT_BASE_FEE_STROOPS),
      timeoutInSeconds: appConfig.DEFAULT_TX_TIMEOUT_SECONDS,
      simulate: true,
      parseResultXdr: (retval) => loaded.spec.funcResToNative(functionName, retval),
      ...invocationRpcOptions(loaded, publicKey),
    });
  };

  const handleSimulate = async () => {
    setError('');
    setSimResult(null);
    setBusy('sim');
    try {
      const tx = await buildAssembled();
      const raw = tx.result;
      setSimResult(formatResult(raw));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setBusy(null);
    }
  };

  const handleBuild = async () => {
    setError('');
    setBusy('build');
    try {
      const tx = await buildAssembled();
      const xdr = tx.toXDR();
      onBuild(xdr);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Build failed');
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
          <AlertDescription className="text-sm break-all">{error}</AlertDescription>
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
