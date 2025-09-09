import { useState, useEffect, useCallback } from 'react';
import { useNetwork } from '@/contexts/NetworkContext';
import { 
  fetchAccountPayments, 
  normalizePaymentRecord, 
  NormalizedTransaction,
  TRANSACTION_CACHE_DURATION 
} from '@/lib/horizon-utils';

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
const INITIAL_LIMIT = 100; // Increased for better UX
const LOAD_MORE_LIMIT = 50;
const MAX_TRANSACTIONS_PER_SESSION = 5000; // ~1 year of data for active accounts
const RATE_LIMIT_DELAY = 100; // ms between requests
const MAX_CONCURRENT_REQUESTS = 3;

// In-flight promises to prevent concurrent requests for same account
const requestPromises = new Map<string, Promise<any>>();
const requestCounts = new Map<string, { count: number; resetTime: number }>();

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

  // Load data from localStorage
  const loadFromCache = useCallback((): CachedHistoryData | null => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return null;

      const data: CachedHistoryData = JSON.parse(cached);
      
      // Check if cache is still valid
      const cacheAge = Date.now() - new Date(data.lastSync).getTime();
      if (cacheAge > TRANSACTION_CACHE_DURATION) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      // Parse dates back from strings
      data.transactions = data.transactions.map(tx => ({
        ...tx,
        createdAt: new Date(tx.createdAt),
      }));
      
      return data;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Failed to load transaction history from cache:', error);
      }
      return null;
    }
  }, [cacheKey]);

  // Save data to localStorage
  const saveToCache = useCallback((data: CachedHistoryData) => {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Failed to save transaction history to cache:', error);
      }
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
    return Date.now() - lastSync.getTime() > TRANSACTION_CACHE_DURATION;
  }, [lastSync]);

  // Fetch and process transactions with rate limiting
  const fetchTransactions = useCallback(async (
    useCursor?: string, 
    limit: number = INITIAL_LIMIT,
    append: boolean = false
  ): Promise<NormalizedTransaction[]> => {
    const rateLimitKey = `${publicKey}-${network}`;
    
    if (!checkRateLimit(rateLimitKey)) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    }

    const response = await fetchAccountPayments(publicKey, network, useCursor, limit);
    
    const normalizedTransactions: NormalizedTransaction[] = [];
    
    for (const record of response.records) {
      const normalized = normalizePaymentRecord(record, publicKey);
      if (normalized) {
        normalizedTransactions.push(normalized);
      }
    }

    // Update cursor for pagination
    if (response.records.length > 0) {
      const lastRecord = response.records[response.records.length - 1];
      setCursor(lastRecord.paging_token);
    }

    // Update hasMore based on response and max limit
    const reachedMaxTransactions = transactions.length + normalizedTransactions.length >= MAX_TRANSACTIONS_PER_SESSION;
    setHasMore(response.records.length === limit && !reachedMaxTransactions);

    return normalizedTransactions;
  }, [publicKey, network, checkRateLimit, transactions.length]);

  // Load initial data (from cache if available, otherwise fetch)
  const loadInitial = useCallback(async () => {
    if (!publicKey) return;

    // Prevent concurrent requests for same account+network
    const requestKey = `${publicKey}-${network}`;
    if (requestPromises.has(requestKey)) {
      return requestPromises.get(requestKey);
    }

    const promise = (async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Try to load from cache first
        const cachedData = loadFromCache();
        if (cachedData && !needsSync()) {
          setTransactions(cachedData.transactions);
          setLastSync(cachedData.lastSync);
          setCursor(cachedData.cursor);
          return;
        }

        // Fetch fresh data
        const newTransactions = await fetchTransactions();
        const now = new Date();
        
        setTransactions(newTransactions);
        setLastSync(now);

        // Save to cache with current cursor
        const currentCursor = newTransactions.length > 0 
          ? newTransactions[newTransactions.length - 1].id 
          : undefined;
        
        saveToCache({
          transactions: newTransactions,
          lastSync: now,
          cursor: currentCursor,
        });

      } catch (err: any) {
        const errorMsg = err?.message || 'Failed to load transaction history';
        setError(errorMsg);
        if (import.meta.env.DEV) {
          console.error('Failed to load transaction history:', err);
        }
      } finally {
        setIsLoading(false);
        requestPromises.delete(requestKey);
      }
    })();

    requestPromises.set(requestKey, promise);
    return promise;
  }, [publicKey, network, loadFromCache, needsSync, fetchTransactions, saveToCache, cursor]);

  // Load more transactions (pagination)
  const loadMore = useCallback(async () => {
    if (!publicKey || !cursor || !hasMore || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const moreTransactions = await fetchTransactions(cursor, LOAD_MORE_LIMIT, true);
      
      setTransactions(prev => {
        // Deduplicate based on transaction ID
        const existingIds = new Set(prev.map(tx => tx.id));
        const newTransactions = moreTransactions.filter(tx => !existingIds.has(tx.id));
        return [...prev, ...newTransactions];
      });

    } catch (err: any) {
      const errorMsg = err?.message || 'Failed to load more transactions';
      setError(errorMsg);
      if (import.meta.env.DEV) {
        console.error('Failed to load more transactions:', err);
      }
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, cursor, hasMore, isLoading, fetchTransactions]);

  // Load progressively to build up 1 year of data
  const loadProgressively = useCallback(async () => {
    if (!publicKey || isLoading || !hasMore || transactions.length >= MAX_TRANSACTIONS_PER_SESSION) return;

    try {
      // Load multiple batches progressively with delays
      let batchCount = 0;
      const maxBatches = 5; // Load 5 batches progressively
      
      while (batchCount < maxBatches && hasMore && transactions.length < MAX_TRANSACTIONS_PER_SESSION) {
        await loadMore();
        batchCount++;
        
        // Add delay between batches to not overwhelm the API
        if (batchCount < maxBatches) {
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY * 2));
        }
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Progressive loading failed:', error);
      }
    }
  }, [publicKey, isLoading, hasMore, transactions.length, loadMore]);

  // Get transactions within date range
  const getTransactionsByDateRange = useCallback((startDate: Date, endDate: Date): NormalizedTransaction[] => {
    return transactions.filter(tx => {
      const txDate = new Date(tx.createdAt);
      return txDate >= startDate && txDate <= endDate;
    });
  }, [transactions]);

  // Refresh (clear cache and reload)
  const refresh = useCallback(async () => {
    localStorage.removeItem(cacheKey);
    setTransactions([]);
    setCursor(undefined);
    setHasMore(true);
    await loadInitial();
  }, [cacheKey, loadInitial]);

  // Auto-load initial data when component mounts or key params change
  useEffect(() => {
    let mounted = true;
    
    const loadData = async () => {
      if (publicKey && mounted) {
        await loadInitial();
      }
    };
    
    loadData();
    
    return () => {
      mounted = false;
    };
  }, [publicKey, network]); // Only depend on key params, not loadInitial to avoid loops

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