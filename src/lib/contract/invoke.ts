import { contract, rpc } from '@stellar/stellar-sdk';
import { appConfig } from '@/lib/appConfig';
import { analyzeOperations, type AnalyzedCall } from '@/lib/protocols/detect';
import { getInnerTransaction, tryParseTransaction } from '@/lib/xdr/parse';
import { coerceFormValue, type FormValues, type ParamShape } from './form-values';
import { invocationRpcOptions, type LoadedContract, type NetworkType } from './spec';

export interface Invocation {
  loaded: LoadedContract;
  functionName: string;
  params: ParamShape[];
  values: FormValues;
  /** Source account of the transaction. */
  publicKey: string;
}

/**
 * Convert the form values and simulate the call. Throws when the simulation fails:
 * `AssembledTransaction.build` does not, it keeps the unsimulated transaction instead.
 */
export const simulateInvocation = async ({ loaded, functionName, params, values, publicKey }: Invocation) => {
  const nativeArgs = Object.fromEntries(params.map((p) => [p.name, coerceFormValue(p, values[p.name], loaded.spec)]));
  const tx = await contract.AssembledTransaction.build({
    method: functionName,
    args: loaded.spec.funcArgsToScVals(functionName, nativeArgs),
    fee: String(appConfig.DEFAULT_BASE_FEE_STROOPS),
    timeoutInSeconds: appConfig.TX_VALIDITY_SECONDS,
    simulate: true,
    parseResultXdr: (retval) => loaded.spec.funcResToNative(functionName, retval),
    ...invocationRpcOptions(loaded, publicKey),
  });
  const simulation = tx.simulation;
  if (!simulation) throw new Error('The call could not be simulated.');
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`The call fails in simulation: ${simulation.error}`);
  }
  if (rpc.Api.isSimulationRestore(simulation)) {
    throw new Error('The call uses archived contract data, which must be restored before it can run.');
  }
  return tx;
};

/**
 * Simulate the call and return the transaction XDR for the source account's signers. Refuses a
 * call that needs an authorization entry signed by an address (e.g. `transfer` from another
 * account): the app only collects transaction signatures, and the network rejects the call without it.
 */
export const buildInvocationXdr = async (invocation: Invocation): Promise<string> => {
  const tx = await simulateInvocation(invocation);
  const addresses = tx.needsNonInvokerSigningBy();
  if (addresses.length > 0) {
    throw new Error(
      `This call needs an authorization signed by ${addresses.join(', ')}, which cannot be collected here. ` +
      'Only calls the source account authorizes by signing the transaction can be built.',
    );
  }
  return tx.toXdr();
};

/**
 * The simulated or built call as the signing screen reads it, with the authorization entries the
 * simulation attached: `needsNonInvokerSigningBy` ignores source-account entries, yet signing the
 * transaction authorises every call in them, including token transfers made deep inside the contract.
 */
export const describeInvocation = (envelope: string, network: NetworkType): AnalyzedCall | null => {
  const parsed = tryParseTransaction(envelope, network);
  if (!parsed) return null;
  const tx = getInnerTransaction(parsed.tx);
  return analyzeOperations(tx.operations, network, tx.source)[0] ?? null;
};
