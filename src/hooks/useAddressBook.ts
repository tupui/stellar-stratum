import { useState, useEffect } from 'react';
import { createHorizonServer } from '@/lib/stellar';
import { retryWithBackoff } from '@/lib/horizon-utils';
import { safeStorage } from '@/lib/storage';

export interface AddressBookEntry {
  address: string;
  label?: string;
  transactionCount: number;
  totalAmount: number;
  lastUsed: Date;
  firstUsed: Date;
  score: number; // Calculated importance score
}

interface CachedAddressBook {
  entries: AddressBookEntry[];
  lastSync: string;
  cursor?: string; // For incremental sync
}

// v2: only addresses this account has paid. v1 also listed anyone who sent it 1 XLM, which
// let an attacker plant a look-alike of a real recipient (address poisoning).
const STORAGE_KEY_PREFIX = 'stellar-stratum-address-book-v2';
const SYNC_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ENTRIES = 500; // Cap total entries
const MAX_PAGES_PER_SYNC = 5; // Limit operations per sync

// In-flight sync promises to prevent concurrent requests
const syncPromises = new Map<string, Promise<void>>();

export const useAddressBook = (accountPublicKey?: string, network: 'mainnet' | 'testnet' = 'mainnet') => {
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [cursor, setCursor] = useState<string>();

  // Get scoped storage key
  const getStorageKey = () => `${STORAGE_KEY_PREFIX}-${accountPublicKey}-${network}`;

  // Load cached address book from localStorage
  useEffect(() => {
    if (!accountPublicKey) return;

    const parsed = safeStorage.getJSON<CachedAddressBook | null>(getStorageKey(), null);
    if (!parsed) return;

    if (Array.isArray(parsed.entries)) {
      setEntries(
        parsed.entries.map((entry) => ({
          ...entry,
          lastUsed: new Date(entry.lastUsed),
          firstUsed: new Date(entry.firstUsed),
        })),
      );
    }
    if (parsed.lastSync) setLastSync(new Date(parsed.lastSync));
    if (parsed.cursor) setCursor(parsed.cursor);
  }, [accountPublicKey, network]);

  // Save address book to localStorage
  const saveToStorage = (addressBook: AddressBookEntry[], syncTime: Date, newCursor?: string) => {
    if (!accountPublicKey) return;
    const data: CachedAddressBook = {
      entries: addressBook,
      lastSync: syncTime.toISOString(),
      cursor: newCursor,
    };
    safeStorage.setJSON(getStorageKey(), data);
  };

  // Check if sync is needed (respects cooldown)
  const needsSync = (): boolean => {
    if (!lastSync) return true;
    return Date.now() - lastSync.getTime() > SYNC_COOLDOWN_MS;
  };

  // Calculate importance score based on transaction count and recency
  const calculateScore = (transactionCount: number, totalAmount: number, lastUsed: Date): number => {
    const daysSinceLastUse = Math.max(1, (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60 * 24));
    const recencyFactor = Math.max(0.1, 1 / Math.log(daysSinceLastUse + 1));
    
    // Simplified scoring without price lookups
    const frequencyScore = Math.log(transactionCount + 1) * 10;
    const amountScore = Math.log(totalAmount + 1) * 5; // XLM amounts only
    
    return (frequencyScore + amountScore) * recencyFactor;
  };

  // Sync address book with transaction history (optimized)
  const syncAddressBook = async (force = false) => {
    if (!accountPublicKey) return;
    
    // Check cooldown unless forced
    if (!force && !needsSync()) return;
    
    // Prevent concurrent syncs for same account+network
    const syncKey = `${accountPublicKey}-${network}`;
    if (syncPromises.has(syncKey)) {
      return syncPromises.get(syncKey);
    }

    const syncPromise = (async () => {
      setIsLoading(true);
      try {
        const server = createHorizonServer(network);
        const addressMap = new Map<string, {
          transactionCount: number;
          totalAmount: number;
          lastUsed: Date;
          firstUsed: Date;
        }>();

        // Initialize with existing entries
        entries.forEach(entry => {
          addressMap.set(entry.address, {
            transactionCount: entry.transactionCount,
            totalAmount: entry.totalAmount,
            lastUsed: entry.lastUsed,
            firstUsed: entry.firstUsed,
          });
        });

        // First sync: newest pages first. Later syncs: only what happened after the newest
        // payment already seen (ascending from the saved cursor).
        const incremental = Boolean(cursor);
        const builder = server.payments().forAccount(accountPublicKey).order(incremental ? 'asc' : 'desc').limit(200);
        let page = await retryWithBackoff(() => (incremental ? builder.cursor(cursor!) : builder).call());
        let newCursor = cursor;

        for (let pages = 0; pages < MAX_PAGES_PER_SYNC && page.records.length > 0; pages++) {
          type PaymentLike = {
            paging_token: string;
            created_at: string;
            type: string;
            from?: string;
            to?: string;
            asset_type?: string;
            amount?: string;
            funder?: string;
            account?: string;
            starting_balance?: string;
          };
          const records = page.records as unknown as PaymentLike[];
          if (incremental) newCursor = records[records.length - 1].paging_token;
          else if (pages === 0) newCursor = records[0].paging_token;

          for (const op of records) {
            // Only recipients this account chose to pay: incoming payments are ignored.
            let counterparty: string | undefined;
            let amount = 0;
            if (op.type === 'payment' && op.from === accountPublicKey) {
              counterparty = op.to;
              if (op.asset_type === 'native') amount = Math.abs(parseFloat(op.amount || '0'));
            } else if (op.type === 'create_account' && op.funder === accountPublicKey) {
              counterparty = op.account;
              amount = Math.abs(parseFloat(op.starting_balance || '0'));
            }
            if (!counterparty || counterparty === accountPublicKey) continue;

            const opDate = new Date(op.created_at);
            const existing = addressMap.get(counterparty);
            if (existing) {
              existing.transactionCount++;
              existing.totalAmount += amount;
              existing.lastUsed = new Date(Math.max(existing.lastUsed.getTime(), opDate.getTime()));
              existing.firstUsed = new Date(Math.min(existing.firstUsed.getTime(), opDate.getTime()));
            } else {
              addressMap.set(counterparty, { transactionCount: 1, totalAmount: amount, lastUsed: opDate, firstUsed: opDate });
            }
          }

          if (page.records.length < 200) break;
          page = await retryWithBackoff(() => page.next());
        }

        // Convert to AddressBookEntry array (skip domain enrichment to reduce API calls)
        const newEntries: AddressBookEntry[] = [];
        for (const [address, data] of addressMap.entries()) {
          const score = calculateScore(data.transactionCount, data.totalAmount, data.lastUsed);
          
          newEntries.push({
            address,
            score,
            ...data,
          });
        }

        // Sort by score and cap entries
        newEntries.sort((a, b) => b.score - a.score);
        const cappedEntries = newEntries.slice(0, MAX_ENTRIES);

        setEntries(cappedEntries);
        setCursor(newCursor);
        const syncTime = new Date();
        setLastSync(syncTime);
        saveToStorage(cappedEntries, syncTime, newCursor);

      } finally {
        setIsLoading(false);
      }
    })();

    syncPromises.set(syncKey, syncPromise);
    try {
      await syncPromise;
    } finally {
      syncPromises.delete(syncKey);
    }
  };

  // Add or update an address manually (e.g., after a new transaction)
  const addOrUpdateAddress = (address: string, amount: number = 0) => {
    const existing = entries.find(entry => entry.address === address);
    const now = new Date();
    
    if (existing) {
      const updated = {
        ...existing,
        transactionCount: existing.transactionCount + 1,
        totalAmount: existing.totalAmount + amount,
        lastUsed: now,
        score: calculateScore(existing.transactionCount + 1, existing.totalAmount + amount, now),
      };
      
      const newEntries = entries.map(entry => 
        entry.address === address ? updated : entry
      ).sort((a, b) => b.score - a.score);
      
      setEntries(newEntries);
      saveToStorage(newEntries, lastSync || now);
    } else {
      const newEntry: AddressBookEntry = {
        address,
        transactionCount: 1,
        totalAmount: amount,
        lastUsed: now,
        firstUsed: now,
        score: calculateScore(1, amount, now),
      };
      
      const newEntries = [...entries, newEntry]
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_ENTRIES); // Cap entries
      setEntries(newEntries);
      saveToStorage(newEntries, lastSync || now);
    }
  };

  // Search addresses by partial match
  const searchAddresses = (query: string): AddressBookEntry[] => {
    if (!query.trim()) return entries.slice(0, 10); // Return top 10 when no query
    
    const lowerQuery = query.toLowerCase();
    return entries.filter(entry => 
      entry.address.toLowerCase().includes(lowerQuery) ||
      entry.label?.toLowerCase().includes(lowerQuery)
    ).slice(0, 10);
  };

  // Clear address book for current account/network
  const clearAddressBook = () => {
    setEntries([]);
    setLastSync(null);
    setCursor(undefined);
    if (accountPublicKey) {
      localStorage.removeItem(getStorageKey());
    }
  };

  return {
    entries,
    isLoading,
    lastSync,
    needsSync: needsSync(),
    syncAddressBook,
    addOrUpdateAddress,
    searchAddresses,
    clearAddressBook,
  };
};