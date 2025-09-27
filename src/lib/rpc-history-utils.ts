import { rpc, Horizon } from '@stellar/stellar-sdk';
import { appConfig } from './appConfig';
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

// Create RPC server for specific network - using archive endpoints for historical data
export const createRpcServer = (network: 'mainnet' | 'testnet') => {
  const rpcUrl = network === 'testnet' ? appConfig.TESTNET_ARCHIVE_RPC : appConfig.MAINNET_ARCHIVE_RPC;
  return new rpc.Server(rpcUrl);
};

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

    // For RPC, we need to parse the envelope XDR to get operations
    // For now, create a basic transaction record to maintain compatibility
    // TODO: Parse XDR to extract operations for more detailed analysis
    const basicTransaction: NormalizedTransaction = {
      id: `${transaction.txHash}-rpc`,
      createdAt,
      type: 'transaction',
      category: 'contract', // Default to contract for RPC transactions
      transactionHash: transaction.txHash,
    };
    
    results.push(basicTransaction);
    
    return results;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('Error normalizing RPC transaction:', error, transaction);
    }
    return results;
  }
};

// For now, we'll create a simplified approach since RPC getTransactions 
// returns raw XDR that would need to be parsed to extract individual operations.
// This is a complete migration focused on getting transaction history beyond 1 year limit.

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
    return cached as any;
  }
  
  const server = createRpcServer(network);
  
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
  
  const result = await retryWithBackoff(() => 
    runRpcLimited(() => server.getTransactions(params))
  );
  
  // Cache the result
  setCachedResponse(cacheKey, result);
  
  return result;
};
