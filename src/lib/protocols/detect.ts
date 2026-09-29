import { Address, Operation, type Transaction } from '@stellar/stellar-sdk';
import { baseAccountId } from '@/lib/signatures';
import {
  authScopeIssues,
  decodeArgs,
  decodeAuth,
  decodeCreate,
  decodeUpload,
  tokenMovements,
  type AuthEntry,
  type DeployInfo,
} from './auth';
import {
  findKnownContract,
  findContractAnyNetwork,
  findKnownVault,
  KNOWN_FUNCTIONS,
  type FunctionSignature,
  type Intent,
  type NetworkId,
  type ProtocolId,
} from './registry';

/** Element type of `Transaction.operations` — the discriminated union, not the builder class. */
export type TxOperation = Transaction['operations'][number];

export interface DecodedArg {
  name: string;
  /** ScVal discriminant, e.g. `scvI128` — shown when we can't do better. */
  type: string;
  value: unknown;
}

/** A single `invokeHostFunction` operation, decoded as far as we can take it. */
export interface ContractCall {
  opIndex: number;
  contractId: string;
  functionName: string;
  args: DecodedArg[];
  authCount: number;
  /** Every authorization entry attached to the operation, decoded. */
  auth: AuthEntry[];
  /** Set when the host function deploys a contract or uploads WASM instead of calling one. */
  deploy?: DeployInfo;
  /** Account a source-account authorization stands for, when known: the operation's source, else the transaction's. */
  source?: string;
}

export interface ProtocolMatch {
  protocol: ProtocolId;
  role: string;
  /**
   * `verified` — the contract address is one we ship.
   * `likely`  — the address is unknown but the entry point matches a protocol
   *             interface exactly (name, arity and argument shape).
   * `unsafe`  — the address is one we ship, but the authorization attached lets
   *             the call do more than its summary shows (see `authScopeIssues`).
   */
  confidence: 'verified' | 'likely' | 'unsafe';
  signature: FunctionSignature | null;
  /** Set when the address is a known deployment on the *other* network. */
  networkMismatch?: NetworkId;
}

export interface TokenAmount {
  contract: string;
  /** Contract-native integer as a decimal string — JSON-safe, no precision loss. */
  raw: string;
  bound: 'exact' | 'min' | 'max';
}

/** One leg of an aggregator's `distribution`. */
export interface RouteHop {
  /** Venue as the aggregator names it, e.g. "Soroswap"; empty when unreadable. */
  protocol: string;
  path: string[];
  /** Share of the amount sent this way, in the aggregator's parts. */
  parts: number | null;
}

export type ActivityDetails =
  | {
      kind: 'swap';
      sell: TokenAmount;
      buy: TokenAmount;
      /** Full hop list when the router exposes one; endpoints only otherwise. */
      path: string[];
      /** False when the contract picks the route itself (aggregators): `path` is then just the endpoints. */
      routeKnown: boolean;
      /** The aggregator's split across venues, when the call spells it out. */
      hops: RouteHop[];
      /** Payer, for entry points that name one instead of a recipient. */
      from?: string;
      to: string;
      /** Unix seconds. */
      deadline?: number;
    }
  | {
      kind: 'add-liquidity';
      desiredA: TokenAmount;
      desiredB: TokenAmount;
      minA: TokenAmount;
      minB: TokenAmount;
      to: string;
      deadline?: number;
    }
  | {
      kind: 'remove-liquidity';
      liquidity: string;
      minA: TokenAmount;
      minB: TokenAmount;
      to: string;
      deadline?: number;
    }
  | {
      kind: 'vault-deposit';
      vault: string;
      amounts: string[];
      minAmounts: string[];
      from: string;
      /** Whether the vault immediately routes the deposit into its strategies. */
      invest: boolean;
    }
  | {
      kind: 'vault-withdraw';
      vault: string;
      shares: string;
      minAmountsOut: string[];
      from: string;
    };

export interface AnalyzedCall extends ContractCall {
  match: ProtocolMatch | null;
  intent: Intent | null;
  details: ActivityDetails | null;
  /** Why the authorization lets a protocol call do more than its summary shows; empty when it does not. */
  authIssues: string[];
  /** Token contracts referenced by this call, for metadata enrichment. */
  tokens: string[];
}

/** Contract integers stay decimal strings: JSON-safe and lossless. */
const toAmount = (value: unknown): string | null => {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
  return null;
};

const toSeconds = (value: unknown): number | undefined => {
  const amount = toAmount(value);
  if (amount === null) return undefined;
  const seconds = Number(amount);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
};

const asAmountList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(toAmount).filter((v): v is string => v !== null) : [];

const asAddressList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * An aggregator `distribution`: one `{ protocol_id, path, parts }` struct per
 * venue. An entry that does not read as one is kept as an empty hop, so it
 * still shows up instead of silently vanishing from the route.
 */
const asHops = (value: unknown): RouteHop[] =>
  Array.isArray(value)
    ? value.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return { protocol: '', path: [], parts: null };
        const { protocol_id: protocol, path, parts } = item as Record<string, unknown>;
        // A unit enum variant decodes as a one-element vector: `["Soroswap"]`.
        const venue = Array.isArray(protocol) ? protocol[0] : protocol;
        const share = toAmount(parts);
        return {
          protocol: typeof venue === 'string' ? venue : '',
          path: asAddressList(path),
          parts: share === null ? null : Number(share),
        };
      })
    : [];

/** Base account of a (possibly muxed) source account. */
const accountOf = (address: string | undefined): string | undefined => {
  if (!address) return undefined;
  try {
    return baseAccountId(address);
  } catch {
    return address;
  }
};

/**
 * Decode one `invokeHostFunction` op, or null if it isn't one. Deployments and
 * uploads come back too, with `deploy` set: they run code the app cannot read,
 * so they must be shown as such rather than as a bare operation row.
 */
const decodeCall = (op: TxOperation, opIndex: number, network: NetworkId, txSource?: string): ContractCall | null => {
  if (op.type !== 'invokeHostFunction') return null;

  const { func, auth = [] } = op as Operation.InvokeHostFunction;
  const source = accountOf(op.source ?? txSource);
  const common = { opIndex, authCount: auth.length, auth: decodeAuth(auth, func, network, source), source };

  switch (func.type) {
    case 'hostFunctionTypeInvokeContract': {
      const invocation = func.invokeContract;
      let contractId: string;
      try {
        contractId = Address.fromScAddress(invocation.contractAddress).toString();
      } catch {
        return null;
      }
      return { ...common, contractId, functionName: invocation.functionName.toString(), args: decodeArgs(invocation.args) };
    }
    case 'hostFunctionTypeCreateContract': {
      const deploy = decodeCreate(func.createContract, network);
      return { ...common, contractId: deploy.contractId, functionName: 'createContract', args: [], deploy };
    }
    case 'hostFunctionTypeCreateContractV2': {
      const deploy = decodeCreate(func.createContractV2, network, func.createContractV2.constructorArgs);
      return { ...common, contractId: deploy.contractId, functionName: 'createContractV2', args: deploy.constructorArgs, deploy };
    }
    case 'hostFunctionTypeUploadContractWasm':
      return { ...common, contractId: '', functionName: 'uploadContractWasm', args: [], deploy: decodeUpload(func.wasm) };
    default:
      return null;
  }
};

/** ScVal discriminants a signature's positional argument is allowed to take. */
const SHAPES: Record<string, readonly string[]> = {
  amount_in: ['scvI128', 'scvU128', 'scvI64', 'scvU64'],
  amount_out: ['scvI128', 'scvU128', 'scvI64', 'scvU64'],
  amount_out_min: ['scvI128', 'scvU128', 'scvI64', 'scvU64'],
  amount_in_max: ['scvI128', 'scvU128', 'scvI64', 'scvU64'],
  amount_a_desired: ['scvI128', 'scvU128'],
  amount_b_desired: ['scvI128', 'scvU128'],
  amount_a_min: ['scvI128', 'scvU128'],
  amount_b_min: ['scvI128', 'scvU128'],
  liquidity: ['scvI128', 'scvU128'],
  withdraw_shares: ['scvI128', 'scvU128'],
  path: ['scvVec'],
  distribution: ['scvVec'],
  amounts_desired: ['scvVec'],
  amounts_min: ['scvVec'],
  min_amounts_out: ['scvVec'],
  to: ['scvAddress'],
  from: ['scvAddress'],
  token_in: ['scvAddress'],
  token_out: ['scvAddress'],
  token_a: ['scvAddress'],
  token_b: ['scvAddress'],
  invest: ['scvBool'],
  deadline: ['scvU64', 'scvU32'],
  // An option whose meaning is not pinned: only the empty value is a call we can read.
  options: ['scvVoid'],
};

/** Exact name, arity and argument shapes — the bar for acting on a match, not just labelling it. */
export const fitsSignature = (call: ContractCall, sig: FunctionSignature): boolean => {
  if (call.functionName !== sig.name || call.args.length !== sig.params.length) return false;
  return sig.params.every((param, i) => {
    const allowed = SHAPES[param];
    return !allowed || allowed.includes(call.args[i].type);
  });
};

const matchProtocol = (call: ContractCall, network: NetworkId): ProtocolMatch | null => {
  const known = findKnownContract(call.contractId, network);
  const vault = findKnownVault(call.contractId, network);

  if (known || vault) {
    const protocol = known?.protocol ?? 'defindex';
    const role = known?.role ?? 'Vault';
    const signature =
      KNOWN_FUNCTIONS.find((s) => s.protocol === protocol && s.role === role && fitsSignature(call, s)) ??
      KNOWN_FUNCTIONS.find((s) => s.protocol === protocol && s.name === call.functionName) ??
      null;
    return { protocol, role, confidence: 'verified', signature };
  }

  const signature = KNOWN_FUNCTIONS.find((s) => fitsSignature(call, s));
  if (!signature) return null;

  const elsewhere = findContractAnyNetwork(call.contractId);
  return {
    protocol: signature.protocol,
    role: signature.role,
    confidence: 'likely',
    signature,
    networkMismatch: elsewhere?.network,
  };
};

/** Pull the structured story out of a matched call. Positional, per the on-chain spec. */
const extractDetails = (call: ContractCall, sig: FunctionSignature): ActivityDetails | null => {
  const at = (param: string) => {
    const i = sig.params.indexOf(param);
    return i === -1 ? undefined : call.args[i]?.value;
  };

  switch (sig.intent) {
    case 'swap': {
      const path = asAddressList(at('path'));
      const tokenIn = (at('token_in') as string | undefined) ?? path[0];
      const tokenOut = (at('token_out') as string | undefined) ?? path[path.length - 1];
      if (!tokenIn || !tokenOut) return null;

      const exactIn = sig.params.includes('amount_out_min');
      const sellRaw = toAmount(exactIn ? at('amount_in') : at('amount_in_max'));
      const buyRaw = toAmount(exactIn ? at('amount_out_min') : at('amount_out'));
      if (sellRaw === null || buyRaw === null) return null;
      const from = at('from');

      return {
        kind: 'swap',
        sell: { contract: tokenIn, raw: sellRaw, bound: exactIn ? 'exact' : 'max' },
        buy: { contract: tokenOut, raw: buyRaw, bound: exactIn ? 'min' : 'exact' },
        path: path.length ? path : [tokenIn, tokenOut],
        routeKnown: path.length > 0,
        hops: asHops(at('distribution')),
        from: typeof from === 'string' ? from : undefined,
        to: (at('to') as string) ?? '',
        deadline: toSeconds(at('deadline')),
      };
    }

    case 'add-liquidity': {
      const tokenA = at('token_a') as string | undefined;
      const tokenB = at('token_b') as string | undefined;
      const desiredA = toAmount(at('amount_a_desired'));
      const desiredB = toAmount(at('amount_b_desired'));
      const minA = toAmount(at('amount_a_min'));
      const minB = toAmount(at('amount_b_min'));
      if (!tokenA || !tokenB || desiredA === null || desiredB === null || minA === null || minB === null) {
        return null;
      }
      return {
        kind: 'add-liquidity',
        desiredA: { contract: tokenA, raw: desiredA, bound: 'max' },
        desiredB: { contract: tokenB, raw: desiredB, bound: 'max' },
        minA: { contract: tokenA, raw: minA, bound: 'min' },
        minB: { contract: tokenB, raw: minB, bound: 'min' },
        to: (at('to') as string) ?? '',
        deadline: toSeconds(at('deadline')),
      };
    }

    case 'remove-liquidity': {
      const tokenA = at('token_a') as string | undefined;
      const tokenB = at('token_b') as string | undefined;
      const liquidity = toAmount(at('liquidity'));
      const minA = toAmount(at('amount_a_min'));
      const minB = toAmount(at('amount_b_min'));
      if (!tokenA || !tokenB || liquidity === null || minA === null || minB === null) return null;
      return {
        kind: 'remove-liquidity',
        liquidity,
        minA: { contract: tokenA, raw: minA, bound: 'min' },
        minB: { contract: tokenB, raw: minB, bound: 'min' },
        to: (at('to') as string) ?? '',
        deadline: toSeconds(at('deadline')),
      };
    }

    case 'vault-deposit': {
      const amounts = asAmountList(at('amounts_desired') ?? at('amounts'));
      if (!amounts.length) return null;
      return {
        kind: 'vault-deposit',
        vault: call.contractId,
        amounts,
        minAmounts: asAmountList(at('amounts_min')),
        from: (at('from') as string) ?? (at('caller') as string) ?? '',
        invest: at('invest') === true,
      };
    }

    case 'vault-withdraw': {
      const shares = toAmount(at('withdraw_shares'));
      if (shares === null) return null;
      return {
        kind: 'vault-withdraw',
        vault: call.contractId,
        shares,
        minAmountsOut: asAmountList(at('min_amounts_out')),
        from: (at('from') as string) ?? '',
      };
    }

    default:
      return null;
  }
};

const collectTokens = (
  details: ActivityDetails | null,
  call: ContractCall,
  network: NetworkId,
): string[] => {
  if (!details) return [];
  switch (details.kind) {
    case 'swap':
      return [...details.path, ...details.hops.flatMap((hop) => hop.path)];
    case 'add-liquidity':
      return [details.desiredA.contract, details.desiredB.contract];
    case 'remove-liquidity':
      return [details.minA.contract, details.minB.contract];
    case 'vault-deposit':
    case 'vault-withdraw':
      return findKnownVault(call.contractId, network)?.assets ?? [];
  }
};

/**
 * Decode and identify every contract invocation in a transaction's operations.
 *
 * Pass the transaction's source account so a source-account authorization can
 * be read as that account's: a call to a pinned address then only stays
 * `verified` while its authorization is limited to what the summary shows.
 */
export const analyzeOperations = (operations: TxOperation[], network: NetworkId, source?: string): AnalyzedCall[] =>
  operations
    .map((op, i) => decodeCall(op, i, network, source))
    .filter((call): call is ContractCall => call !== null)
    .map((call) => {
      const moved = tokenMovements(call.auth).map(({ movement }) => movement.token);
      if (call.deploy) {
        return { ...call, match: null, intent: null, details: null, authIssues: [], tokens: [...new Set(moved)] };
      }

      const found = matchProtocol(call, network);
      const signature = found?.signature;
      const details = signature ? extractDetails(call, signature) : null;
      const named = signature
        ? call.args.map((arg, i) => ({ ...arg, name: signature.params[i] ?? arg.name }))
        : call.args;
      const auth = signature
        ? call.auth.map((entry) => (entry.rootIsCall ? { ...entry, root: { ...entry.root, args: named } } : entry))
        : call.auth;

      const authIssues = found ? authScopeIssues({ args: named, auth, source: call.source }, details, network) : [];
      // Without the signing account, callers such as verify.ts judge the authorization themselves.
      const match =
        found?.confidence === 'verified' && call.source && authIssues.length
          ? { ...found, confidence: 'unsafe' as const }
          : found;

      return {
        ...call,
        args: named,
        auth,
        match,
        intent: signature?.intent ?? null,
        details,
        authIssues,
        tokens: [...new Set([...collectTokens(details, call, network), ...moved])],
      };
    });

/** The single protocol a transaction belongs to, or null when it's mixed/unknown. */
export const dominantProtocol = (calls: AnalyzedCall[]): ProtocolId | null => {
  const protocols = new Set(calls.map((c) => c.match?.protocol).filter(Boolean) as ProtocolId[]);
  return protocols.size === 1 ? [...protocols][0] : null;
};
