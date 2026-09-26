import { useState, useEffect, useCallback, useRef } from 'react';
import { useNetwork } from '@/contexts/NetworkContext';
import { fetchAccountOperations, normalizeRecord, type HorizonRecord } from '@/lib/horizon-utils';
import type { NormalizedTransaction } from '@/lib/horizon-utils';
import { safeStorage } from '@/lib/storage';

interface AccountHistoryHook {
  transactions: NormalizedTransaction[];
  /** Checking Horizon for new transactions. */
  isLoading: boolean;
  /** Fetching an older page. */
  isLoadingMore: boolean;
  /** Why the last check for new transactions failed. */
  error: string | null;
  /** Why the last older page failed; what is already loaded stays usable. */
  loadMoreError: string | null;
  hasMore: boolean;
  lastSync: Date | null;
  /** Fetch one older page. Resolves false when it could not be loaded. */
  loadMore: () => Promise<boolean>;
  /** Fetch a few more older pages in the background. */
  loadProgressively: () => Promise<void>;
  /** Check Horizon for new transactions. */
  refresh: () => Promise<void>;
}

// Everything known about one account's history on one network, kept in memory
// for the session and in localStorage across reloads. Entry ids are Horizon
// paging tokens, so any entry can serve as a cursor.
interface HistorySnapshot {
  transactions: NormalizedTransaction[]; // unique by id, newest first
  headToken: string; // paging token of the newest Horizon record seen
  tailToken: string; // paging token of the oldest one: where older pages start
  hasMore: boolean;
  lastSync: number; // when Horizon was last asked for new records
}

const CACHE_KEY_PREFIX = 'account-history';
const CACHE_VERSION = 'v4'; // Increment when cache structure changes
const PAGE_LIMIT = 200; // Horizon API maximum limit
const MAX_TRANSACTIONS = 5000; // Background loading stops here
const STORED_TRANSACTIONS = 1000; // Only the newest ones are persisted, to bound localStorage use
const AUTO_LOAD_TARGET = 1000; // Each activation tops history up towards this many entries,
const PAGES_PER_RUN = 5; // fetching at most this many Horizon pages per run
const PAGE_DELAY = 250; // ms between background pages

const NO_TRANSACTIONS: NormalizedTransaction[] = [];

const memoryCache = new Map<string, HistorySnapshot>();
// One head sync per account+network at a time, shared by every mounted panel.
const headSyncs = new Map<string, Promise<HistorySnapshot>>();

const byNewest = (a: NormalizedTransaction, b: NormalizedTransaction) =>
  b.createdAt.getTime() - a.createdAt.getTime();

const normalizeAll = (records: HorizonRecord[], publicKey: string): NormalizedTransaction[] =>
  records
    .map(record => normalizeRecord(record, publicKey))
    .filter((tx): tx is NormalizedTransaction => tx !== null);

// Union by id, newest first.
const mergeTransactions = (a: NormalizedTransaction[], b: NormalizedTransaction[]) => {
  const byId = new Map<string, NormalizedTransaction>();
  for (const tx of [...a, ...b]) {
    if (!byId.has(tx.id)) byId.set(tx.id, tx);
  }
  return [...byId.values()].sort(byNewest);
};

const readStored = (key: string): HistorySnapshot | null => {
  const stored = safeStorage.getJSON<(HistorySnapshot & { version?: string }) | null>(key, null);
  if (!stored) return null;
  if (stored.version !== CACHE_VERSION || !Array.isArray(stored.transactions)) {
    safeStorage.remove(key);
    return null;
  }
  return {
    transactions: stored.transactions.map(tx => ({ ...tx, createdAt: new Date(tx.createdAt) })),
    headToken: stored.headToken,
    tailToken: stored.tailToken,
    hasMore: stored.hasMore,
    lastSync: stored.lastSync,
  };
};

const writeStored = (key: string, snapshot: HistorySnapshot) => {
  const trimmed = snapshot.transactions.length > STORED_TRANSACTIONS
    ? {
        ...snapshot,
        transactions: snapshot.transactions.slice(0, STORED_TRANSACTIONS),
        tailToken: snapshot.transactions[STORED_TRANSACTIONS - 1].id,
        hasMore: true,
      }
    : snapshot;
  safeStorage.setJSON(key, { ...trimmed, version: CACHE_VERSION });
};

const getSnapshot = (key: string): HistorySnapshot | null => {
  const cached = memoryCache.get(key);
  if (cached) return cached;
  const stored = readStored(key);
  if (stored) memoryCache.set(key, stored);
  return stored;
};

const putSnapshot = (key: string, snapshot: HistorySnapshot) => {
  memoryCache.set(key, snapshot);
  writeStored(key, snapshot);
};

// Bring the newest end of the history up to date. With a known head we only ask
// for records after it; a full page back means there may be more than a page of
// new activity, so we restart from the newest page rather than leave a gap.
const syncHead = (key: string, publicKey: string, network: 'mainnet' | 'testnet'): Promise<HistorySnapshot> => {
  const running = headSyncs.get(key);
  if (running) return running;

  const promise = (async () => {
    const known = getSnapshot(key);
    if (known?.headToken) {
      const { records } = await fetchAccountOperations(publicKey, network, known.headToken, PAGE_LIMIT, 'asc');
      if (records.length < PAGE_LIMIT) {
        // Older pages may have landed while we waited; build on the latest state.
        const latest = getSnapshot(key) ?? known;
        const next: HistorySnapshot = {
          ...latest,
          transactions: mergeTransactions(normalizeAll(records, publicKey), latest.transactions),
          headToken: records.length ? records[records.length - 1].paging_token : latest.headToken,
          lastSync: Date.now(),
        };
        putSnapshot(key, next);
        return next;
      }
    }

    const { records } = await fetchAccountOperations(publicKey, network, undefined, PAGE_LIMIT, 'desc');
    const next: HistorySnapshot = {
      transactions: normalizeAll(records, publicKey).sort(byNewest),
      headToken: records[0]?.paging_token ?? '',
      tailToken: records[records.length - 1]?.paging_token ?? '',
      hasMore: records.length === PAGE_LIMIT,
      lastSync: Date.now(),
    };
    putSnapshot(key, next);
    return next;
  })().finally(() => headSyncs.delete(key));

  headSyncs.set(key, promise);
  return promise;
};

// Append the page just older than what we have.
const fetchOlder = async (key: string, publicKey: string, network: 'mainnet' | 'testnet'): Promise<HistorySnapshot | null> => {
  const known = getSnapshot(key);
  if (!known?.hasMore) return known;

  const { records } = await fetchAccountOperations(publicKey, network, known.tailToken || undefined, PAGE_LIMIT, 'desc');
  const latest = getSnapshot(key);
  // A head sync may have restarted the history meanwhile; this page would leave a gap.
  if (!latest || latest.tailToken !== known.tailToken) return latest;

  const next: HistorySnapshot = {
    ...latest,
    transactions: mergeTransactions(latest.transactions, normalizeAll(records, publicKey)),
    tailToken: records.length ? records[records.length - 1].paging_token : latest.tailToken,
    hasMore: records.length === PAGE_LIMIT,
  };
  putSnapshot(key, next);
  return next;
};

export const useAccountHistory = (publicKey: string, enabled: boolean = true): AccountHistoryHook => {
  const { network } = useNetwork();
  const cacheKey = `${CACHE_KEY_PREFIX}-${publicKey}-${network}`;

  const [snapshot, setSnapshot] = useState<HistorySnapshot | null>(() => getSnapshot(cacheKey));
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // Mirror the latest values into refs so async work started for one account
  // never writes into another, and background loops see the tab being left.
  const keyRef = useRef(cacheKey);
  const enabledRef = useRef(enabled);
  const loadingMoreRef = useRef(false);
  const progressiveRef = useRef(false);
  useEffect(() => {
    keyRef.current = cacheKey;
    enabledRef.current = enabled;
  });

  // Resolves false when Horizon could not be reached.
  const sync = useCallback(async (): Promise<boolean> => {
    const key = cacheKey;
    if (!publicKey) return false;
    setIsLoading(true);
    setError(null);
    try {
      const synced = await syncHead(key, publicKey, network);
      if (keyRef.current === key) setSnapshot(getSnapshot(key) ?? synced);
      return true;
    } catch (err: unknown) {
      if (keyRef.current === key) setError(err instanceof Error ? err.message : 'Failed to load transaction history');
      return false;
    } finally {
      if (keyRef.current === key) setIsLoading(false);
    }
  }, [cacheKey, publicKey, network]);

  const loadMore = useCallback(async (): Promise<boolean> => {
    const key = cacheKey;
    if (!publicKey || loadingMoreRef.current) return false;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const next = await fetchOlder(key, publicKey, network);
      if (keyRef.current === key) setSnapshot(next);
      return true;
    } catch (err: unknown) {
      if (keyRef.current === key) setLoadMoreError(err instanceof Error ? err.message : 'Failed to load more transactions');
      return false;
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [cacheKey, publicKey, network]);

  // Page through older history in the background, one run at a time. Stops at
  // `target` entries, after PAGES_PER_RUN Horizon pages (dropped spam counts
  // towards those), on error, or when the tab is left.
  const loadPages = useCallback(async (target: number) => {
    const key = cacheKey;
    if (progressiveRef.current) return;
    progressiveRef.current = true;
    try {
      for (let page = 0; page < PAGES_PER_RUN; page++) {
        if (page > 0) await new Promise(resolve => setTimeout(resolve, PAGE_DELAY));
        const known = getSnapshot(key);
        if (keyRef.current !== key || !enabledRef.current || !known?.hasMore || known.transactions.length >= target) break;
        if (!(await loadMore())) break;
      }
    } finally {
      progressiveRef.current = false;
    }
  }, [cacheKey, loadMore]);

  const loadProgressively = useCallback(() => loadPages(MAX_TRANSACTIONS), [loadPages]);
  const refresh = useCallback(async () => {
    if (await sync()) loadPages(AUTO_LOAD_TARGET);
  }, [sync, loadPages]);

  // Show what we already have for this account at once. While the Activity tab
  // is active (and only then, so we don't hit Horizon from another tab), check
  // for new transactions and top older history up.
  useEffect(() => {
    setSnapshot(getSnapshot(cacheKey));
    setError(null);
    setLoadMoreError(null);
    setIsLoading(false);
    if (!publicKey || !enabled) return;
    sync().then(ok => ok && loadPages(AUTO_LOAD_TARGET));
  }, [cacheKey, publicKey, enabled, sync, loadPages]);

  return {
    transactions: snapshot?.transactions ?? NO_TRANSACTIONS,
    isLoading,
    isLoadingMore,
    error,
    loadMoreError,
    hasMore: snapshot?.hasMore ?? false,
    lastSync: snapshot ? new Date(snapshot.lastSync) : null,
    loadMore,
    loadProgressively,
    refresh,
  };
};
