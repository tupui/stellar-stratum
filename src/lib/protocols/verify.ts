import { Address, Operation, scValToNative, type Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { appConfig } from '@/lib/appConfig';
import { tryParseTransaction } from '@/lib/xdr/parse';
import { analyzeOperations, fitsSignature, type ActivityDetails } from './detect';
import { findKnownVault, PROTOCOL_LABELS, type NetworkId, type ProtocolId } from './registry';

/**
 * Checks on a transaction the Soroswap or DeFindex API built for us, before it
 * reaches signing. The API is a third party: its XDR must make exactly the call
 * the user asked for — from this account, to a contract we pin, with the
 * amounts they typed or were quoted — or it is refused.
 */

/** What the user asked for, in contract units. */
export type ExpectedCall =
  | { kind: 'swap'; exact: 'in'; tokenIn: string; tokenOut: string; amountIn: bigint; minOut: bigint }
  | { kind: 'swap'; exact: 'out'; tokenIn: string; tokenOut: string; amountOut: bigint; maxIn: bigint }
  | {
      kind: 'add-liquidity';
      tokenA: string;
      tokenB: string;
      amountA: bigint;
      amountB: bigint;
      minA: bigint;
      minB: bigint;
    }
  | {
      kind: 'remove-liquidity';
      /** The pair contract, which is also the LP token being burnt. */
      pool: string;
      tokenA: string;
      tokenB: string;
      liquidity: bigint;
      minA: bigint;
      minB: bigint;
    }
  | { kind: 'vault-deposit'; vault: string; amounts: bigint[]; invest: boolean }
  | { kind: 'vault-withdraw'; vault: string; shares: bigint };

type Kind = ExpectedCall['kind'];

const PROTOCOL: Record<Kind, ProtocolId> = {
  swap: 'soroswap',
  'add-liquidity': 'soroswap',
  'remove-liquidity': 'soroswap',
  'vault-deposit': 'defindex',
  'vault-withdraw': 'defindex',
};

/** Deployments allowed to receive each kind of call. */
const ROLES: Record<Kind, string[]> = {
  swap: ['Aggregator', 'Router'],
  'add-liquidity': ['Router'],
  'remove-liquidity': ['Router'],
  'vault-deposit': ['Vault'],
  'vault-withdraw': ['Vault'],
};

/** Arguments naming whose funds move or where they land: all must be the account. */
const ACCOUNT_PARAMS = ['from', 'to', 'caller'];

/** Soroban fees are a fraction of an XLM; a fee this large is a drain, not a fee. */
const MAX_FEE_STROOPS = 100_000_000n;

const amountOf = (raw: string) => BigInt(raw);

/** Why the decoded call does not match the request, or null when it does. */
const mismatch = (details: ActivityDetails, expected: ExpectedCall): string | null => {
  switch (expected.kind) {
    case 'swap': {
      if (details.kind !== 'swap') return 'is not a swap';
      const { sell, buy } = details;
      if (sell.contract !== expected.tokenIn || buy.contract !== expected.tokenOut) {
        return 'swaps a different pair of tokens';
      }
      if (expected.exact === 'in') {
        if (sell.bound !== 'exact' || amountOf(sell.raw) !== expected.amountIn) return 'sells a different amount';
        if (buy.bound !== 'min' || amountOf(buy.raw) < expected.minOut) {
          return 'guarantees less than the minimum you were quoted';
        }
      } else {
        if (buy.bound !== 'exact' || amountOf(buy.raw) !== expected.amountOut) return 'buys a different amount';
        if (sell.bound !== 'max' || amountOf(sell.raw) > expected.maxIn) {
          return 'may sell more than the maximum you were quoted';
        }
      }
      return null;
    }

    case 'add-liquidity': {
      if (details.kind !== 'add-liquidity') return 'does not add liquidity';
      // The router takes the pair in either order; match each leg by token.
      const legs = [
        { desired: details.desiredA, min: details.minA },
        { desired: details.desiredB, min: details.minB },
      ];
      for (const [token, amount, min] of [
        [expected.tokenA, expected.amountA, expected.minA],
        [expected.tokenB, expected.amountB, expected.minB],
      ] as const) {
        const leg = legs.find((l) => l.desired.contract === token && l.min.contract === token);
        if (!leg) return 'adds liquidity to a different pool';
        if (amountOf(leg.desired.raw) !== amount) return 'deposits different amounts';
        if (amountOf(leg.min.raw) < min) return 'allows more slippage than requested';
      }
      return null;
    }

    case 'remove-liquidity': {
      if (details.kind !== 'remove-liquidity') return 'does not remove liquidity';
      if (amountOf(details.liquidity) !== expected.liquidity) return 'burns a different amount of pool shares';
      const mins = [details.minA, details.minB];
      for (const [token, min] of [
        [expected.tokenA, expected.minA],
        [expected.tokenB, expected.minB],
      ] as const) {
        const leg = mins.find((m) => m.contract === token);
        if (!leg) return 'withdraws from a different pool';
        if (amountOf(leg.raw) < min) return 'allows more slippage than requested';
      }
      return null;
    }

    case 'vault-deposit': {
      if (details.kind !== 'vault-deposit') return 'is not a vault deposit';
      const same =
        details.amounts.length === expected.amounts.length &&
        details.amounts.every((raw, i) => amountOf(raw) === expected.amounts[i]);
      if (!same) return 'deposits a different amount';
      if (details.invest !== expected.invest) return 'changes whether the deposit is invested';
      return null;
    }

    case 'vault-withdraw': {
      if (details.kind !== 'vault-withdraw') return 'is not a vault withdrawal';
      if (amountOf(details.shares) !== expected.shares) return 'redeems a different number of shares';
      return null;
    }
  }
};

/** Token contract → the most the account may be asked to transfer of it. */
const allowances = (expected: ExpectedCall, network: NetworkId): Map<string, bigint> => {
  switch (expected.kind) {
    case 'swap':
      return new Map([[expected.tokenIn, expected.exact === 'in' ? expected.amountIn : expected.maxIn]]);
    case 'add-liquidity':
      return new Map([
        [expected.tokenA, expected.amountA],
        [expected.tokenB, expected.amountB],
      ]);
    case 'remove-liquidity':
      return new Map([[expected.pool, expected.liquidity]]);
    case 'vault-deposit': {
      const assets = findKnownVault(expected.vault, network)?.assets ?? [];
      return new Map(assets.map((asset, i) => [asset, expected.amounts[i] ?? 0n]));
    }
    case 'vault-withdraw':
      return new Map([[expected.vault, expected.shares]]);
  }
};

const sameArgs = (a: xdr.ScVal[], b: xdr.ScVal[]) =>
  a.length === b.length && a.every((arg, i) => arg.toXDR('base64') === b[i].toXDR('base64'));

/**
 * Refuse an API-built transaction unless it is exactly the requested call.
 * Throws an Error whose message says what was wrong; returns nothing otherwise.
 */
export const verifyProtocolTransaction = (
  envelope: string,
  network: NetworkId,
  account: string,
  expected: ExpectedCall,
): void => {
  const protocol = PROTOCOL[expected.kind];
  const refusal = (reason: string) =>
    new Error(`The ${PROTOCOL_LABELS[protocol]} API returned a transaction that ${reason}. It was not loaded for signing.`);

  const parsed = tryParseTransaction(envelope, network);
  if (!parsed) throw refusal('cannot be read');
  if (parsed.isFeeBump) throw refusal('is wrapped in a fee bump');
  const tx = parsed.tx as Transaction;

  if (tx.source !== account) throw refusal(`uses ${tx.source} as its source account instead of yours`);
  if (BigInt(tx.fee) > MAX_FEE_STROOPS) throw refusal(`asks for a ${Number(tx.fee) / 1e7} XLM fee`);
  if (!tx.timeBounds || tx.timeBounds.maxTime === '0') throw refusal('never expires');
  if (tx.operations.length !== 1) throw refusal(`has ${tx.operations.length} operations instead of one contract call`);

  const [op] = tx.operations;
  if (op.type !== 'invokeHostFunction') throw refusal(`makes a ${op.type} operation instead of a contract call`);
  if (op.source && op.source !== account) throw refusal(`runs its operation from ${op.source}`);

  const { func, auth = [] } = op as Operation.InvokeHostFunction;
  const [call] = analyzeOperations([op], network);
  if (func.type !== 'hostFunctionTypeInvokeContract' || !call) throw refusal('does not call a contract');

  const { match } = call;
  const roles = ROLES[expected.kind];
  if (match?.networkMismatch) throw refusal(`calls the ${match.networkMismatch} deployment instead of ${network}`);
  if (!match || match.confidence !== 'verified' || match.protocol !== protocol || !roles.includes(match.role)) {
    throw refusal(`calls ${call.contractId}, which is not the ${PROTOCOL_LABELS[protocol]} ${roles.join(' or ')} the app knows`);
  }
  if ('vault' in expected && (call.contractId !== expected.vault || !findKnownVault(expected.vault, network))) {
    throw refusal(`calls ${call.contractId} instead of the vault ${expected.vault}`);
  }

  const signature = match.signature;
  if (!signature || signature.role !== match.role || !fitsSignature(call, signature) || !call.details) {
    throw refusal(`calls ${call.functionName} in a form the app cannot check`);
  }

  const foreign = call.args.find((arg) => ACCOUNT_PARAMS.includes(arg.name) && arg.value !== account);
  if (foreign) throw refusal(`sets ${foreign.name} to ${String(foreign.value)} instead of your account`);

  const reason = mismatch(call.details, expected);
  if (reason) throw refusal(reason);

  // Authorization may only cover this very call, plus token transfers out of
  // the account that the request itself implies.
  const allowance = allowances(expected, network);

  const isAllowedTransfer = (node: xdr.SorobanAuthorizedInvocation): boolean => {
    const fn = node.function;
    if (fn.type !== 'sorobanAuthorizedFunctionTypeContractFn' || node.subInvocations.length) return false;
    const { contractAddress, functionName, args } = fn.contractFn;
    if (functionName.toString() !== 'transfer' || args.length !== 3) return false;
    if (args[0].type !== 'scvAddress' || args[1].type !== 'scvAddress' || args[2].type !== 'scvI128') return false;
    const token = Address.fromScAddress(contractAddress).toString();
    const left = allowance.get(token);
    const amount = scValToNative(args[2]) as bigint;
    if (scValToNative(args[0]) !== account || left === undefined || amount < 0n || amount > left) return false;
    allowance.set(token, left - amount);
    return true;
  };

  for (const entry of auth) {
    if (entry.credentials.type !== 'sorobanCredentialsSourceAccount') {
      throw refusal('needs an authorization signed outside the transaction');
    }
    const root = entry.rootInvocation.function;
    const authorizesThisCall =
      root.type === 'sorobanAuthorizedFunctionTypeContractFn' &&
      Address.fromScAddress(root.contractFn.contractAddress).toString() === call.contractId &&
      root.contractFn.functionName.toString() === call.functionName &&
      sameArgs(root.contractFn.args, func.invokeContract.args);
    if (!authorizesThisCall) throw refusal('authorizes a different call than the one it makes');
    if (!entry.rootInvocation.subInvocations.every(isAllowedTransfer)) {
      throw refusal('authorizes moving more of your funds than the request needs');
    }
  }
};

/**
 * Give a transaction that never expires the validity window of the ones the
 * app builds itself, so a half-signed deposit cannot be submitted weeks later.
 * Only the time bounds change; anything else is returned untouched.
 */
export const withExpiry = (envelope: string, network: NetworkId): string => {
  const parsed = tryParseTransaction(envelope, network);
  if (!parsed || parsed.isFeeBump) return envelope;
  const tx = parsed.tx as Transaction;
  if (tx.timeBounds && tx.timeBounds.maxTime !== '0') return envelope;

  const body = tx.toEnvelope().value.tx;
  const sorobanData = 'ext' in body && body.ext.type === 'sorobanData' ? body.ext.value : undefined;
  const builder = TransactionBuilder.cloneFrom(tx, {
    timebounds: {
      minTime: tx.timeBounds?.minTime ?? 0,
      maxTime: Math.floor(Date.now() / 1000) + appConfig.TX_VALIDITY_SECONDS,
    },
  });
  if (sorobanData) builder.setSorobanData(sorobanData);
  return builder.build().toXDR();
};
