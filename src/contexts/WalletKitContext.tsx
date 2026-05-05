import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { ISupportedWallet } from '@creit-tech/stellar-wallets-kit/state';
import { StellarWalletsKit } from '@/lib/walletKit';
import { getNetworkPassphrase } from '@/lib/stellar';
import { useNetwork } from '@/contexts/NetworkContext';

interface WalletKitContextType {
  kit: typeof StellarWalletsKit;
  wallets: ISupportedWallet[];
  connectedWallet: { id: string; name: string } | null;
  connectWallet: (walletId: string) => Promise<{ publicKey: string; walletName: string }>;
  disconnectWallet: () => void;
  signWithWallet: (xdr: string, walletId: string) => Promise<{ signedXdr: string; address: string; walletName: string }>;
  refreshWallets: () => Promise<void>;
}

const WalletKitContext = createContext<WalletKitContextType | undefined>(undefined);

export const useWalletKit = () => {
  const context = useContext(WalletKitContext);
  if (context === undefined) {
    throw new Error('useWalletKit must be used within a WalletKitProvider');
  }
  return context;
};

const PRIORITY_ORDER = ['freighter', 'xbull', 'ledger', 'lobstr', 'hot', 'albedo', 'rabet'];

const sortWallets = (wallets: ISupportedWallet[]): ISupportedWallet[] =>
  wallets
    .filter((wallet) => wallet.name)
    .sort((a, b) => {
      const aIndex = PRIORITY_ORDER.indexOf(a.id.toLowerCase());
      const bIndex = PRIORITY_ORDER.indexOf(b.id.toLowerCase());
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

interface WalletKitProviderProps {
  children: ReactNode;
}

export const WalletKitProvider = ({ children }: WalletKitProviderProps) => {
  const { network } = useNetwork();
  const [wallets, setWallets] = useState<ISupportedWallet[]>([]);
  const [connectedWallet, setConnectedWallet] = useState<{ id: string; name: string } | null>(null);

  const refreshWallets = useCallback(async () => {
    try {
      const supportedWallets = await StellarWalletsKit.refreshSupportedWallets();
      setWallets(sortWallets(supportedWallets));
    } catch {
      // Wallet refresh failed silently
    }
  }, []);

  useEffect(() => {
    refreshWallets();
  }, [network, refreshWallets]);

  const connectWallet = useCallback(async (walletId: string): Promise<{ publicKey: string; walletName: string }> => {
    try {
      StellarWalletsKit.setWallet(walletId);
      let address: string;
      try {
        ({ address } = await StellarWalletsKit.fetchAddress());
      } catch {
        ({ address } = await StellarWalletsKit.getAddress());
      }

      const supportedWallets = await StellarWalletsKit.refreshSupportedWallets();
      const walletInfo = supportedWallets.find(w => w.id === walletId);
      const walletName = walletInfo?.name || walletId;

      setConnectedWallet({ id: walletId, name: walletName });

      return { publicKey: address, walletName };
    } catch (error) {
      const errorMsg = String(error || '').toLowerCase();
      const isHardware = walletId.toLowerCase().includes('ledger') || walletId.toLowerCase().includes('trezor');

      if (isHardware) {
        if (errorMsg.includes('cancelled') || errorMsg.includes('denied')) {
          throw new Error('Connection cancelled. Please try again and approve the connection.');
        } else if (errorMsg.includes('not found') || errorMsg.includes('no device')) {
          throw new Error('Hardware wallet not found. Please connect your device and try again.');
        }
      }

      throw new Error(`Failed to connect to ${walletId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    StellarWalletsKit.disconnect().catch(() => {/* ignore */});
    setConnectedWallet(null);
  }, []);

  const signWithWallet = useCallback(async (
    xdr: string,
    walletId: string
  ): Promise<{ signedXdr: string; address: string; walletName: string }> => {
    StellarWalletsKit.setWallet(walletId);
    let address: string;
    try {
      ({ address } = await StellarWalletsKit.getAddress());
    } catch {
      ({ address } = await StellarWalletsKit.fetchAddress());
    }

    const networkPassphrase = getNetworkPassphrase(network);
    const result = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase,
      address,
    });

    const supported = await StellarWalletsKit.refreshSupportedWallets();
    const info = supported.find(w => w.id === walletId);

    return { signedXdr: result.signedTxXdr, address, walletName: info?.name || walletId };
  }, [network]);

  return (
    <WalletKitContext.Provider value={{ kit: StellarWalletsKit, wallets, connectedWallet, connectWallet, disconnectWallet, signWithWallet, refreshWallets }}>
      {children}
    </WalletKitContext.Provider>
  );
};
