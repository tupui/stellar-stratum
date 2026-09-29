import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import { safeStorage } from '@/lib/storage';

type Network = 'mainnet' | 'testnet';

const NETWORK_STORAGE_KEY = 'stellar-network';

interface NetworkContextType {
  network: Network;
  /**
   * `fromLink`: the network comes from a link or QR code rather than the user's own choice. It
   * is not remembered for the next visit, and the app says the link switched it.
   */
  setNetwork: (network: Network, options?: { fromLink?: boolean }) => void;
  /** Set when a link changed the network, until the user acknowledges it. */
  switchedByLink: Network | null;
  acknowledgeLinkSwitch: () => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export const useNetwork = () => {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};

interface NetworkProviderProps {
  children: ReactNode;
}

export const NetworkProvider = ({ children }: NetworkProviderProps) => {
  const [network, setNetworkState] = useState<Network>(() => {
    const saved = safeStorage.get(NETWORK_STORAGE_KEY);
    return saved === 'testnet' || saved === 'mainnet' ? saved : 'mainnet';
  });

  const [switchedByLink, setSwitchedByLink] = useState<Network | null>(null);

  // Stable identity: effects depend on setNetwork and must not re-run on every network change.
  const setNetwork = useCallback((newNetwork: Network, options?: { fromLink?: boolean }) => {
    setNetworkState((current) => {
      if (options?.fromLink) {
        if (current !== newNetwork) setSwitchedByLink(newNetwork);
      } else {
        setSwitchedByLink(null);
        safeStorage.set(NETWORK_STORAGE_KEY, newNetwork);
      }
      return newNetwork;
    });
  }, []);

  const acknowledgeLinkSwitch = useCallback(() => setSwitchedByLink(null), []);

  const value = useMemo(
    () => ({ network, setNetwork, switchedByLink, acknowledgeLinkSwitch }),
    [network, setNetwork, switchedByLink, acknowledgeLinkSwitch],
  );

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
};
