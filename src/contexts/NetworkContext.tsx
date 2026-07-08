import { createContext, useContext, useState, ReactNode } from 'react';
import { safeStorage } from '@/lib/storage';

type Network = 'mainnet' | 'testnet';

const NETWORK_STORAGE_KEY = 'stellar-network';

interface NetworkContextType {
  network: Network;
  setNetwork: (network: Network) => void;
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

  const setNetwork = (newNetwork: Network) => {
    setNetworkState(newNetwork);
    safeStorage.set(NETWORK_STORAGE_KEY, newNetwork);
  };

  return (
    <NetworkContext.Provider value={{ network, setNetwork }}>
      {children}
    </NetworkContext.Provider>
  );
};
