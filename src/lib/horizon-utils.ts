import { createHorizonServer } from './stellar';

// Shared constants for filtering transactions/payments
const MIN_NATIVE_PAYMENT_XLM = 1; // Incoming XLM payments below this are treated as spam
const ALLOWED_TYPES = ['payment', 'create_account'] as const;
export type ActivityCategory = 'transfer' | 'swap' | 'contract' | 'config';
type AssetType = 'native' | 'credit_alphanum4' | 'credit_alphanum12';

// Normalized transaction record type
export interface NormalizedTransaction {
  id: string; // Horizon paging token of the operation
  createdAt: Date;
  type: string; // Horizon operation type (e.g., payment, create_account, invoke_host_function)
  category: ActivityCategory;
  // Transfers: 'in' or 'out'. Swaps: 'out' when the account only paid, 'in' when it
  // only received, unset when it did both (a swap of its own funds).
  direction?: 'in' | 'out';
  amount?: number; // In units of the transaction asset
  assetType?: AssetType;
  assetCode?: string;
  assetIssuer?: string;
  // For swaps, include both legs when available
  swapFromAmount?: number;
  swapFromAssetType?: AssetType;
  swapFromAssetCode?: string;
  swapFromAssetIssuer?: string;
  swapToAmount?: number;
  swapToAssetType?: AssetType;
  swapToAssetCode?: string;
  swapToAssetIssuer?: string;
  counterparty?: string;
  transactionHash: string;
}

// One asset amount; signed when it is a balance change.
interface Leg {
  amount: number;
  assetType: AssetType;
  assetCode?: string;
  assetIssuer?: string;
}

// Horizon omits the code for native XLM.
const legAsset = (assetType?: string, assetCode?: string, assetIssuer?: string): Omit<Leg, 'amount'> =>
  assetCode
    ? { assetType: (assetType || 'credit_alphanum4') as AssetType, assetCode, assetIssuer }
    : { assetType: 'native', assetCode: 'XLM', assetIssuer: undefined };

const swapFields = (from: Leg, to: Leg) => ({
  swapFromAmount: from.amount,
  swapFromAssetType: from.assetType,
  swapFromAssetCode: from.assetCode,
  swapFromAssetIssuer: from.assetIssuer,
  swapToAmount: to.amount,
  swapToAssetType: to.assetType,
  swapToAssetCode: to.assetCode,
  swapToAssetIssuer: to.assetIssuer,
});

// Identifies an asset by type, code and issuer ('native' for XLM).
export const assetKey = (assetType?: string, assetCode?: string, assetIssuer?: string): string =>
  assetType === 'native' ? 'native' : `${assetCode ?? ''}:${assetIssuer ?? ''}`;

// Signed balance changes an entry caused for the account. A swap changes one
// balance per side the account took part in; entries without an amount change
// nothing we know of.
export const getBalanceDeltas = (tx: NormalizedTransaction): Leg[] => {
  if (tx.category === 'swap') {
    const deltas: Leg[] = [];
    if (tx.direction !== 'in') {
      deltas.push({ ...legAsset(tx.swapFromAssetType, tx.swapFromAssetCode, tx.swapFromAssetIssuer), amount: -(tx.swapFromAmount ?? 0) });
    }
    if (tx.direction !== 'out') {
      deltas.push({ ...legAsset(tx.swapToAssetType, tx.swapToAssetCode, tx.swapToAssetIssuer), amount: tx.swapToAmount ?? 0 });
    }
    return deltas;
  }
  if (!tx.direction || !tx.amount || !tx.assetType) return [];
  return [{
    assetType: tx.assetType,
    assetCode: tx.assetCode,
    assetIssuer: tx.assetIssuer,
    amount: tx.direction === 'in' ? tx.amount : -tx.amount,
  }];
};

// Retry with exponential backoff on rate limits, server errors and network
// failures. SDK errors carry Horizon's problem document, status included, on
// `response`; a request that never got an answer has no `response` at all.
export const retryWithBackoff = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const err = error as { status?: number; response?: { status?: number } } | undefined;
      const status = err?.response?.status ?? err?.status;
      const transient = status === undefined ? !err?.response : status === 429 || status >= 500;
      if (!transient || attempt >= maxRetries) throw error;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

/**
 * An entry of Horizon's /operations stream. Its fields depend on the operation type, so it is
 * read field by field (with checks) rather than through one SDK record type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HorizonRecord = Record<string, any>;

// Normalize payment record from Horizon API
const normalizePaymentRecord = (
  record: HorizonRecord,
  accountPublicKey: string
): NormalizedTransaction | null => {
  try {
    // Determine asset fields
    const isCreateAccount = record.type === 'create_account';
    const assetType: AssetType = isCreateAccount
      ? 'native'
      : (record.asset_type as AssetType);
    const assetCode: string | undefined = isCreateAccount
      ? 'XLM'
      : (record.asset_code || (record.asset_type === 'native' ? 'XLM' : undefined));
    const assetIssuer: string | undefined = isCreateAccount ? undefined : record.asset_issuer;

    // Parse amount
    const amount = isCreateAccount
      ? Math.abs(parseFloat(record.starting_balance || record.amount || '0'))
      : Math.abs(parseFloat(record.amount || '0'));

    // Determine direction and counterparty
    const [sender, recipient] = isCreateAccount ? [record.funder, record.account] : [record.from, record.to];
    let direction: 'in' | 'out';
    let counterparty: string;
    if (sender === accountPublicKey) {
      direction = 'out';
      counterparty = recipient;
    } else if (recipient === accountPublicKey) {
      direction = 'in';
      counterparty = sender;
    } else {
      return null;
    }

    // Skip self-transactions
    if (counterparty === accountPublicKey) {
      return null;
    }

    // Filter out spammy incoming XLM micro payments; what the account sends is always kept
    if (!isCreateAccount && direction === 'in' && assetType === 'native' && amount < MIN_NATIVE_PAYMENT_XLM) {
      return null;
    }

    const createdAt = new Date(record.created_at);
    // Validate the date to prevent invalid dates from causing chart issues
    if (isNaN(createdAt.getTime()) || createdAt.getTime() <= 0) {
      if (import.meta.env.DEV) {
        console.warn('Invalid transaction date:', record.created_at, 'for transaction:', record.transaction_hash);
      }
      return null;
    }

    return {
      id: record.paging_token || `${record.transaction_hash}-${record.type}`,
      createdAt,
      type: record.type,
      category: 'transfer',
      direction,
      amount,
      assetType,
      assetCode,
      assetIssuer,
      counterparty,
      transactionHash: record.transaction_hash,
    };
  } catch (error) {
    return null;
  }
};

// Normalize selected non-payment operations
const normalizeOperationRecord = (
  record: HorizonRecord,
  accountPublicKey: string
): NormalizedTransaction | null => {
  try {
    const type: string = record.type;
    const createdAt = new Date(record.created_at);

    // Validate the date to prevent invalid dates from causing chart issues
    if (isNaN(createdAt.getTime()) || createdAt.getTime() <= 0) {
      if (import.meta.env.DEV) {
        console.warn('Invalid operation date:', record.created_at, 'for operation:', record.transaction_hash);
      }
      return null;
    }

    // Contract calls. Horizon lists the Stellar Asset Contract balance changes a
    // call caused; when, netted per asset, they amount to one movement or a
    // two-asset swap for this account, show that instead of a bare call.
    if (type === 'invoke_host_function') {
      const base = {
        id: record.paging_token || `${record.transaction_hash}-${record.type}`,
        createdAt,
        type,
        transactionHash: record.transaction_hash,
      };
      const net = new Map<string, Leg & { counterparty?: string }>();
      for (const change of record.asset_balance_changes ?? []) {
        if (change.from === change.to) continue;
        const sign = change.to === accountPublicKey ? 1 : change.from === accountPublicKey ? -1 : 0;
        if (!sign) continue;
        const asset = legAsset(change.asset_type, change.asset_code, change.asset_issuer);
        const key = assetKey(asset.assetType, asset.assetCode, asset.assetIssuer);
        // Netted in stroops so float error can't leave a stray 7th decimal
        const leg = net.get(key) ?? { ...asset, amount: 0, counterparty: sign > 0 ? change.from : change.to };
        leg.amount += sign * Math.round(Math.abs(parseFloat(change.amount || '0')) * 1e7);
        net.set(key, leg);
      }
      const legs = [...net.values()]
        .filter(leg => leg.amount !== 0)
        .map(leg => ({ ...leg, amount: leg.amount / 1e7 }));
      const outs = legs.filter(leg => leg.amount < 0);
      const ins = legs.filter(leg => leg.amount > 0);

      if (legs.length === 1) {
        const [{ counterparty, ...leg }] = legs;
        return {
          ...base,
          category: 'transfer',
          direction: leg.amount > 0 ? 'in' : 'out',
          ...leg,
          amount: Math.abs(leg.amount),
          counterparty: counterparty || undefined,
        };
      }
      if (outs.length === 1 && ins.length === 1) {
        const from = { ...outs[0], amount: -outs[0].amount };
        return {
          ...base,
          category: 'swap',
          amount: from.amount,
          assetType: from.assetType,
          assetCode: from.assetCode,
          assetIssuer: from.assetIssuer,
          ...swapFields(from, ins[0]),
        };
      }
      return { ...base, category: 'contract' };
    }

    // Config operations
    const configTypes = new Set([
      'change_trust',
      'set_options',
      'set_trust_line_flags',
      'manage_data',
      'allow_trust',
      'revoke_sponsorship',
    ]);
    if (configTypes.has(type)) {
      return {
        id: record.paging_token || `${record.transaction_hash}-${record.type}`,
        createdAt,
        type,
        category: 'config',
        transactionHash: record.transaction_hash,
      };
    }

    // Account merge (treat as transfer without amount)
    if (type === 'account_merge') {
      const direction: 'in' | 'out' = record.account === accountPublicKey ? 'out' : 'in';
      const counterparty = direction === 'out' ? record.into : record.account;
      return {
        id: record.paging_token || `${record.transaction_hash}-${record.type}`,
        createdAt,
        type,
        category: 'transfer',
        direction,
        counterparty,
        transactionHash: record.transaction_hash,
      };
    }

    // Clawback of this account's holding by the asset issuer
    if (type === 'clawback' && record.from === accountPublicKey) {
      return {
        id: record.paging_token || `${record.transaction_hash}-${record.type}`,
        createdAt,
        type,
        category: 'transfer',
        direction: 'out',
        amount: Math.abs(parseFloat(record.amount || '0')),
        ...legAsset(record.asset_type, record.asset_code, record.asset_issuer),
        counterparty: record.asset_issuer,
        transactionHash: record.transaction_hash,
      };
    }

    // Path payments as swaps
    if (type === 'path_payment_strict_receive' || type === 'path_payment_strict_send') {
      const paid = record.from === accountPublicKey;
      const received = record.to === accountPublicKey;
      if (!paid && !received) return null;

      // The source leg is in source_asset_*, the destination leg in asset_* for both kinds.
      const from: Leg = {
        amount: Math.abs(parseFloat(record.source_amount || '0')),
        ...legAsset(record.source_asset_type, record.source_asset_code, record.source_asset_issuer),
      };
      const to: Leg = {
        amount: Math.abs(parseFloat(record.amount || '0')),
        ...legAsset(record.asset_type, record.asset_code, record.asset_issuer),
      };
      // Primary impact: what left the account, or what arrived if nothing left it
      const primary = paid ? from : to;

      return {
        id: record.paging_token || `${record.transaction_hash}-${record.type}`,
        createdAt,
        type,
        category: 'swap',
        direction: paid && received ? undefined : paid ? 'out' : 'in',
        amount: primary.amount,
        assetType: primary.assetType,
        assetCode: primary.assetCode,
        assetIssuer: primary.assetIssuer,
        ...swapFields(from, to),
        counterparty: paid && received ? undefined : paid ? record.to : record.from,
        transactionHash: record.transaction_hash,
      };
    }

    return null;
  } catch (error) {
    return null;
  }
};

// Normalize one record of an account's operations stream, or null when it is not listed.
export const normalizeRecord = (record: HorizonRecord, accountPublicKey: string): NormalizedTransaction | null =>
  (ALLOWED_TYPES as readonly string[]).includes(record.type)
    ? normalizePaymentRecord(record, accountPublicKey)
    : normalizeOperationRecord(record, accountPublicKey);

// Fetch one page of an account's operations (payments included). Not cached:
// the newest page must always be fresh, and older pages are only asked for once.
export const fetchAccountOperations = async (
  publicKey: string,
  network: 'mainnet' | 'testnet',
  cursor?: string,
  limit: number = 200,
  order: 'asc' | 'desc' = 'desc'
) => {
  const server = createHorizonServer(network);

  let query = server
    .operations()
    .forAccount(publicKey)
    .order(order)
    .limit(limit);

  if (cursor) {
    query = query.cursor(cursor);
  }

  return retryWithBackoff(() => query.call());
};
