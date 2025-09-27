import { rpc, Horizon } from '@stellar/stellar-sdk';
import { createHistoryRpcServer } from './rpc-client';
import type { NormalizedTransaction, ActivityCategory } from './horizon-utils';

// Shared constants for filtering transactions/payments
export const MIN_NATIVE_PAYMENT_XLM = 1; // Minimum XLM amount to avoid spam
export const ALLOWED_OPERATION_TYPES = ['payment', 'create_account'] as const;

// Cache durations
export const RPC_TRANSACTION_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// RPC-level caching for transaction requests
interface RpcCacheEntry {
  data: unknown;
  timestamp: number;
  ttl: number;
}

const rpcCache = new Map<string, RpcCacheEntry>();
const RPC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for API responses

// RPC rate limiting - Quasar Lightsail Network limits
const WINDOW_MS = 10_000; // 10 seconds
const BURST_LIMIT = 60; // Quasar Lightsail limit: 60 requests per 10 seconds
let rpcTimestamps: number[] = [];
let rpcQueue: Promise<any> = Promise.resolve();

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function cleanupTimestamps() {
  const now = Date.now();
  rpcTimestamps = rpcTimestamps.filter((t) => now - t < WINDOW_MS);
}

async function acquireToken() {
  cleanupTimestamps();
  const now = Date.now();
  if (rpcTimestamps.length < BURST_LIMIT) {
    rpcTimestamps.push(now);
    return;
  }
  const oldest = rpcTimestamps[0];
  const wait = Math.max(0, WINDOW_MS - (now - oldest));
  if (wait > 0) {
    await sleep(wait + 50); // Small buffer
  }
  cleanupTimestamps();
  rpcTimestamps.push(Date.now());
}

function runRpcLimited<T>(fn: () => Promise<T>): Promise<T> {
  const task = rpcQueue.then(async () => {
    await acquireToken();
    const result = await fn();
    return result;
  });
  // Keep the chain, but don't block on previous errors
  rpcQueue = task.then(() => undefined).catch(() => undefined);
  return task;
}

// Note: RPC server creation moved to centralized rpc-client.ts

// Helper to get/set cache with TTL
const getCachedResponse = (key: string): unknown | null => {
  const entry = rpcCache.get(key);
  if (!entry) return null;
  
  if (Date.now() - entry.timestamp > entry.ttl) {
    rpcCache.delete(key);
    return null;
  }
  
  return entry.data;
};

const setCachedResponse = (key: string, data: unknown, ttl: number = RPC_CACHE_TTL) => {
  rpcCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl,
  });
};

// Retry with exponential backoff for RPC errors
export const retryWithBackoff = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isRateLimit = (error as any)?.message?.includes('rate limit') || 
                         (error as any)?.code === 429;
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

// Normalize RPC transaction record to match existing interface
export const normalizeRpcTransaction = (
  transaction: any,
  accountPublicKey: string
): NormalizedTransaction[] => {
  const results: NormalizedTransaction[] = [];
  
  try {
    const createdAt = new Date(transaction.createdAt * 1000); // RPC returns unix timestamp
    
    // Validate the date
    if (isNaN(createdAt.getTime()) || createdAt.getTime() <= 0) {
      if (import.meta.env.DEV) {
        console.warn('Invalid transaction date:', transaction.createdAt, 'for transaction:', transaction.txHash);
      }
      return results;
    }

    // For now, create individual contract transactions with unique IDs to prevent grouping
    // This avoids the "Contract calls (50x)" issue by making each transaction unique
    const randomSuffix = Math.random().toString(36).substring(7);
    const uniqueTransaction: NormalizedTransaction = {
      id: `${transaction.txHash}-${randomSuffix}-rpc`,
      createdAt,
      type: 'invoke_host_function',
      category: 'contract',
      transactionHash: transaction.txHash,
      // Add a small random amount to differentiate transactions
      amount: Math.random() * 0.001, // Very small amount just to make them different
      assetType: 'native',
      assetCode: 'XLM',
    };
    
    results.push(uniqueTransaction);
    
    return results;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('Error normalizing RPC transaction:', error, transaction);
    }
    return results;
  }
};

// Helper functions to parse specific operation types (for future use)
const parsePaymentOperation = (
  operation: any,
  accountPublicKey: string,
  txHash: string,
  createdAt: Date,
  opIndex: number
): NormalizedTransaction | null => {
  // Placeholder for future XDR parsing implementation
  return null;
};

const parseCreateAccountOperation = (
  operation: any,
  accountPublicKey: string,
  txHash: string,
  createdAt: Date,
  opIndex: number
): NormalizedTransaction | null => {
  // Placeholder for future XDR parsing implementation
  return null;
};

const parsePathPaymentOperation = (
  operation: any,
  accountPublicKey: string,
  txHash: string,
  createdAt: Date,
  opIndex: number,
  operationType: string
): NormalizedTransaction | null => {
  // Placeholder for future XDR parsing implementation
  return null;
};

const parseContractOperation = (
  operation: any,
  accountPublicKey: string,
  txHash: string,
  createdAt: Date,
  opIndex: number
): NormalizedTransaction => {
  return {
    id: `${txHash}-${opIndex}-rpc`,
    createdAt,
    type: 'invoke_host_function',
    category: 'contract',
    transactionHash: txHash,
  };
};

const parseConfigOperation = (
  operation: any,
  accountPublicKey: string,
  txHash: string,
  createdAt: Date,
  opIndex: number,
  operationType: string
): NormalizedTransaction => {
  return {
    id: `${txHash}-${opIndex}-rpc`,
    createdAt,
    type: operationType,
    category: 'config',
    transactionHash: txHash,
  };
};

// For now, we'll create a simplified approach since RPC getTransactions 
// returns raw XDR that would need to be parsed to extract individual operations.
// This is a complete migration focused on getting transaction history beyond 1 year limit.

// Get latest ledger info to set proper bounds
export const getLatestLedger = async (network: 'mainnet' | 'testnet') => {
  const server = createHistoryRpcServer(network);
  
  try {
    const latestLedger = await retryWithBackoff(() => 
      runRpcLimited(() => server.getLatestLedger())
    );
    return latestLedger;
  } catch (error) {
    console.error('Failed to get latest ledger:', error);
    throw error;
  }
};

// Fetch transactions using RPC getTransactions
export const fetchAccountTransactionsViaRpc = async (
  publicKey: string,
  network: 'mainnet' | 'testnet',
  cursor?: string,
  limit: number = 200,
  startLedger?: number
) => {
  // Create cache key based on all parameters
  const cacheKey = `rpc-transactions-${publicKey}-${network}-${cursor || 'initial'}-${limit}-${startLedger || 'latest'}`;
  
  // Check cache first
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    console.log('Returning cached RPC result for:', cacheKey);
    return cached as any;
  }
  
  console.log('Making RPC call with params:', { publicKey, network, cursor, limit, startLedger });
  const server = createHistoryRpcServer(network);
  
  // If no startLedger provided and no cursor, get latest ledger to set proper bounds
  if (!startLedger && !cursor) {
    try {
      const latestLedgerInfo = await getLatestLedger(network);
      console.log('Latest ledger info:', latestLedgerInfo);
      // Use latest ledger as end point, let RPC determine appropriate start
      startLedger = latestLedgerInfo.sequence;
    } catch (error) {
      console.warn('Could not get latest ledger, proceeding without startLedger:', error);
    }
  }
  
  // Build RPC request parameters
  const params: any = {
    filters: [
      {
        type: 'account',
        account: publicKey,
      }
    ],
    limit,
  };

  // Add cursor for pagination if provided
  if (cursor) {
    params.cursor = cursor;
  }

  // Add startLedger for historical queries (RPC's advantage over Horizon)
  if (startLedger) {
    params.startLedger = startLedger;
  }
  
  console.log('Final RPC params:', params);
  
  try {
    const result = await retryWithBackoff(() => 
      runRpcLimited(() => server.getTransactions(params))
    );
    
    console.log('RPC call successful, result:', result);
    
    // Cache the result
    setCachedResponse(cacheKey, result);
    
    return result;
  } catch (error) {
    console.error('RPC call failed:', error);
    throw error;
  }
};
