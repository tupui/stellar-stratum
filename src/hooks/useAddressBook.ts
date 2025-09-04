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

const STORAGE_KEY = 'stellar-stratum-address-book';
const MIN_TRANSACTION_AMOUNT = 1; // Filter transactions below 1 XLM

export const useAddressBook = (accountPublicKey?: string, network: 'mainnet' | 'testnet' = 'mainnet') => {
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // Load cached address book from localStorage
  useEffect(() => {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const entriesWithDates = parsed.map((entry: any) => ({
          ...entry,
          lastUsed: new Date(entry.lastUsed),
          firstUsed: new Date(entry.firstUsed),
        }));
        setEntries(entriesWithDates);
        if (parsed.lastSync) {
          setLastSync(new Date(parsed.lastSync));
        }
      } catch (error) {
        console.error('Failed to parse cached address book:', error);
      }
    }
  }, []);

  // Save address book to localStorage
  const saveToStorage = (addressBook: AddressBookEntry[], syncTime: Date) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        entries: addressBook,
        lastSync: syncTime.toISOString(),
      }));
    } catch (error) {
      console.error('Failed to save address book:', error);
    }
  };

  // Calculate importance score based on transaction count and total amount
  const calculateScore = (transactionCount: number, totalAmount: number, lastUsed: Date): number => {
    const daysSinceLastUse = Math.max(1, (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60 * 24));
    const recencyFactor = Math.max(0.1, 1 / Math.log(daysSinceLastUse + 1));
    
    // Amount is more important than frequency
    const amountScore = Math.log(totalAmount + 1) * 10;
    const frequencyScore = Math.log(transactionCount + 1) * 5;
    
    return (amountScore + frequencyScore) * recencyFactor;
  };

  // Enrich address with Soroban domain if available
  const enrichWithSorobanDomain = async (address: string): Promise<string | undefined> => {
    try {
      // This would require a reverse lookup service, which doesn't exist yet
      // For now, we'll leave this as a placeholder for future implementation
      return undefined;
    } catch {
      return undefined;
    }
  };

  // Sync address book with transaction history
  const syncAddressBook = async () => {
    if (!accountPublicKey || isLoading) return;

    setIsLoading(true);
    try {
      const server = createHorizonServer(network);
      const addressMap = new Map<string, {
        transactionCount: number;
        totalAmount: number;
        lastUsed: Date;
        firstUsed: Date;
      }>();

      // Fetch transaction history (last 200 transactions)
      const transactions = await server
        .transactions()
        .forAccount(accountPublicKey)
        .order('desc')
        .limit(200)
        .call();

      for (const tx of transactions.records) {
        try {
          const operations = await tx.operations();
          
          for (const op of operations.records) {
            if (op.type === 'payment' || op.type === 'create_account') {
              const destination = (op as any).to || (op as any).account;
              const amount = parseFloat((op as any).amount || (op as any).starting_balance || '0');
              
              // Filter out small transactions and self-transactions
              if (amount >= MIN_TRANSACTION_AMOUNT && destination !== accountPublicKey) {
                const txDate = new Date(tx.created_at);
                
                const existing = addressMap.get(destination);
                if (existing) {
                  existing.transactionCount++;
                  existing.totalAmount += amount;
                  existing.lastUsed = new Date(Math.max(existing.lastUsed.getTime(), txDate.getTime()));
                  existing.firstUsed = new Date(Math.min(existing.firstUsed.getTime(), txDate.getTime()));
                } else {
                  addressMap.set(destination, {
                    transactionCount: 1,
                    totalAmount: amount,
                    lastUsed: txDate,
                    firstUsed: txDate,
                  });
                }
              }
            }
          }
        } catch (error) {
          // Skip transactions that fail to load operations
          continue;
        }
      }

      // Convert to AddressBookEntry array and enrich with domains
      const newEntries: AddressBookEntry[] = [];
      for (const [address, data] of addressMap.entries()) {
        const sorobanDomain = await enrichWithSorobanDomain(address);
        const score = calculateScore(data.transactionCount, data.totalAmount, data.lastUsed);
        
        newEntries.push({
          address,
          sorobanDomain,
          score,
          ...data,
        });
      }

      // Sort by score (importance)
      newEntries.sort((a, b) => b.score - a.score);

      setEntries(newEntries);
      const syncTime = new Date();
      setLastSync(syncTime);
      saveToStorage(newEntries, syncTime);

    } catch (error) {
      console.error('Failed to sync address book:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Add or update an address manually (e.g., after a new transaction)
  const addOrUpdateAddress = async (address: string, amount: number = 0) => {
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
      const sorobanDomain = await enrichWithSorobanDomain(address);
      const newEntry: AddressBookEntry = {
        address,
        sorobanDomain,
        transactionCount: 1,
        totalAmount: amount,
        lastUsed: now,
        firstUsed: now,
        score: calculateScore(1, amount, now),
      };
      
      const newEntries = [...entries, newEntry].sort((a, b) => b.score - a.score);
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

  // Clear address book
  const clearAddressBook = () => {
    setEntries([]);
    setLastSync(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  return {
    entries,
    isLoading,
    lastSync,
    syncAddressBook,
    addOrUpdateAddress,
    searchAddresses,
    clearAddressBook,
  };
};