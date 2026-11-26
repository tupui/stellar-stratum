import { Address, Operation, StrKey, TransactionBuilder, contract, hash, type rpc } from '@stellar/stellar-sdk';
import { appConfig } from '../appConfig';
import { classifyParams, type FormValues } from '../contract/form-values';
import { argsToScVals, buildInvocationXdr } from '../contract/invoke';
import { loadContractSpec } from '../contract/spec';
import { sorobanServer } from '../payments';
import { submitToRefractor } from '../refractor';
import { getTransactionHashFromXdr, passphraseFor, type NetworkId } from '../xdr/parse';

// Refractor answers 500 to request bodies over 100 KiB.
const MAX_XDR_LENGTH = 100_000;

/** The account that deploys is only named here, it never signs. Values are written as in the app's contract form. */
export type ProposeRequest = { sourceAccount: string; network: NetworkId } & (
  | { kind: 'upload'; wasm: Uint8Array }
  | { kind: 'deploy'; wasm: Uint8Array; constructorArgs?: FormValues }
  | { kind: 'call'; contractId: string; method: string; args?: FormValues }
);

export interface Proposal {
  hash: string;
  xdr: string;
  /** False when the transaction is too large for Refractor and has to be imported in Stratum. */
  stored: boolean;
}

type WasmRequest = Extract<ProposeRequest, { wasm: Uint8Array }>;
type CallRequest = Extract<ProposeRequest, { kind: 'call' }>;

const constructorScVals = (wasm: Uint8Array, values: FormValues) => {
  const spec = contract.Spec.fromWasm(wasm);
  return argsToScVals(spec, '__constructor', classifyParams(spec.getFunc('__constructor'), spec), values);
};

const wasmOperation = (request: WasmRequest) => {
  if (request.kind === 'upload') return Operation.uploadContractWasm({ wasm: request.wasm });
  return Operation.createCustomContract({
    address: new Address(request.sourceAccount),
    wasmHash: hash(request.wasm),
    salt: crypto.getRandomValues(new Uint8Array(32)),
    constructorArgs: request.constructorArgs && constructorScVals(request.wasm, request.constructorArgs),
  });
};

const buildWasmXdr = async (request: WasmRequest, soroban: rpc.Server) => {
  const source = await soroban.getAccount(request.sourceAccount);
  const transaction = new TransactionBuilder(source, {
    fee: appConfig.DEFAULT_BASE_FEE_STROOPS.toString(),
    networkPassphrase: passphraseFor(request.network),
  })
    .addOperation(wasmOperation(request))
    .setTimeout(appConfig.TX_VALIDITY_SECONDS)
    .build();
  return (await soroban.prepareTransaction(transaction)).toXDR();
};

const buildCallXdr = async ({ sourceAccount, network, contractId, method, args = {} }: CallRequest) => {
  const loaded = await loadContractSpec(contractId, network);
  const params = classifyParams(loaded.spec.getFunc(method), loaded.spec);
  return buildInvocationXdr({ loaded, functionName: method, params, values: args, publicKey: sourceAccount });
};

/**
 * Builds an unsigned Soroban transaction for a multisig account (an upload, a deploy or a contract
 * call such as an upgrade), simulates it, and stores it on Refractor for the signers to open in Stratum.
 */
export const proposeSigning = async (request: ProposeRequest): Promise<Proposal> => {
  if (!StrKey.isValidEd25519PublicKey(request.sourceAccount)) throw new Error('The source account is not a public key.');

  const xdr =
    request.kind === 'call' ? await buildCallXdr(request) : await buildWasmXdr(request, sorobanServer(request.network));
  const stored = xdr.length < MAX_XDR_LENGTH;
  if (stored) await submitToRefractor(xdr, request.network);
  return { hash: getTransactionHashFromXdr(xdr, request.network), xdr, stored };
};

export const stratumLink = (proposal: Proposal) =>
  proposal.stored ? `${appConfig.STRATUM_URL}/?r=${proposal.hash}` : appConfig.STRATUM_URL;
