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
  refresh: () => Promise<void>;
}

const CACHE_KEY_PREFIX = 'account-history';
const INITIAL_LIMIT = 50;
const LOAD_MORE_LIMIT = 25;

// In-flight promises to prevent concurrent requests for same account
const requestPromises = new Map<string, Promise<any>>();

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

  // Check if we need to sync
  const needsSync = useCallback((): boolean => {
    if (!lastSync) return true;
    return Date.now() - lastSync.getTime() > TRANSACTION_CACHE_DURATION;
  }, [lastSync]);

  // Fetch and process transactions
  const fetchTransactions = useCallback(async (
    useCursor?: string, 
    limit: number = INITIAL_LIMIT,
    append: boolean = false
  ): Promise<NormalizedTransaction[]> => {
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

    // Update hasMore based on response
    setHasMore(response.records.length === limit);

    return normalizedTransactions;
  }, [publicKey, network]);

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

        // Save to cache
        saveToCache({
          transactions: newTransactions,
          lastSync: now,
          cursor,
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
    if (publicKey) {
      loadInitial();
    }
  }, [publicKey, network]); // Only depend on key params, not loadInitial to avoid loops

  return {
    transactions,
    isLoading,
    error,
    hasMore,
    lastSync,
    loadInitial,
    loadMore,
    refresh,
  };
};