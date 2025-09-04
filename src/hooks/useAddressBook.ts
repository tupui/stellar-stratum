import { useState, useEffect } from 'react';
import { createHorizonServer } from '@/lib/stellar';
import { resolveSorobanDomain } from '@/lib/soroban-domains';

export interface AddressBookEntry {
  address: string;
  label?: string;
  sorobanDomain?: string;
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

const STORAGE_KEY_PREFIX = 'stellar-stratum-address-book';
const MIN_TRANSACTION_AMOUNT = 1; // Filter transactions below 1 XLM
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
    
    const cached = localStorage.getItem(getStorageKey());
    if (cached) {
      try {
        const parsed: CachedAddressBook = JSON.parse(cached);
        if (Array.isArray(parsed.entries)) {
          const entriesWithDates = parsed.entries.map((entry: any) => ({
            ...entry,
            lastUsed: new Date(entry.lastUsed),
            firstUsed: new Date(entry.firstUsed),
          }));
          setEntries(entriesWithDates);
        }
        if (parsed.lastSync) {
          setLastSync(new Date(parsed.lastSync));
        }
        if (parsed.cursor) {
          setCursor(parsed.cursor);
        }
      } catch (error) {
        console.error('Failed to parse cached address book:', error);
      }
    }
  }, [accountPublicKey, network]);

  // Save address book to localStorage
  const saveToStorage = (addressBook: AddressBookEntry[], syncTime: Date, newCursor?: string) => {
    if (!accountPublicKey) return;
    
    try {
      const data: CachedAddressBook = {
        entries: addressBook,
        lastSync: syncTime.toISOString(),
        cursor: newCursor,
      };
      localStorage.setItem(getStorageKey(), JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save address book:', error);
    }
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

  // Retry with backoff for rate limit errors
  const retryWithBackoff = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        const isRateLimit = error?.status === 429 || error?.status === 503;
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

        // Incremental fetch: use cursor for new operations only
        let paymentsBuilder = server
          .payments()
          .forAccount(accountPublicKey)
          .order('desc')
          .limit(200);

        if (cursor) {
          paymentsBuilder = paymentsBuilder.cursor(cursor);
        }

        let newCursor = cursor;
        let pagesProcessed = 0;

        // Process multiple pages but limit to avoid DoS
        while (pagesProcessed < MAX_PAGES_PER_SYNC) {
          const paymentsPage = await retryWithBackoff(() => paymentsBuilder.call());
          
          if (paymentsPage.records.length === 0) break;

          // Update cursor to the first (most recent) record
          if (pagesProcessed === 0 && paymentsPage.records.length > 0) {
            newCursor = (paymentsPage.records[0] as any).paging_token;
          }

          for (const op of paymentsPage.records) {
            try {
              const opDate = new Date((op as any).created_at);
              let counterparty: string | null = null;
              let amount = 0;

              if (op.type === 'payment') {
                const from = (op as any).from;
                const to = (op as any).to;
                if (from === accountPublicKey) {
                  counterparty = to;
                } else if (to === accountPublicKey) {
                  counterparty = from;
                }
                
                // Only process native XLM to avoid expensive price lookups
                const assetType = (op as any).asset_type;
                if (assetType === 'native') {
                  amount = Math.abs(parseFloat((op as any).amount || '0'));
                } else {
                  // Skip non-native assets to reduce API load
                  continue;
                }
              } else if (op.type === 'create_account') {
                const funder = (op as any).funder;
                const account = (op as any).account;
                if (funder === accountPublicKey) {
                  counterparty = account;
                } else if (account === accountPublicKey) {
                  counterparty = funder;
                }
                amount = Math.abs(parseFloat((op as any).starting_balance || '0'));
              } else {
                continue;
              }

              // Filter out small transactions and self-transactions
              if (counterparty && amount >= MIN_TRANSACTION_AMOUNT && counterparty !== accountPublicKey) {
                const existing = addressMap.get(counterparty);
                if (existing) {
                  existing.transactionCount++;
                  existing.totalAmount += amount;
                  existing.lastUsed = new Date(Math.max(existing.lastUsed.getTime(), opDate.getTime()));
                  existing.firstUsed = new Date(Math.min(existing.firstUsed.getTime(), opDate.getTime()));
                } else {
                  addressMap.set(counterparty, {
                    transactionCount: 1,
                    totalAmount: amount,
                    lastUsed: opDate,
                    firstUsed: opDate,
                  });
                }
              }
            } catch (error) {
              // Skip operations that fail to parse
              continue;
            }
          }

          // Check if there are more pages
          pagesProcessed++;
          if (paymentsPage.records.length < 200) break; // No more records

          // Get next page
          try {
            const nextPage = await paymentsPage.next();
            paymentsBuilder = server
              .payments()
              .forAccount(accountPublicKey)
              .order('desc')
              .limit(200)
              .cursor((nextPage.records[0] as any)?.paging_token);
          } catch {
            break; // No more pages
          }
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

      } catch (error) {
        console.error('Failed to sync address book:', error);
        throw error;
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
    } else if (amount >= MIN_TRANSACTION_AMOUNT) {
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
      entry.sorobanDomain?.toLowerCase().includes(lowerQuery) ||
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