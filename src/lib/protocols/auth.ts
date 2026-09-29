import { Address, Asset, hash, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';
import { baseAccountId } from '@/lib/signatures';
import { passphraseFor } from '@/lib/xdr/parse';
import type { ActivityDetails, DecodedArg } from './detect';
import { findKnownVault, type NetworkId } from './registry';
import { shortenAddress } from './tokens';

/**
 * Soroban authorization entries, decoded for the signing screen.
 *
 * An entry lists the calls an address agrees to, as a tree: the root call and
 * the calls made under it on that address's behalf. A source-account entry has
 * no signature of its own: signing the transaction authorises every node in it,
 * token transfers included. So the tree, not the top-level call, is what a
 * signature really agrees to.
 */

/** A token movement the authorization allows, read off a SEP-41 call. */
export interface TokenMovement {
  kind: 'transfer' | 'transfer_from' | 'approve' | 'burn' | 'burn_from';
  token: string;
  /** Holder whose tokens move, burn or get approved. */
  from: string;
  /** Recipient; for `approve`, the address allowed to spend. Absent for a burn. */
  to?: string;
  /** Address spending an allowance, for the `*_from` calls. */
  spender?: string;
  /** Contract integer as a decimal string. */
  amount: string;
}

/** A contract deployment, as a host function or an authorized call. */
export interface CreateInfo {
  kind: 'create-contract';
  /** Address the new contract gets. */
  contractId: string;
  /** Hex hash of the WASM the contract runs. */
  wasmHash?: string;
  /** Asset wrapped by a Stellar Asset Contract (`native` or `CODE:ISSUER`). */
  asset?: string;
  /** Contract that publishes the WASM hash under `tag` (CAP-85). */
  externalRef?: { owner: string; tag: string };
  /** Address the contract ID derives from; it must authorise the deployment. */
  deployer?: string;
  salt?: string;
  constructorArgs: DecodedArg[];
}

/** Code the app cannot read: a deployment, or a WASM upload. */
export type DeployInfo = CreateInfo | { kind: 'upload-wasm'; wasmHash: string; size: number };

export interface AuthNode {
  /** Contract called; for a deployment, the address the new contract gets. */
  contractId: string;
  functionName: string;
  args: DecodedArg[];
  deploy?: DeployInfo;
  /** Set when the call moves, burns or approves tokens of the authorising address. */
  movement?: TokenMovement;
  subInvocations: AuthNode[];
}

export interface AuthEntry {
  /** `source`: covered by the signature on the transaction. `address`: signed separately by `address`. */
  credential: 'source' | 'address';
  /** The authorising address: the credential's own, or the operation's source account when known. */
  address?: string;
  /** Last ledger a separate signature is valid for. */
  expirationLedger?: number;
  /** True when the root is exactly the operation's own host function, arguments included. */
  rootIsCall: boolean;
  root: AuthNode;
}

/**
 * `scValToNative` hands back BigInt, Uint8Array and Map values. Convert them to
 * plain JSON-safe shapes so decoded arguments can be rendered (and diffed by
 * React) without special-casing every consumer.
 */
export const toPlain = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return [...value].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (Array.isArray(value)) return value.map(toPlain);
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([k, v]) => [String(k), toPlain(v)]));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]));
  }
  return value;
};

/** Decoded arguments, named positionally from `names` when given. */
export const decodeArgs = (args: xdr.ScVal[], names: readonly string[] = []): DecodedArg[] =>
  args.map((arg, i) => {
    let value: unknown;
    try {
      value = toPlain(scValToNative(arg));
    } catch {
      value = undefined;
    }
    return { name: names[i] ?? `arg${i}`, type: arg.type, value };
  });

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Strkey of an address, or '' when it does not decode: this XDR comes from whoever built the transaction. */
const addressOf = (address: xdr.ScAddress): string => {
  try {
    return Address.fromScAddress(address).toString();
  } catch {
    return '';
  }
};

/** Same account, reading a muxed address as its base account. */
export const sameAccount = (a: unknown, b: unknown): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  try {
    return baseAccountId(a) === baseAccountId(b);
  } catch {
    return a === b;
  }
};

/** Address a new contract gets: the hash of its ID preimage on this network. */
const contractIdOf = (preimage: xdr.ContractIdPreimage, network: NetworkId): string => {
  try {
    const id = xdr.HashIdPreimage.envelopeTypeContractId(
      new xdr.HashIdPreimageContractId({ networkId: hash(passphraseFor(network)), contractIdPreimage: preimage }),
    );
    return StrKey.encodeContract(hash(id.toXdr()));
  } catch {
    return '';
  }
};

export const decodeCreate = (
  args: xdr.CreateContractArgs | xdr.CreateContractArgsV2,
  network: NetworkId,
  constructorArgs: xdr.ScVal[] = [],
): CreateInfo => {
  const { contractIdPreimage: preimage, executable } = args;
  const info: CreateInfo = {
    kind: 'create-contract',
    contractId: contractIdOf(preimage, network),
    constructorArgs: decodeArgs(constructorArgs),
  };
  if (preimage.type === 'contractIdPreimageFromAddress') {
    info.deployer = addressOf(preimage.fromAddress.address);
    info.salt = hex(preimage.fromAddress.salt.value);
  } else {
    try {
      info.asset = Asset.fromOperation(preimage.fromAsset).toString();
    } catch {
      info.asset = '';
    }
  }
  if (executable.type === 'contractExecutableWasm') info.wasmHash = hex(executable.wasmHash.value);
  if (executable.type === 'contractExecutableExternalRef') {
    info.externalRef = {
      owner: addressOf(executable.externalRef.executableOwner),
      tag: executable.externalRef.tag.toString(),
    };
  }
  return info;
};

export const decodeUpload = (wasm: Uint8Array): DeployInfo => ({
  kind: 'upload-wasm',
  wasmHash: hex(hash(wasm)),
  size: wasm.length,
});

/** SEP-41 entry points that move, burn or approve a holder's tokens, with their parameters. */
const TOKEN_FUNCTIONS: Record<TokenMovement['kind'], readonly string[]> = {
  transfer: ['from', 'to', 'amount'],
  transfer_from: ['spender', 'from', 'to', 'amount'],
  approve: ['from', 'spender', 'amount', 'expiration_ledger'],
  burn: ['from', 'amount'],
  burn_from: ['spender', 'from', 'amount'],
};

const isTokenFunction = (name: string): name is TokenMovement['kind'] => Object.hasOwn(TOKEN_FUNCTIONS, name);

const integer = (value: unknown): string | null =>
  typeof value === 'string' && /^-?\d+$/.test(value) ? value : null;

/**
 * The token movement a call makes for `authoriser`: its tokens leave (`from`) or
 * its allowance is spent (`spender`). With no known authoriser, every movement counts.
 */
const movementOf = (
  token: string,
  kind: string,
  args: DecodedArg[],
  authoriser: string | undefined,
): TokenMovement | undefined => {
  if (!isTokenFunction(kind) || args.length !== TOKEN_FUNCTIONS[kind].length) return undefined;
  const at = (param: string) => args.find((a) => a.name === param)?.value;
  const from = at('from');
  const amount = integer(at('amount'));
  if (typeof from !== 'string' || amount === null) return undefined;

  const spender = kind.endsWith('_from') ? at('spender') : undefined;
  const mine = !authoriser || sameAccount(from, authoriser) || sameAccount(spender, authoriser);
  if (!mine) return undefined;

  const to = kind === 'approve' ? at('spender') : at('to');
  return {
    kind,
    token,
    from,
    to: typeof to === 'string' ? to : undefined,
    spender: typeof spender === 'string' ? spender : undefined,
    amount,
  };
};

const decodeNode = (
  invocation: xdr.SorobanAuthorizedInvocation,
  network: NetworkId,
  authoriser: string | undefined,
): AuthNode => {
  const subInvocations = invocation.subInvocations.map((sub) => decodeNode(sub, network, authoriser));
  const fn = invocation.function;

  switch (fn.type) {
    case 'sorobanAuthorizedFunctionTypeContractFn': {
      const { contractAddress, functionName, args } = fn.contractFn;
      const contractId = addressOf(contractAddress);
      const name = functionName.toString();
      const params = isTokenFunction(name) && args.length === TOKEN_FUNCTIONS[name].length ? TOKEN_FUNCTIONS[name] : [];
      const decoded = decodeArgs(args, params);
      return {
        contractId,
        functionName: name,
        args: decoded,
        movement: movementOf(contractId, name, decoded, authoriser),
        subInvocations,
      };
    }
    case 'sorobanAuthorizedFunctionTypeCreateContractHostFn': {
      const deploy = decodeCreate(fn.createContractHostFn, network);
      return { contractId: deploy.contractId, functionName: 'createContract', args: [], deploy, subInvocations };
    }
    case 'sorobanAuthorizedFunctionTypeCreateContractV2HostFn': {
      const { constructorArgs } = fn.createContractV2HostFn;
      const deploy = decodeCreate(fn.createContractV2HostFn, network, constructorArgs);
      return {
        contractId: deploy.contractId,
        functionName: 'createContractV2',
        args: deploy.constructorArgs,
        deploy,
        subInvocations,
      };
    }
    default:
      return { contractId: '', functionName: 'unknown', args: [], subInvocations };
  }
};

const sameXdr = (a: { toXdr(format: 'base64'): string }, b: { toXdr(format: 'base64'): string }) =>
  a.toXdr('base64') === b.toXdr('base64');

/** Whether an authorized root is the very host function the operation runs. */
const isOwnCall = (fn: xdr.SorobanAuthorizedFunction, func: xdr.HostFunction): boolean => {
  try {
    switch (fn.type) {
      case 'sorobanAuthorizedFunctionTypeContractFn':
        return func.type === 'hostFunctionTypeInvokeContract' && sameXdr(fn.contractFn, func.invokeContract);
      case 'sorobanAuthorizedFunctionTypeCreateContractHostFn':
        return func.type === 'hostFunctionTypeCreateContract' && sameXdr(fn.createContractHostFn, func.createContract);
      case 'sorobanAuthorizedFunctionTypeCreateContractV2HostFn':
        return func.type === 'hostFunctionTypeCreateContractV2' && sameXdr(fn.createContractV2HostFn, func.createContractV2);
      default:
        return false;
    }
  } catch {
    return false;
  }
};

/** The separate signature of a non-source credential, whatever its variant. */
const addressCredentials = (credentials: xdr.SorobanCredentials): xdr.SorobanAddressCredentials | undefined => {
  switch (credentials.type) {
    case 'sorobanCredentialsAddress':
      return credentials.address;
    case 'sorobanCredentialsAddressV2':
      return credentials.addressV2;
    case 'sorobanCredentialsAddressWithDelegates':
      return credentials.addressWithDelegates.addressCredentials;
    default:
      return undefined;
  }
};

/**
 * Decode every authorization entry of an `invokeHostFunction` operation.
 * `source` is the account a source-account entry stands for: the operation's
 * source, else the transaction's.
 */
export const decodeAuth = (
  entries: xdr.SorobanAuthorizationEntry[],
  func: xdr.HostFunction,
  network: NetworkId,
  source?: string,
): AuthEntry[] =>
  entries.map((entry) => {
    const isSource = entry.credentials.type === 'sorobanCredentialsSourceAccount';
    const separate = isSource ? undefined : addressCredentials(entry.credentials);
    const address = isSource ? source : separate ? addressOf(separate.address) || undefined : undefined;
    return {
      credential: isSource ? 'source' : 'address',
      address,
      expirationLedger: separate?.signatureExpirationLedger,
      rootIsCall: isOwnCall(entry.rootInvocation.function, func),
      root: decodeNode(entry.rootInvocation, network, address),
    };
  });

const flatten = (node: AuthNode): AuthNode[] => [node, ...node.subInvocations.flatMap(flatten)];

/** Every token movement in the trees, with the entry that authorises it. */
export const tokenMovements = (entries: AuthEntry[]): { entry: AuthEntry; movement: TokenMovement }[] =>
  entries.flatMap((entry) =>
    flatten(entry.root).flatMap((node) => (node.movement ? [{ entry, movement: node.movement }] : [])),
  );

/** Every node in the trees, roots included. */
export const authNodes = (entries: AuthEntry[]): AuthNode[] => entries.flatMap((entry) => flatten(entry.root));

/**
 * Movements of the signing account's own tokens: those in source-account
 * entries, plus any the account signs for separately.
 */
export const accountMovements = (entries: AuthEntry[], source?: string) =>
  tokenMovements(entries).filter(
    ({ entry }) => entry.credential === 'source' || (source !== undefined && sameAccount(entry.address, source)),
  );

/** Arguments naming whose funds move or where they land: all must be the signing account. */
const ACCOUNT_PARAMS = ['from', 'to', 'caller'];

/** Takes a transfer out of the allowance, or refuses it. */
type Spend = (token: string, to: string, amount: bigint) => boolean;

/** What the summary card says may leave the account: token → most it may send. */
const allowanceFor = (details: ActivityDetails | null, network: NetworkId): Spend => {
  const left = new Map<string, bigint>();
  const take: Spend = (token, _to, amount) => {
    const limit = left.get(token);
    if (limit === undefined || amount > limit) return false;
    left.set(token, limit - amount);
    return true;
  };
  if (!details) return () => false;

  switch (details.kind) {
    case 'swap':
      left.set(details.sell.contract, BigInt(details.sell.raw));
      return take;
    case 'add-liquidity':
      left.set(details.desiredA.contract, BigInt(details.desiredA.raw));
      left.set(details.desiredB.contract, BigInt(details.desiredB.raw));
      return take;
    case 'vault-withdraw':
      left.set(details.vault, BigInt(details.shares));
      return take;
    case 'vault-deposit': {
      const assets = findKnownVault(details.vault, network)?.assets;
      if (assets) {
        assets.forEach((asset, i) => left.set(asset, BigInt(details.amounts[i] ?? '0')));
        return take;
      }
      // An unpinned vault's assets are not known offline. It pulls them in
      // order, into itself: tie each new token to the next amount.
      return (token, to, amount) => {
        if (to !== details.vault) return false;
        if (!left.has(token)) {
          const next = details.amounts[left.size];
          if (next === undefined) return false;
          left.set(token, BigInt(next));
        }
        return take(token, to, amount);
      };
    }
    case 'remove-liquidity': {
      // The pair is not an argument. The router sends the shares back to the
      // pair contract, which burns them: one contract, paid to itself.
      return (token, to, amount) => {
        if (to !== token || (left.size && !left.has(token))) return false;
        if (!left.size) left.set(token, BigInt(details.liquidity));
        return take(token, to, amount);
      };
    }
  }
};

/**
 * Why a protocol call's authorization lets it do more than its summary shows;
 * empty when it does not.
 *
 * The rules are the ones `verifyProtocolTransaction` applies to API-built
 * transactions: every entry is covered by the transaction signature, its root
 * is exactly this call, and under it sit only plain `transfer`s out of the
 * account, of the tokens the summary sends and within its amounts. Without a
 * known source account a transfer's `from` cannot be tied to the signer, so the
 * amounts are then bounded across all transfers instead.
 */
export const authScopeIssues = (
  call: { args: DecodedArg[]; auth: AuthEntry[]; source?: string },
  details: ActivityDetails | null,
  network: NetworkId,
): string[] => {
  const issues = new Set<string>();
  const account = call.source;

  if (account) {
    for (const arg of call.args) {
      if (ACCOUNT_PARAMS.includes(arg.name) && !sameAccount(arg.value, account)) {
        const value = typeof arg.value === 'string' ? shortenAddress(arg.value, 8, 8) : 'another address';
        issues.add(`Sets ${arg.name} to ${value}, not the signing account.`);
      }
    }
  }

  const spend = allowanceFor(details, network);
  const isAllowedTransfer = (node: AuthNode): boolean => {
    if (node.deploy || node.subInvocations.length || node.functionName !== 'transfer' || node.args.length !== 3) {
      return false;
    }
    const [from, to, amount] = node.args;
    if (from.type !== 'scvAddress' || to.type !== 'scvAddress' || amount.type !== 'scvI128') return false;
    const raw = integer(amount.value);
    if (raw === null || BigInt(raw) < 0n) return false;
    if (account && !sameAccount(from.value, account)) return false;
    return spend(node.contractId, String(to.value), BigInt(raw));
  };

  for (const entry of call.auth) {
    if (entry.credential !== 'source') {
      const by = entry.address ? shortenAddress(entry.address, 8, 8) : 'another address';
      issues.add(`Needs an authorization signed separately by ${by}.`);
    }
    if (!entry.rootIsCall) {
      issues.add('Authorises a different call than the one it makes.');
    } else if (!entry.root.subInvocations.every(isAllowedTransfer)) {
      issues.add('Also authorises calls or transfers the summary above does not show.');
    }
  }

  return [...issues];
};
