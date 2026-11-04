import { Address, Asset, Operation, scValToNative, type Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { appConfig } from '@/lib/appConfig';
import { passphraseFor, tryParseTransaction } from '@/lib/xdr/parse';
import { analyzeOperations, fitsSignature, type ActivityDetails, type AnalyzedCall } from './detect';
import { findKnownVault, PROTOCOL_LABELS, type NetworkId, type ProtocolId } from './registry';

/**
 * Checks on a transaction the Soroswap or DeFindex API built for us, before it
 * reaches signing. The API is a third party: its XDR must make exactly the call
 * the user asked for — from this account, to a contract we pin, with the
 * amounts they typed and bounds the app computed, on the account's next
 * sequence number and expiring within the app's validity window — or it is refused.
 */

/**
 * What the user asked for, in contract units. Bounds (minOut, maxIn, minA…) are
 * computed by the app from the user's slippage, never taken from the API.
 */
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
      /** The pair is absent or empty on chain: the deposit sets its price, so a minimum of 0 is fine. */
      newPool: boolean;
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
  | { kind: 'vault-withdraw'; vault: string; shares: bigint; minAmountsOut: bigint[] };

/** The account as the network sees it right now, read by the app (not the API). */
export interface AccountState {
  /** The account's current sequence number: the transaction must use the next one. */
  sequence: bigint;
  /** Unix seconds; defaults to the clock. */
  now?: number;
}

type Kind = ExpectedCall['kind'];
type SwapCall = Extract<ExpectedCall, { kind: 'swap' }>;

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

/** Room for the API's clock running ahead of ours when checking the expiry. */
const CLOCK_SKEW_SECONDS = 300;

/**
 * The most Soroswap's fee on an SDEX route may take, in basis points of the swap's
 * amount in the fee's token. The API charges it as a payment beside the path
 * payment, to a wallet the app cannot pin, so it is capped instead.
 */
const MAX_SDEX_FEE_BPS = 100n;
const BPS = 10_000n;

const PATH_PAYMENTS = ['pathPaymentStrictSend', 'pathPaymentStrictReceive'];

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
        if (amountOf(leg.min.raw) <= 0n && !expected.newPool) return 'has no minimum on a pool that already has a price';
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
      const floors = expected.minAmountsOut;
      const mins = details.minAmountsOut;
      if (mins.length !== floors.length || mins.some((raw, i) => amountOf(raw) < floors[i])) {
        return 'guarantees less than the amount you are withdrawing';
      }
      return null;
    }
  }
};

/**
 * The envelope's expiry, once its conditions are those of a plain, short-lived
 * transaction on the account's next sequence number; a string saying what is
 * wrong otherwise. Read from the raw XDR, so nothing the SDK's getters leave
 * out can slip through.
 */
const checkConditions = (tx: Transaction, state: AccountState, allowMemo: boolean): { maxTime: bigint } | string => {
  const envelope = tx.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx') return 'cannot be read';
  const { cond, memo, seqNum } = envelope.v1.tx;

  if (memo.type !== 'memoNone' && !allowMemo) return 'carries a memo';

  let timeBounds: xdr.TimeBounds | null = null;
  if (cond.type === 'precondTime') timeBounds = cond.timeBounds;
  if (cond.type === 'precondV2') {
    const v2 = cond.v2;
    if (v2.ledgerBounds) return 'is limited to a range of ledgers';
    if (v2.minSeqNum !== null || v2.minSeqAge !== 0n || v2.minSeqLedgerGap !== 0) {
      return 'has conditions on the account sequence';
    }
    if (v2.extraSigners.length) return 'requires extra signers';
    timeBounds = v2.timeBounds;
  }
  if (!timeBounds || timeBounds.maxTime === 0n) return 'never expires';
  const now = state.now ?? Math.floor(Date.now() / 1000);
  if (timeBounds.maxTime > BigInt(now + appConfig.TX_VALIDITY_SECONDS + CLOCK_SKEW_SECONDS)) {
    const hours = Math.round(Number(timeBounds.maxTime - BigInt(now)) / 3600);
    return `stays valid for ${hours} hours instead of at most ${appConfig.TX_VALIDITY_SECONDS / 3600}`;
  }

  if (seqNum !== state.sequence + 1n) {
    return `uses sequence number ${seqNum} instead of your next one (${state.sequence + 1n})`;
  }
  return { maxTime: timeBounds.maxTime };
};

/**
 * Why a classic path payment is not the requested swap, or null when it is. The
 * API builds a swap it routes through SDEX this way instead of as a contract call.
 * Assets and amounts are read from the raw XDR and compared through each asset's
 * Stellar Asset Contract, the address the swap was requested in. The hops in
 * `path` need no check: only the sent asset leaves the account, capped by the
 * exact amount or `sendMax`, and only the bought asset arrives, floored by
 * `destMin` or exact.
 */
const pathPaymentMismatch = (
  tx: Transaction,
  index: number,
  network: NetworkId,
  account: string,
  expected: SwapCall,
  /** Soroswap's fee when it is paid in the sold token: taken out of what is sold, so the two add up. */
  feeIn: bigint,
): string | null => {
  const op = tx.operations[index];
  if (op.type !== 'pathPaymentStrictSend' && op.type !== 'pathPaymentStrictReceive') return 'is not a swap';
  if (op.destination !== account) return `pays ${op.destination} instead of your account`;

  const raw = rawOperation(tx, index);
  if (!raw) return 'cannot be read';
  const { body } = raw;
  const contractOf = (asset: xdr.Asset) => sacOf(asset, network);

  if (body.type === 'pathPaymentStrictSend') {
    if (expected.exact !== 'in') return 'sells an exact amount instead of buying one';
    const { sendAsset, sendAmount, destAsset, destMin } = body.pathPaymentStrictSendOp;
    if (contractOf(sendAsset) !== expected.tokenIn || contractOf(destAsset) !== expected.tokenOut) {
      return 'swaps a different pair of tokens';
    }
    if (BigInt(sendAmount) + feeIn !== expected.amountIn) return 'sells a different amount';
    if (BigInt(destMin) < expected.minOut) return 'guarantees less than the minimum you were quoted';
    return null;
  }
  if (body.type === 'pathPaymentStrictReceive') {
    if (expected.exact !== 'out') return 'buys an exact amount instead of selling one';
    const { sendAsset, sendMax, destAsset, destAmount } = body.pathPaymentStrictReceiveOp;
    if (contractOf(sendAsset) !== expected.tokenIn || contractOf(destAsset) !== expected.tokenOut) {
      return 'swaps a different pair of tokens';
    }
    if (BigInt(destAmount) !== expected.amountOut) return 'buys a different amount';
    if (BigInt(sendMax) + feeIn > expected.maxIn) return 'may sell more than the maximum you were quoted';
    return null;
  }
  return 'cannot be read';
};

/** An operation as the envelope holds it, so amounts come as exact stroops. */
const rawOperation = (tx: Transaction, index: number): xdr.Operation | null => {
  const envelope = tx.toEnvelope();
  return envelope.type === 'envelopeTypeTx' ? (envelope.v1.tx.operations[index] ?? null) : null;
};

/** The Stellar Asset Contract of a classic asset, the address swaps are requested in. */
const sacOf = (asset: xdr.Asset, network: NetworkId): string | null => {
  try {
    return Asset.fromOperation(asset).contractId(passphraseFor(network));
  } catch {
    return null;
  }
};

/**
 * Where the path payment and Soroswap's fee payment sit, when the operations
 * read as a swap routed through SDEX; null when they do not.
 */
const sdexLayout = (tx: Transaction): { swap: number; fee: number | null } | null => {
  const ops = tx.operations;
  const swap = ops.findIndex((op) => PATH_PAYMENTS.includes(op.type));
  if (swap < 0 || ops.length > 2) return null;
  const fee = ops.length === 2 ? 1 - swap : null;
  if (fee !== null && ops[fee].type !== 'payment') return null;
  return { swap, fee };
};

/**
 * Why the fee payment beside an SDEX swap is not one the swap can carry, or null
 * when it is: paid in one of the swapped tokens, and at most MAX_SDEX_FEE_BPS of
 * the swap's bounded amount in that token.
 */
const feeMismatch = (fee: FeePayment | null, expected: SwapCall): string | null => {
  if (!fee) return 'cannot be read';
  const { token, amount } = fee;
  const exactIn = expected.exact === 'in';
  let base: bigint;
  if (token === expected.tokenIn) base = exactIn ? expected.amountIn : expected.maxIn;
  else if (token === expected.tokenOut) base = exactIn ? expected.minOut : expected.amountOut;
  else return 'pays a fee in a token the swap does not trade';

  if (amount <= 0n || amount * BPS > base * MAX_SDEX_FEE_BPS) {
    return `pays a fee above ${Number(MAX_SDEX_FEE_BPS) / 100}% of the swap`;
  }
  return null;
};

interface FeePayment {
  token: string | null;
  amount: bigint;
}

/** The fee payment's token and exact amount, or null when it cannot be read. */
const readFee = (tx: Transaction, index: number, network: NetworkId): FeePayment | null => {
  const raw = rawOperation(tx, index);
  if (!raw || raw.body.type !== 'payment') return null;
  const { asset, amount } = raw.body.paymentOp;
  return { token: sacOf(asset, network), amount: BigInt(amount) };
};

/** Why an SDEX swap, with or without its fee payment, is not the requested one, or null when it is. */
const sdexMismatch = (
  tx: Transaction,
  layout: { swap: number; fee: number | null },
  network: NetworkId,
  account: string,
  expected: SwapCall,
  state: AccountState,
): string | null => {
  // The API tags SDEX swaps with a memo; harmless here, since the swap must land
  // in the account itself, so no exchange or custodian reads it to credit anyone.
  const conditions = checkConditions(tx, state, true);
  if (typeof conditions === 'string') return conditions;
  const foreign = tx.operations.find((op) => op.source && op.source !== account);
  if (foreign) return `runs its operation from ${foreign.source}`;
  if (layout.fee === null) return pathPaymentMismatch(tx, layout.swap, network, account, expected, 0n);
  const fee = readFee(tx, layout.fee, network);
  const feeIn = fee && fee.token === expected.tokenIn ? fee.amount : 0n;
  return feeMismatch(fee, expected) ?? pathPaymentMismatch(tx, layout.swap, network, account, expected, feeIn);
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
  state: AccountState,
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
  // A swap routed through SDEX comes back as a classic path payment, plus Soroswap's fee payment
  const sdex = expected.kind === 'swap' ? sdexLayout(tx) : null;
  if (sdex && expected.kind === 'swap') {
    const reason = sdexMismatch(tx, sdex, network, account, expected, state);
    if (reason) throw refusal(reason);
    return;
  }

  const conditions = checkConditions(tx, state, false);
  if (typeof conditions === 'string') throw refusal(conditions);
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

  // A router `deadline` needs no check of its own: the transaction's expiry bounds it.
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
 * Give an API-built transaction that never expires, or expires later than the ones the app
 * builds itself, the app's validity window, so a half-signed swap or deposit cannot be
 * submitted weeks later. Only the time bounds change; anything else is returned untouched.
 */
export const withExpiry = (envelope: string, network: NetworkId): string => {
  const parsed = tryParseTransaction(envelope, network);
  if (!parsed || parsed.isFeeBump) return envelope;
  const tx = parsed.tx as Transaction;
  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  if (maxTime > 0 && maxTime <= Math.floor(Date.now() / 1000) + appConfig.TX_VALIDITY_SECONDS) return envelope;

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
