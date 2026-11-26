import { Address, Keypair, Operation, StrKey, TransactionBuilder, contract, hash, type rpc } from '@stellar/stellar-sdk';
import { appConfig } from '../appConfig';
import { classifyParams, type FormValues } from '../contract/form-values';
import { argsToScVals, buildInvocationXdr } from '../contract/invoke';
import { loadContractSpec } from '../contract/spec';
import { sorobanServer } from '../payments';
import { submitToRefractor } from '../refractor';
import { computeSignatureStatus, type SignatureRequirement } from '../signatures';
import { fetchAccountData } from '../stellar';
import { getTransactionHashFromXdr, passphraseFor, type NetworkId } from '../xdr/parse';

// Refractor answers 500 to request bodies over 100 KiB.
const MAX_XDR_LENGTH = 100_000;

/**
 * The account that deploys. With a `signingKey` (the secret key of one of its signers) the transaction is
 * signed with it, so the other signers only add what is still missing. Values are written as in the app's contract form.
 */
export type ProposeRequest = { sourceAccount: string; network: NetworkId; signingKey?: string } & (
  | { kind: 'upload'; wasm: Uint8Array }
  | { kind: 'deploy'; wasm: Uint8Array; constructorArgs?: FormValues }
  | { kind: 'call'; contractId: string; method: string; args?: FormValues }
);

export interface Proposal {
  hash: string;
  xdr: string;
  /** False when the transaction is too large for Refractor and has to be imported in Stratum. */
  stored: boolean;
  /** Set when the transaction carries the signing key's signature: its weight and what the account needs. */
  signed?: { weight: number; threshold: number };
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

/** The signing key must be a signer, yet must not reach the threshold alone, so someone else always signs too. */
export const checkSecondSignatureNeeded = ({ signedBy, weight, threshold }: SignatureRequirement, signer: string) => {
  if (!signedBy.includes(signer)) throw new Error('The signing key is not a signer of the source account.');
  if (weight >= threshold) {
    throw new Error('The signing key alone reaches the threshold, so no second signature would be needed.');
  }
};

const signWithKey = async (xdr: string, request: ProposeRequest, secret: string) => {
  const keypair = Keypair.fromSecret(secret);
  const transaction = TransactionBuilder.fromXDR(xdr, passphraseFor(request.network));
  transaction.sign(keypair);

  const account = await fetchAccountData(request.sourceAccount, request.network);
  const accounts = new Map([[request.sourceAccount, account]]);
  const [requirement] = computeSignatureStatus(transaction, accounts).requirements;
  checkSecondSignatureNeeded(requirement, keypair.publicKey());
  return { xdr: transaction.toXDR(), signed: { weight: requirement.weight, threshold: requirement.threshold } };
};

/**
 * Builds an unsigned Soroban transaction for a multisig account (an upload, a deploy or a contract
 * call such as an upgrade), simulates it, and stores it on Refractor for the signers to open in Stratum.
 */
export const proposeSigning = async (request: ProposeRequest): Promise<Proposal> => {
  if (!StrKey.isValidEd25519PublicKey(request.sourceAccount)) throw new Error('The source account is not a public key.');

  const built =
    request.kind === 'call' ? await buildCallXdr(request) : await buildWasmXdr(request, sorobanServer(request.network));
  const { xdr, signed } = request.signingKey
    ? await signWithKey(built, request, request.signingKey)
    : { xdr: built, signed: undefined };
  const stored = xdr.length < MAX_XDR_LENGTH;
  if (stored) await submitToRefractor(xdr, request.network);
  return { hash: getTransactionHashFromXdr(xdr, request.network), xdr, stored, signed };
};

export const stratumLink = (proposal: Proposal) =>
  proposal.stored ? `${appConfig.STRATUM_URL}/?r=${proposal.hash}` : appConfig.STRATUM_URL;
