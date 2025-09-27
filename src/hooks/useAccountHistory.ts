import { useState, useEffect, useCallback } from 'react';
import { useNetwork } from '@/contexts/NetworkContext';
import { 
  fetchAccountTransactionsViaRpc,
  normalizeRpcTransaction,
  RPC_TRANSACTION_CACHE_DURATION 
} from '@/lib/rpc-history-utils';
import type { NormalizedTransaction } from '@/lib/horizon-utils';

// Historical transactions are immutable, cache them for much longer
const HISTORICAL_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const RECENT_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes for very recent data

interface CachedHistoryData {
  transactions: NormalizedTransaction[];
  lastSync: Date;
  cursor?: string;
}

interface AccountHistoryHook {
  transactions: NormalizedTransaction[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  lastSync: Date | null;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  loadProgressively: () => Promise<void>;
  refresh: () => Promise<void>;
  getTransactionsByDateRange: (startDate: Date, endDate: Date) => NormalizedTransaction[];
}

const CACHE_KEY_PREFIX = 'account-history';
const CACHE_VERSION = 'v3'; // Increment when cache structure changes
const INITIAL_LIMIT = 200; // Horizon API maximum limit
const LOAD_MORE_LIMIT = 200; // Horizon API maximum limit (cannot be increased)
const MAX_TRANSACTIONS_PER_SESSION = 5000; // 25 calls × 200 records = 5k transactions max
const RATE_LIMIT_DELAY = 100; // ms between requests
const MAX_CONCURRENT_REQUESTS = 3;

// Enhanced caching with pagination support
interface CachedPage {
  transactions: NormalizedTransaction[];
  cursor: string;
  timestamp: number;
}

interface CachedAccountData {
  pages: CachedPage[];
  lastSync: Date;
  totalTransactions: number;
  version: string;
}

// In-flight promises to prevent concurrent requests for same account
const requestPromises = new Map<string, Promise<any>>();
const requestCounts = new Map<string, { count: number; resetTime: number }>();

// In-memory cache for faster access to recent data
const memoryCache = new Map<string, {
  pages: CachedPage[];
  timestamp: number;
  totalTransactions: number;
}>();
const MEMORY_CACHE_TTL = 30 * 60 * 1000; // 30 minutes - longer for immutable historical data

export const useAccountHistory = (publicKey: string): AccountHistoryHook => {
  const { network } = useNetwork();
  const [transactions, setTransactions] = useState<NormalizedTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();

  // Cache key for this specific account and network
  const cacheKey = `${CACHE_KEY_PREFIX}-${publicKey}-${network}`;

  // Load data from enhanced localStorage cache
  const loadFromCache = useCallback((): CachedAccountData | null => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return null;

      const data: CachedAccountData = JSON.parse(cached);
      
      // Check version compatibility
      if (data.version !== CACHE_VERSION) {
        localStorage.removeItem(cacheKey);
        return null;
      }
      
      // Check if cache is still valid - use longer TTL for historical data
      const cacheAge = Date.now() - new Date(data.lastSync).getTime();
      if (cacheAge > HISTORICAL_CACHE_DURATION) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      // Parse dates back from strings for all pages
      data.pages = data.pages.map(page => ({
        ...page,
        transactions: page.transactions.map(tx => ({
          ...tx,
          createdAt: new Date(tx.createdAt),
        }))
      }));
      
      return data;
    } catch (error) {
      return null;
    }
  }, [cacheKey]);

  // Save data to enhanced localStorage cache
  const saveToCache = useCallback((pages: CachedPage[], totalTransactions: number) => {
    try {
      const data: CachedAccountData = {
        pages,
        lastSync: new Date(),
        totalTransactions,
        version: CACHE_VERSION,
      };
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (error) {
      // Ignore localStorage errors - cache is optional
    }
  }, [cacheKey]);

  // Smart rate limiting
  const checkRateLimit = useCallback((key: string): boolean => {
    const now = Date.now();
    const requestInfo = requestCounts.get(key);
    
    if (!requestInfo || now > requestInfo.resetTime) {
      requestCounts.set(key, { count: 1, resetTime: now + 60000 }); // Reset every minute
      return true;
    }
    
    if (requestInfo.count >= MAX_CONCURRENT_REQUESTS) {
      return false;
    }
    
    requestInfo.count++;
    return true;
  }, []);

  // Check if we need to sync
  const needsSync = useCallback((): boolean => {
    if (!lastSync) return true;
    return Date.now() - lastSync.getTime() > RPC_TRANSACTION_CACHE_DURATION;
  }, [lastSync]);


  // Load initial data (from cache if available, otherwise fetch)
  const loadInitial = useCallback(async (force: boolean = false) => {
    if (!publicKey) return;


    // Prevent concurrent requests for same account+network
    const requestKey = `${publicKey}-${network}`;
    if (!force && requestPromises.has(requestKey)) {
      try {
        return await requestPromises.get(requestKey);
      } catch (error) {
        // If the in-flight request failed, remove it and continue with new request
        requestPromises.delete(requestKey);
      }
    }

    const promise = (async () => {
      setIsLoading(true);
      setError(null);

      try {
        if (!force) {
          // Try memory cache first
          const memoryCached = memoryCache.get(cacheKey);
          if (memoryCached && (Date.now() - memoryCached.timestamp) < MEMORY_CACHE_TTL) {
            // Deduplicate transactions from all pages
            const seenIds = new Set<string>();
            const allTransactions = memoryCached.pages
              .flatMap(page => page.transactions)
              .filter(tx => {
                if (seenIds.has(tx.id)) return false;
                seenIds.add(tx.id);
                return true;
              })
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
              
            setTransactions(allTransactions);
            setLastSync(new Date(memoryCached.timestamp));
            if (memoryCached.pages.length > 0) {
              setCursor(memoryCached.pages[memoryCached.pages.length - 1].cursor);
            }
            setIsLoading(false);
            return;
          }

          // Try localStorage cache
          const cachedData = loadFromCache();
          if (cachedData) {
            // Deduplicate transactions from all pages
            const seenIds = new Set<string>();
            const allTransactions = cachedData.pages
              .flatMap(page => page.transactions)
              .filter(tx => {
                if (seenIds.has(tx.id)) return false;
                seenIds.add(tx.id);
                return true;
              })
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
              
            setTransactions(allTransactions);
            setLastSync(cachedData.lastSync);
            if (cachedData.pages.length > 0) {
              setCursor(cachedData.pages[cachedData.pages.length - 1].cursor);
            }
            
            // Update memory cache
            memoryCache.set(cacheKey, {
              pages: cachedData.pages,
              timestamp: Date.now(),
              totalTransactions: allTransactions.length,
            });
            setIsLoading(false);
            return;
          }
          
        }

        // Fetch fresh data using RPC for initial load
        const rpcResp = await fetchAccountTransactionsViaRpc(publicKey, network, undefined, INITIAL_LIMIT);
        
        const normalizedTransactions: NormalizedTransaction[] = [];

        // Process all transactions from RPC response
        for (const transaction of rpcResp.transactions || []) {
          const normalized = normalizeRpcTransaction(transaction, publicKey);
          normalizedTransactions.push(...normalized);
        }

        // Sort by creation date (newest first)
        normalizedTransactions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Update cursor and hasMore from RPC response
        if (rpcResp.transactions && rpcResp.transactions.length > 0) {
          // RPC uses cursor for pagination
          setCursor(rpcResp.cursor);
        }
        
        const rpcHasMore = rpcResp.transactions && rpcResp.transactions.length === INITIAL_LIMIT;
        setHasMore(!!rpcHasMore);

        const now = new Date();
        setTransactions(normalizedTransactions);
        setLastSync(now);

        // Save to cache immediately after each batch
        if (normalizedTransactions.length > 0) {
          const newPage: CachedPage = {
            transactions: normalizedTransactions,
            cursor: cursor || '',
            timestamp: now.getTime(),
          };
          
          // Load existing cache and append new page
          const existingCache = loadFromCache();
          const allPages = existingCache ? [...existingCache.pages, newPage] : [newPage];
          const totalTxs = allPages.reduce((sum, page) => sum + page.transactions.length, 0);
          
          // Save to both caches
          saveToCache(allPages, totalTxs);
          memoryCache.set(cacheKey, {
            pages: allPages,
            timestamp: Date.now(),
            totalTransactions: totalTxs,
          });
        }

      } catch (err: unknown) {
        const errorMsg = (err instanceof Error ? err.message : 'Failed to load transaction history');
        setError(errorMsg);
      } finally {
        setIsLoading(false);
        requestPromises.delete(requestKey);
      }
    })();

    requestPromises.set(requestKey, promise);
    
    // Auto-cleanup failed promises after timeout
    setTimeout(() => {
      if (requestPromises.get(requestKey) === promise) {
        requestPromises.delete(requestKey);
      }
    }, 30000); // 30 second timeout
    
    return promise;
  }, [publicKey, network, loadFromCache, needsSync, saveToCache]);

  // Load more transactions (pagination) - use RPC
  const loadMore = useCallback(async () => {
    if (!publicKey || !hasMore || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const rpcResp = await fetchAccountTransactionsViaRpc(publicKey, network, cursor, LOAD_MORE_LIMIT);
      
      const normalizedTransactions: NormalizedTransaction[] = [];

      // Process all transactions from RPC response
      for (const transaction of rpcResp.transactions || []) {
        const normalized = normalizeRpcTransaction(transaction, publicKey);
        normalizedTransactions.push(...normalized);
      }

      // Sort by creation date (newest first)
      normalizedTransactions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Update cursor and hasMore from RPC response
      if (rpcResp.transactions && rpcResp.transactions.length > 0) {
        setCursor(rpcResp.cursor);
      }
      
      const rpcHasMore = rpcResp.transactions && rpcResp.transactions.length === LOAD_MORE_LIMIT;
      setHasMore(!!rpcHasMore);
      
      setTransactions(prev => {
        // Deduplicate based on transaction ID
        const existingIds = new Set(prev.map(tx => tx.id));
        const newTransactions = normalizedTransactions.filter(tx => !existingIds.has(tx.id));
        const updatedTransactions = [...prev, ...newTransactions];
        
        // Save this batch to cache immediately
        if (newTransactions.length > 0) {
          const newPage: CachedPage = {
            transactions: newTransactions,
            cursor: cursor || '',
            timestamp: Date.now(),
          };
          
          // Load existing cache and append new page
          const existingCache = loadFromCache();
          const allPages = existingCache ? [...existingCache.pages, newPage] : [newPage];
          const totalTxs = allPages.reduce((sum, page) => sum + page.transactions.length, 0);
          
          // Save to both caches
          saveToCache(allPages, totalTxs);
          memoryCache.set(cacheKey, {
            pages: allPages,
            timestamp: Date.now(),
            totalTransactions: totalTxs,
          });
        }
        
        return updatedTransactions;
      });

    } catch (err: any) {
      const errorMsg = (err instanceof Error ? err.message : 'Failed to load more transactions');
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, network, cursor, hasMore, isLoading]);

  // Load progressively to build up history
  const loadProgressively = useCallback(async () => {
    if (!publicKey || isLoading) return;

    try {
      // Load batches until we hit limits or no more data
      let batchCount = 0;
      const maxBatches = 100; // 100 network calls max
      
      while (hasMore && transactions.length < MAX_TRANSACTIONS_PER_SESSION && batchCount < maxBatches) {
        await loadMore();
        batchCount++;
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    } catch (error) {
      // Ignore load more errors - user can retry
    }
  }, [publicKey, loadMore]);

  // Get transactions within date range
  const getTransactionsByDateRange = useCallback((startDate: Date, endDate: Date): NormalizedTransaction[] => {
    return transactions.filter(tx => {
      const txDate = new Date(tx.createdAt);
      return txDate >= startDate && txDate <= endDate;
    });
  }, [transactions]);

  // Refresh (clear cache and reload)
  const refresh = useCallback(async () => {
    try {
      await loadInitial(true);
    } catch (e) {
      // no-op: loadInitial handles error state
    }
  }, [loadInitial]);

  // Auto-load initial data when component mounts or key params change
  useEffect(() => {
    if (publicKey) {
      // Always check cache first on mount, even if we have no state
      loadInitial();
    }
  }, [publicKey, network]); // Remove loadInitial from deps to prevent loops

  return {
    transactions,
    isLoading,
    error,
    hasMore,
    lastSync,
    loadInitial,
    loadMore,
    loadProgressively,
    refresh,
    getTransactionsByDateRange,
  };
};