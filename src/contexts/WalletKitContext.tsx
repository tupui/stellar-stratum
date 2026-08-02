import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import type { ISupportedWallet } from '@creit-tech/stellar-wallets-kit/types';
import { StellarWalletsKit } from '@/lib/walletKit';
import { getNetworkPassphrase } from '@/lib/stellar';
import { useNetwork } from '@/contexts/NetworkContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface WalletKitContextType {
  kit: typeof StellarWalletsKit;
  wallets: ISupportedWallet[];
  connectedWallet: { id: string; name: string } | null;
  connectWallet: (walletId: string) => Promise<{ publicKey: string; walletName: string }>;
  disconnectWallet: () => void;
  signWithWallet: (xdr: string, walletId: string) => Promise<{ signedXdr: string; address: string; walletName: string }>;
  refreshWallets: () => Promise<void>;
  /** Reads the wallet's currently-active address live (not the cached connect-time value). Returns null if unavailable. */
  fetchActiveAddress: () => Promise<string | null>;
}

const WalletKitContext = createContext<WalletKitContextType | undefined>(undefined);

export const useWalletKit = () => {
  const context = useContext(WalletKitContext);
  if (context === undefined) {
    throw new Error('useWalletKit must be used within a WalletKitProvider');
  }
  return context;
};

const PRIORITY_ORDER = ['trezor', 'ledger', 'freighter', 'xbull', 'lobstr', 'hot', 'albedo', 'fordefi'];

const isHardwareWallet = (walletId: string) => {
  const id = walletId.toLowerCase();
  return id.includes('ledger') || id.includes('trezor');
};

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

interface HardwareAccount { publicKey: string; index: number }
type HardwarePickerPurpose = 'connect' | 'sign';

interface HardwareModule {
  disconnect?: () => Promise<void>;
  getAddresses?: (page?: number) => Promise<HardwareAccount[]>;
}

interface WalletKitProviderProps {
  children: ReactNode;
}

export const WalletKitProvider = ({ children }: WalletKitProviderProps) => {
  const { network } = useNetwork();
  const [wallets, setWallets] = useState<ISupportedWallet[]>([]);
  const [connectedWallet, setConnectedWallet] = useState<{ id: string; name: string } | null>(null);

  // Derivation-path picker shown before every hardware-wallet signature
  const [picker, setPicker] = useState<{
    walletName: string;
    accounts: HardwareAccount[];
    purpose: HardwarePickerPurpose;
  } | null>(null);
  const pickerResolver = useRef<{ resolve: (a: HardwareAccount) => void; reject: (e: Error) => void } | null>(null);

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

  const closePicker = useCallback(() => {
    const resolver = pickerResolver.current;
    pickerResolver.current = null;
    setPicker(null);
    resolver?.reject(new Error('Account selection cancelled'));
  }, []);

  const pickHardwareAccount = useCallback((
    walletName: string,
    accounts: HardwareAccount[],
    purpose: HardwarePickerPurpose,
  ) => {
    if (accounts.length === 0) {
      return Promise.reject(new Error(`${walletName} did not return any Stellar accounts`));
    }

    return new Promise<HardwareAccount>((resolve, reject) => {
      pickerResolver.current = { resolve, reject };
      setPicker({ walletName, accounts, purpose });
    });
  }, []);

  const loadHardwareAccounts = useCallback(async (walletName: string): Promise<HardwareAccount[]> => {
    const hardwareModule = StellarWalletsKit.selectedModule as unknown as HardwareModule;
    try {
      await hardwareModule.disconnect?.();
    } catch {
      // A stale transport may already be closed; opening a fresh one is still safe.
    }
    await new Promise(resolve => setTimeout(resolve, 500));

    if (!hardwareModule.getAddresses) {
      throw new Error(`${walletName} does not expose device accounts`);
    }
    return hardwareModule.getAddresses(0);
  }, []);

  const connectWallet = useCallback(async (walletId: string): Promise<{ publicKey: string; walletName: string }> => {
    try {
      StellarWalletsKit.setWallet(walletId);
      const supportedWallets = await StellarWalletsKit.refreshSupportedWallets();
      const walletInfo = supportedWallets.find(w => w.id === walletId);
      const walletName = walletInfo?.name || walletId;

      let address: string;
      if (isHardwareWallet(walletId)) {
        // Trezor and Ledger cannot return an address until a derivation path has
        // been selected. Fetch the device accounts first instead of calling the
        // kit's path-dependent fetchAddress().
        const accounts = await loadHardwareAccounts(walletName);
        const selected = await pickHardwareAccount(walletName, accounts, 'connect');
        address = selected.publicKey;
      } else {
        // Fetch the live active address for extension/web wallets.
        const result = await StellarWalletsKit.fetchAddress();
        address = result.address;
      }

      setConnectedWallet({ id: walletId, name: walletName });

      return { publicKey: address, walletName };
    } catch (error) {
      const errorMsg = String(error || '').toLowerCase();

      if (import.meta.env.DEV) console.error(`[wallet] connect failed (${walletId})`, error);

      if (isHardwareWallet(walletId)) {
        if (errorMsg.includes('connect popup') || errorMsg.includes('safe 7') || errorMsg.includes('not supported by connect')) {
          throw new Error('Trezor Safe 7 and newer devices cannot be used through the Trezor Connect pop-up. Open the Trezor Suite desktop app (keep it running), then try again.');
        } else if (errorMsg.includes('transport_missing') || errorMsg.includes('transport is missing') || errorMsg.includes('iframeblocked') || errorMsg.includes('iframetimeout')) {
          throw new Error('No connection to your Trezor. Open the Trezor Suite desktop app (or install Trezor Bridge), connect your device, then try again.');
        } else if (errorMsg.includes('cancelled') || errorMsg.includes('denied')) {
          throw new Error('Connection cancelled. Please try again and approve the connection.');
        } else if (errorMsg.includes('not found') || errorMsg.includes('no device')) {
          throw new Error('Hardware wallet not found. Please connect your device and try again.');
        } else if (errorMsg.includes('popup') || errorMsg.includes('blocked') || errorMsg.includes('iframe') || errorMsg.includes('closed')) {
          throw new Error('Trezor Connect could not open. Allow pop-ups for this site and try again.');
        }
      }


      throw new Error(`Failed to connect to ${walletId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [loadHardwareAccounts, pickHardwareAccount]);

  const disconnectWallet = useCallback(() => {
    StellarWalletsKit.disconnect().catch(() => {/* ignore */});
    setConnectedWallet(null);
  }, []);

  const fetchActiveAddress = useCallback(async (): Promise<string | null> => {
    try {
      const { address } = await StellarWalletsKit.fetchAddress();
      return address || null;
    } catch {
      return null;
    }
  }, []);

  const signWithWallet = useCallback(async (
    xdr: string,
    walletId: string
  ): Promise<{ signedXdr: string; address: string; walletName: string }> => {
    StellarWalletsKit.setWallet(walletId);

    const supported = await StellarWalletsKit.refreshSupportedWallets();
    const info = supported.find(w => w.id === walletId);
    const walletName = info?.name || walletId;
    const networkPassphrase = getNetworkPassphrase(network);

    let address: string;
    let path: string | undefined;

    if (isHardwareWallet(walletId)) {
      // Always drop the existing device connection first so the user is prompted
      // again for the derivation path (account) they want to sign with.
      const accounts = await loadHardwareAccounts(walletName);
      const selected = await pickHardwareAccount(walletName, accounts, 'sign');
      address = selected.publicKey;
      path = walletId.toLowerCase().includes('trezor')
        ? `m/44'/148'/${selected.index}'`
        : `44'/148'/${selected.index}'`;
    } else {
      // Fetch the wallet's live active account (reflects account switches in e.g.
      // Freighter) rather than the kit's cached connect-time address.
      const fetched = await StellarWalletsKit.fetchAddress();
      address = fetched.address;
    }

    // Prefer "clean signing": hand the full transaction to the device so it can
    // display the operations, instead of a blind hash. Fall back to the default
    // path when the device/transaction combination cannot be clear-signed.
    let result: { signedTxXdr: string; signerAddress?: string };
    try {
      result = await StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase,
        address,
        ...(path ? { path } : {}),
        ...(isHardwareWallet(walletId) ? { nonBlindTx: true } : {}),
      } as { networkPassphrase: string; address: string; path?: string });
    } catch (error) {
      if (!isHardwareWallet(walletId)) throw error;
      result = await StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase,
        address,
        ...(path ? { path } : {}),
      });
    }

    // Prefer the address the wallet reports as the actual signer, so a mismatched
    // account can never be silently attributed to the requested one.
    const signerAddress = result.signerAddress || address;

    return { signedXdr: result.signedTxXdr, address: signerAddress, walletName };
  }, [network, loadHardwareAccounts, pickHardwareAccount]);

  return (
    <WalletKitContext.Provider value={{ kit: StellarWalletsKit, wallets, connectedWallet, connectWallet, disconnectWallet, signWithWallet, refreshWallets, fetchActiveAddress }}>
      {children}
      <Dialog open={!!picker} onOpenChange={(open) => { if (!open) closePicker(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select {picker?.walletName} account</DialogTitle>
            <DialogDescription>
              {picker?.purpose === 'sign'
                ? 'Choose the derivation path to sign this transaction with.'
                : 'Choose the Stellar account to connect.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {picker?.accounts.map((account) => (
              <Button
                key={account.publicKey}
                variant="outline"
                className="w-full justify-between font-address text-xs"
                onClick={() => {
                  const resolver = pickerResolver.current;
                  pickerResolver.current = null;
                  setPicker(null);
                  resolver?.resolve(account);
                }}
              >
                <span>{account.publicKey.slice(0, 8)}…{account.publicKey.slice(-8)}</span>
                <span className="text-muted-foreground">44'/148'/{account.index}'</span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </WalletKitContext.Provider>
  );
};
