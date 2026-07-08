import { safeStorage } from '@/lib/storage';

type NetworkType = 'mainnet' | 'testnet';

const STORAGE_KEY = 'contract-recents-v1';
const MAX_RECENTS = 5;

type Store = Partial<Record<NetworkType, string[]>>;

const read = (): Store => safeStorage.getJSON<Store>(STORAGE_KEY, {});

export const getRecentContracts = (network: NetworkType): string[] => read()[network] ?? [];

export const pushRecentContract = (network: NetworkType, contractId: string): void => {
  const store = read();
  const existing = store[network] ?? [];
  const next = [contractId, ...existing.filter((id) => id !== contractId)].slice(0, MAX_RECENTS);
  store[network] = next;
  safeStorage.setJSON(STORAGE_KEY, store);
};

export const removeRecentContract = (network: NetworkType, contractId: string): void => {
  const store = read();
  const existing = store[network] ?? [];
  store[network] = existing.filter((id) => id !== contractId);
  safeStorage.setJSON(STORAGE_KEY, store);
};
