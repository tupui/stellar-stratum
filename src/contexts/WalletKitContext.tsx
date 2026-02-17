import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import {
  StellarWalletsKit,
  ISupportedWallet,
  allowAllModules,
  WalletNetwork
} from '@creit.tech/stellar-wallets-kit';
import { LedgerModule } from '@creit.tech/stellar-wallets-kit/modules/ledger.module';
import { WalletConnectModule, WalletConnectAllowedMethods } from '@creit.tech/stellar-wallets-kit/modules/walletconnect.module';
import { TrezorModule } from '@creit.tech/stellar-wallets-kit/modules/trezor.module';
import { walletConnectConfig, trezorConfig } from '@/lib/walletConfig';
import { getNetworkPassphrase } from '@/lib/stellar';
import { useNetwork } from '@/contexts/NetworkContext';

interface WalletKitContextType {
  kit: StellarWalletsKit | null;
  wallets: ISupportedWallet[];
  connectedWallet: { id: string; name: string } | null;
  connectWallet: (walletId: string) => Promise<{ publicKey: string; walletName: string }>;
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

const createKit = (network: 'mainnet' | 'testnet'): StellarWalletsKit => {
  const passphrase = getNetworkPassphrase(network);
  const modules: unknown[] = [...allowAllModules(), new LedgerModule()];

  try {
    if (walletConnectConfig.projectId) {
      modules.push(
        new WalletConnectModule({
          url: walletConnectConfig.url ?? (typeof window !== 'undefined' ? window.location.origin : ''),
          projectId: walletConnectConfig.projectId,
          method: WalletConnectAllowedMethods.SIGN,
          description: walletConnectConfig.description ?? 'Connect with WalletConnect',
          name: walletConnectConfig.name ?? 'Stellar DApp',
          icons: walletConnectConfig.iconUrl ? [walletConnectConfig.iconUrl] : [],
          network: network === 'testnet' ? WalletNetwork.TESTNET : WalletNetwork.PUBLIC,
        })
      );
    }
  } catch {
    // WalletConnect not available
  }

  try {
    if (trezorConfig.url && trezorConfig.email) {
      modules.push(new TrezorModule({ appUrl: trezorConfig.url, email: trezorConfig.email, appName: 'Stellar Multisig' }));
    }
  } catch {
    // Trezor not available
  }

  return new StellarWalletsKit({
    modules: modules as any[],
    // @ts-expect-error - Freighter types not available - library accepts both enum and passphrase string
    network: passphrase,
  });
};

const tryConnectWallet = async (kit: StellarWalletsKit): Promise<void> => {
  if (typeof (kit as any).connect === 'function') {
    try {
      await (kit as any).connect();
    } catch {
      // Some wallets don't require connect, continue
    }
  }
};

const signWithLedgerModule = async (
  kit: StellarWalletsKit,
  xdr: string,
  address: string
): Promise<string> => {
  const selectedModule = (kit as any).selectedModule;
  const networkResult = await kit.getNetwork();

  if (selectedModule && typeof selectedModule.signTransaction === 'function') {
    const result = await selectedModule.signTransaction(xdr, {
      networkPassphrase: networkResult.networkPassphrase,
      address,
      nonBlindTx: true
    });
    return result.signedTxXdr;
  }

  // Fallback to regular signing if module access fails
  const result = await kit.signTransaction(xdr);
  return result.signedTxXdr;
};

interface WalletKitProviderProps {
  children: ReactNode;
}

export const WalletKitProvider = ({ children }: WalletKitProviderProps) => {
  const { network } = useNetwork();
  const kitRef = useRef<StellarWalletsKit | null>(null);
  const [kit, setKit] = useState<StellarWalletsKit | null>(null);
  const [wallets, setWallets] = useState<ISupportedWallet[]>([]);
  const [connectedWallet, setConnectedWallet] = useState<{ id: string; name: string } | null>(null);

  // Recreate kit when network changes
  useEffect(() => {
    const instance = createKit(network);
    kitRef.current = instance;
    setKit(instance);

    // Fetch wallets for the new kit
    instance.getSupportedWallets().then((supportedWallets) => {
      setWallets(sortWallets(supportedWallets));
    }).catch(() => {
      // Wallet fetch failed silently
    });
  }, [network]);

  const refreshWallets = useCallback(async () => {
    const currentKit = kitRef.current;
    if (!currentKit) return;

    try {
      const supportedWallets = await currentKit.getSupportedWallets();
      setWallets(sortWallets(supportedWallets));
    } catch {
      // Wallet refresh failed silently
    }
  }, []);

  const connectWallet = useCallback(async (walletId: string): Promise<{ publicKey: string; walletName: string }> => {
    const currentKit = kitRef.current;
    if (!currentKit) throw new Error('Wallet kit not initialized');

    try {
      currentKit.setWallet(walletId);
      await tryConnectWallet(currentKit);
      const { address } = await currentKit.getAddress();

      const supportedWallets = await currentKit.getSupportedWallets();
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

  const signWithWallet = useCallback(async (
    xdr: string,
    walletId: string
  ): Promise<{ signedXdr: string; address: string; walletName: string }> => {
    const currentKit = kitRef.current;
    if (!currentKit) throw new Error('Wallet kit not initialized');

    currentKit.setWallet(walletId);
    await tryConnectWallet(currentKit);
    const { address } = await currentKit.getAddress();

    const isLedger = walletId.toLowerCase().includes('ledger');

    let signedTxXdr: string;
    if (isLedger) {
      signedTxXdr = await signWithLedgerModule(currentKit, xdr, address);
    } else {
      const result = await currentKit.signTransaction(xdr);
      signedTxXdr = result.signedTxXdr;
    }

    const supported = await currentKit.getSupportedWallets();
    const info = supported.find(w => w.id === walletId);

    return { signedXdr: signedTxXdr, address, walletName: info?.name || walletId };
  }, []);

  return (
    <WalletKitContext.Provider value={{ kit, wallets, connectedWallet, connectWallet, signWithWallet, refreshWallets }}>
      {children}
    </WalletKitContext.Provider>
  );
};
