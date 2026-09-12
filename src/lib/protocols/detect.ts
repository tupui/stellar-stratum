import { Address, Operation, scValToNative, type Transaction, xdr } from '@stellar/stellar-sdk';
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
}

export interface ProtocolMatch {
  protocol: ProtocolId;
  role: string;
  /**
   * `verified` — the contract address is one we ship.
   * `likely`  — the address is unknown but the entry point matches a protocol
   *             interface exactly (name, arity and argument shape).
   */
  confidence: 'verified' | 'likely';
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

export type ActivityDetails =
  | {
      kind: 'swap';
      sell: TokenAmount;
      buy: TokenAmount;
      /** Full hop list when the router exposes one; endpoints only otherwise. */
      path: string[];
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
 * `scValToNative` hands back BigInt, Buffer and Map values. Convert them to
 * plain JSON-safe shapes so decoded arguments can be rendered (and diffed by
 * React) without special-casing every consumer.
 */
const toPlain = (value: unknown): unknown => {
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

/** Decode one `invokeHostFunction` op, or null if it isn't a contract invocation. */
const decodeCall = (op: TxOperation, opIndex: number): ContractCall | null => {
  if (op.type !== 'invokeHostFunction') return null;

  const func = (op as Operation.InvokeHostFunction).func;
  if (func.switch().name !== 'hostFunctionTypeInvokeContract') return null;

  const invocation = func.invokeContract();

  let contractId: string;
  try {
    contractId = Address.fromScAddress(invocation.contractAddress()).toString();
  } catch {
    return null;
  }

  const functionName = invocation.functionName().toString();
  const args = invocation.args().map((arg: xdr.ScVal, i: number) => {
    let value: unknown;
    try {
      value = toPlain(scValToNative(arg));
    } catch {
      value = undefined;
    }
    return { name: `arg${i}`, type: arg.switch().name, value };
  });

  return {
    opIndex,
    contractId,
    functionName,
    args,
    authCount: (op as Operation.InvokeHostFunction).auth?.length ?? 0,
  };
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
};

const fitsSignature = (call: ContractCall, sig: FunctionSignature): boolean => {
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

      const exactIn = sig.name === 'swap_exact_tokens_for_tokens';
      const sellRaw = toAmount(exactIn ? at('amount_in') : at('amount_in_max'));
      const buyRaw = toAmount(exactIn ? at('amount_out_min') : at('amount_out'));
      if (sellRaw === null || buyRaw === null) return null;

      return {
        kind: 'swap',
        sell: { contract: tokenIn, raw: sellRaw, bound: exactIn ? 'exact' : 'max' },
        buy: { contract: tokenOut, raw: buyRaw, bound: exactIn ? 'min' : 'exact' },
        path: path.length ? path : [tokenIn, tokenOut],
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
      return details.path;
    case 'add-liquidity':
      return [details.desiredA.contract, details.desiredB.contract];
    case 'remove-liquidity':
      return [details.minA.contract, details.minB.contract];
    case 'vault-deposit':
    case 'vault-withdraw':
      return findKnownVault(call.contractId, network)?.assets ?? [];
  }
};

/** Decode and identify every contract invocation in a transaction's operations. */
export const analyzeOperations = (operations: TxOperation[], network: NetworkId): AnalyzedCall[] =>
  operations
    .map((op, i) => decodeCall(op, i))
    .filter((call): call is ContractCall => call !== null)
    .map((call) => {
      const match = matchProtocol(call, network);
      const details = match?.signature ? extractDetails(call, match.signature) : null;
      const named = match?.signature
        ? call.args.map((arg, i) => ({ ...arg, name: match.signature!.params[i] ?? arg.name }))
        : call.args;

      return {
        ...call,
        args: named,
        match,
        intent: match?.signature?.intent ?? null,
        details,
        tokens: collectTokens(details, call, network),
      };
    });

/** The single protocol a transaction belongs to, or null when it's mixed/unknown. */
export const dominantProtocol = (calls: AnalyzedCall[]): ProtocolId | null => {
  const protocols = new Set(calls.map((c) => c.match?.protocol).filter(Boolean) as ProtocolId[]);
  return protocols.size === 1 ? [...protocols][0] : null;
};
