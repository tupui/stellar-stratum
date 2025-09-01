import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Network = 'mainnet' | 'testnet';

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
    // Load from localStorage or default to mainnet
    const saved = localStorage.getItem('stellar-network');
    return (saved === 'testnet' || saved === 'mainnet') ? saved : 'mainnet';
  });

  const setNetwork = (newNetwork: Network) => {
    setNetworkState(newNetwork);
    localStorage.setItem('stellar-network', newNetwork);
  };

  useEffect(() => {
    // Save to localStorage whenever network changes
    localStorage.setItem('stellar-network', network);
  }, [network]);

  return (
    <NetworkContext.Provider value={{ network, setNetwork }}>
      {children}
    </NetworkContext.Provider>
  );
};