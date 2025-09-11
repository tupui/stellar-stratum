import { createHorizonServer } from './stellar';

// Shared constants for filtering transactions/payments
export const MIN_NATIVE_PAYMENT_XLM = 1; // Minimum XLM amount to avoid spam
export const ALLOWED_TYPES = ['payment', 'create_account'] as const;
export type ActivityCategory = 'transfer' | 'swap' | 'contract' | 'config';

// Cache durations
export const TRANSACTION_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// API-level caching for Horizon requests
interface HorizonCacheEntry {
  data: unknown;
  timestamp: number;
  ttl: number;
}

const horizonCache = new Map<string, HorizonCacheEntry>();
const HORIZON_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for API responses

// Normalized transaction record type
export interface NormalizedTransaction {
  id: string;
  createdAt: Date;
  type: string; // Horizon operation type (e.g., payment, create_account, invoke_host_function)
  category: ActivityCategory;
  direction?: 'in' | 'out';
  amount?: number; // In units of the transaction asset
  assetType?: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  assetCode?: string;
  assetIssuer?: string;
  // For swaps, include both legs when available
  swapFromAmount?: number;
  swapFromAssetType?: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  swapFromAssetCode?: string;
  swapFromAssetIssuer?: string;
  swapToAmount?: number;
  swapToAssetType?: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  swapToAssetCode?: string;
  swapToAssetIssuer?: string;
  counterparty?: string;
  transactionHash: string;
}

// Retry with exponential backoff for rate limit errors
export const retryWithBackoff = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isRateLimit = (error as { status?: number })?.status === 429 || (error as { status?: number })?.status === 503;
      if (isRateLimit && i < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 10000); // Exponential backoff, max 10s
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
};

// Normalize payment record from Horizon API
export const normalizePaymentRecord = (
  record: any, 
  accountPublicKey: string
): NormalizedTransaction | null => {
  try {
    // Only process allowed transaction types
    if (!ALLOWED_TYPES.includes(record.type)) {
      return null;
    }

    // Determine asset fields
    const isCreateAccount = record.type === 'create_account';
    const assetType: 'native' | 'credit_alphanum4' | 'credit_alphanum12' = isCreateAccount
      ? 'native'
      : (record.asset_type as any);
    const assetCode: string | undefined = isCreateAccount
      ? 'XLM'
      : (record.asset_code || (record.asset_type === 'native' ? 'XLM' : undefined));
    const assetIssuer: string | undefined = isCreateAccount ? undefined : record.asset_issuer;

    // Parse amount
    const amount = isCreateAccount
      ? Math.abs(parseFloat(record.starting_balance || record.amount || '0'))
      : Math.abs(parseFloat(record.amount || '0'));

    // For native XLM only, filter out spammy micro txs
    if (assetType === 'native' && amount < MIN_NATIVE_PAYMENT_XLM) {
      return null;
    }

    // Determine direction and counterparty
    let direction: 'in' | 'out';
    let counterparty: string;

    if (isCreateAccount) {
      if (record.funder === accountPublicKey) {
        direction = 'out';
        counterparty = record.account;
      } else {
        direction = 'in';
        counterparty = record.funder;
      }
    } else {
      if (record.from === accountPublicKey) {
        direction = 'out';
        counterparty = record.to;
      } else {
        direction = 'in';
        counterparty = record.from;
      }
    }

    // Skip self-transactions
    if (counterparty === accountPublicKey) {
      return null;
    }

    return {
      id: record.paging_token || `${record.transaction_hash}-${record.type}`,
      createdAt: new Date(record.created_at),
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
export const normalizeOperationRecord = (
  record: any,
  accountPublicKey: string
): NormalizedTransaction | null => {
  try {
    const type: string = record.type;
    const createdAt = new Date(record.created_at);

    // Contract calls
    if (type === 'invoke_host_function') {
      return {
        id: record.paging_token || `${record.transaction_hash}-${record.type}`,
        createdAt,
        type,
        category: 'contract',
        transactionHash: record.transaction_hash,
      };
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

    // Path payments as swaps
    if (type === 'path_payment_strict_receive' || type === 'path_payment_strict_send') {
      // Represent the balance impact for this account
      let direction: 'in' | 'out' = 'out';
      let amount = 0;
      let assetType: any = 'native';
      let assetCode: string | undefined = 'XLM';
      let assetIssuer: string | undefined;
      let counterparty: string | undefined;

      // Swap legs (best-effort based on available fields)
      let swapFromAmount: number | undefined;
      let swapFromAssetType: any | undefined;
      let swapFromAssetCode: string | undefined;
      let swapFromAssetIssuer: string | undefined;
      let swapToAmount: number | undefined;
      let swapToAssetType: any | undefined;
      let swapToAssetCode: string | undefined;
      let swapToAssetIssuer: string | undefined;

      if (record.from === accountPublicKey) {
        direction = 'out';
        // From leg
        swapFromAmount = Math.abs(parseFloat(record.source_amount || '0'));
        swapFromAssetType = record.source_asset_type || 'native';
        swapFromAssetCode = record.source_asset_code || (swapFromAssetType === 'native' ? 'XLM' : undefined);
        swapFromAssetIssuer = record.source_asset_issuer;
        // To leg - different fields for strict_send vs strict_receive
        if (type === 'path_payment_strict_send') {
          // For strict_send, destination is in dest_* fields
          swapToAmount = Math.abs(parseFloat(record.destination_amount || record.amount || '0'));
          swapToAssetType = record.dest_asset_type || 'native';
          swapToAssetCode = record.dest_asset_code || (swapToAssetType === 'native' ? 'XLM' : undefined);
          swapToAssetIssuer = record.dest_asset_issuer;
        } else {
          // For strict_receive, destination is in regular asset_* fields
          swapToAmount = Math.abs(parseFloat(record.amount || '0'));
          swapToAssetType = record.asset_type || 'native';
          swapToAssetCode = record.asset_code || (swapToAssetType === 'native' ? 'XLM' : undefined);
          swapToAssetIssuer = record.asset_issuer;
        }
        // Primary impact uses the leg affecting our balance first (outgoing leg)
        amount = swapFromAmount || 0;
        assetType = swapFromAssetType;
        assetCode = swapFromAssetCode;
        assetIssuer = swapFromAssetIssuer;
        counterparty = record.to;
      } else if (record.to === accountPublicKey) {
        direction = 'in';
        // From leg (what sender spent)
        swapFromAmount = Math.abs(parseFloat(record.source_amount || '0'));
        swapFromAssetType = record.source_asset_type || 'native';
        swapFromAssetCode = record.source_asset_code || (swapFromAssetType === 'native' ? 'XLM' : undefined);
        swapFromAssetIssuer = record.source_asset_issuer;
        // To leg (what we received)
        swapToAmount = Math.abs(parseFloat(record.amount || '0'));
        swapToAssetType = record.asset_type || 'native';
        swapToAssetCode = record.asset_code || (swapToAssetType === 'native' ? 'XLM' : undefined);
        swapToAssetIssuer = record.asset_issuer;
        // Primary impact is what we received
        amount = swapToAmount || 0;
        assetType = swapToAssetType;
        assetCode = swapToAssetCode;
        assetIssuer = swapToAssetIssuer;
        counterparty = record.from;
      }

      return {
        id: record.paging_token || `${record.transaction_hash}-${record.type}`,
        createdAt,
        type,
        category: 'swap',
        direction,
        amount,
        assetType,
        assetCode,
        assetIssuer,
        swapFromAmount,
        swapFromAssetType,
        swapFromAssetCode,
        swapFromAssetIssuer,
        swapToAmount,
        swapToAssetType,
        swapToAssetCode,
        swapToAssetIssuer,
        counterparty,
        transactionHash: record.transaction_hash,
      };
    }

    return null;
  } catch (error) {
    return null;
  }
};

// Helper to get/set cache with TTL
const getCachedResponse = (key: string): unknown | null => {
  const entry = horizonCache.get(key);
  if (!entry) return null;
  
  if (Date.now() - entry.timestamp > entry.ttl) {
    horizonCache.delete(key);
    return null;
  }
  
  return entry.data;
};

const setCachedResponse = (key: string, data: unknown, ttl: number = HORIZON_CACHE_TTL) => {
  horizonCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl,
  });
};

// Fetch paginated payments for an account
export const fetchAccountPayments = async (
  publicKey: string,
  network: 'mainnet' | 'testnet',
  cursor?: string,
  limit: number = 200
) => {
  // Create cache key based on all parameters
  const cacheKey = `payments-${publicKey}-${network}-${cursor || 'initial'}-${limit}`;
  
  // Check cache first
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return cached;
  }
  
  const server = createHorizonServer(network);
  
  let query = server
    .payments()
    .forAccount(publicKey)
    .order('desc')
    .limit(limit);
    
  if (cursor) {
    query = query.cursor(cursor);
  }
  
  const result = await retryWithBackoff(() => query.call());
  
  // Cache the result
  setCachedResponse(cacheKey, result);
  
  return result;
};

// Fetch selected non-payment operations for an account
export const fetchAccountOperations = async (
  publicKey: string,
  network: 'mainnet' | 'testnet',
  cursor?: string,
  limit: number = 200
) => {
  // Create cache key based on all parameters
  const cacheKey = `operations-${publicKey}-${network}-${cursor || 'initial'}-${limit}`;
  
  // Check cache first
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return cached;
  }

  const server = createHorizonServer(network);

  let query = server
    .operations()
    .forAccount(publicKey)
    .order('desc')
    .limit(limit)
    .join('transactions');

  if (cursor) {
    query = query.cursor(cursor);
  }

  const result = await retryWithBackoff(() => query.call());
  
  // Cache the result
  setCachedResponse(cacheKey, result);

  return result;
};

// Get Horizon transaction URL for external viewing
export const getHorizonTransactionUrl = (
  network: 'mainnet' | 'testnet',
  transactionHash: string
): string => {
  const baseUrl = network === 'testnet' 
    ? 'https://horizon-testnet.stellar.org' 
    : 'https://horizon.stellar.org';
  return `${baseUrl}/transactions/${transactionHash}`;
};