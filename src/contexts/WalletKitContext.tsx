import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import type { ISupportedWallet } from '@creit-tech/stellar-wallets-kit/types';
import { StellarWalletsKit, WATCHABLE_WALLETS } from '@/lib/walletKit';
import { getTransactionHashFromXdr, passphraseFor, type NetworkId } from '@/lib/xdr/parse';
import { useNetwork } from '@/contexts/NetworkContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface WalletKitContextType {
  wallets: ISupportedWallet[];
  connectedWallet: { id: string; name: string } | null;
  connectWallet: (walletId: string) => Promise<{ publicKey: string; walletName: string }>;
  disconnectWallet: () => void;
  /**
   * Sign `xdr` for `network`. `expectedAddress` asks the wallet (or the hardware account picker)
   * for that signer; callers still verify the returned signature against the transaction.
   */
  signWithWallet: (
    xdr: string,
    walletId: string,
    network: NetworkId,
    expectedAddress?: string,
  ) => Promise<{ signedXdr: string; address: string; walletName: string }>;
  refreshWallets: () => Promise<void>;
  /**
   * Reads the connected wallet's currently-active address live, for wallets that can report it
   * without a prompt. Returns null otherwise, or while a signature is in progress.
   */
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

const PRIORITY_ORDER = ['ghostsig', 'trezor', 'ledger', 'freighter', 'xbull', 'lobstr', 'albedo', 'fordefi'];

const isHardwareWallet = (walletId: string) => {
  const id = walletId.toLowerCase();
  return id.includes('ledger') || id.includes('trezor');
};

const errorName = (error: unknown) => (error && typeof error === 'object' && 'name' in error ? String(error.name) : '');

/**
 * The Ledger app could not display this transaction (too large, or an operation it cannot
 * parse). Only then may it be signed as a bare hash, and only after the user agrees in the app.
 * A refusal on the device ("User refused the request") is never followed by a second prompt.
 */
const cannotClearSign = (error: unknown) =>
  ['StellarDataTooLargeError', 'StellarDataParsingFailedError'].includes(errorName(error)) ||
  /too large for the device|unable to parse the provided data/i.test(error instanceof Error ? error.message : String(error));

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
  // Read inside callbacks without re-creating them. Signing switches the kit's selected module,
  // so the active-account check is paused meanwhile and re-selects the connected wallet itself.
  const connectedWalletRef = useRef(connectedWallet);
  const walletsRef = useRef(wallets);
  useEffect(() => {
    connectedWalletRef.current = connectedWallet;
    walletsRef.current = wallets;
  }, [connectedWallet, wallets]);
  const signingRef = useRef(false);

  // Derivation-path picker shown before every hardware-wallet signature
  const [picker, setPicker] = useState<{
    walletName: string;
    accounts: HardwareAccount[];
    purpose: HardwarePickerPurpose;
  } | null>(null);
  const pickerResolver = useRef<{ resolve: (a: HardwareAccount) => void; reject: (e: Error) => void } | null>(null);

  // Consent to hash signing, with the hash to compare on the device.
  const [hashSigning, setHashSigning] = useState<{ walletName: string; hash: string } | null>(null);
  const hashSigningResolver = useRef<((accepted: boolean) => void) | null>(null);
  const answerHashSigning = useCallback((accepted: boolean) => {
    const resolve = hashSigningResolver.current;
    hashSigningResolver.current = null;
    setHashSigning(null);
    resolve?.(accepted);
  }, []);
  const confirmHashSigning = useCallback(
    (walletName: string, hash: string) =>
      new Promise<boolean>((resolve) => {
        hashSigningResolver.current = resolve;
        setHashSigning({ walletName, hash });
      }),
    [],
  );

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
      // No awaits before the wallet call: popup wallets need the click's user activation.
      const walletName = walletsRef.current.find(w => w.id === walletId)?.name || walletId;

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
          throw new Error('Trezor Safe 7 and newer devices cannot be used through the Trezor Connect pop-up. Open the Trezor Suite desktop app (keep it running), then try again.', { cause: error });
        } else if (errorMsg.includes('transport_missing') || errorMsg.includes('transport is missing') || errorMsg.includes('iframeblocked') || errorMsg.includes('iframetimeout')) {
          throw new Error('No connection to your Trezor. Open the Trezor Suite desktop app (or install Trezor Bridge), connect your device, then try again.', { cause: error });
        } else if (errorMsg.includes('cancelled') || errorMsg.includes('denied')) {
          throw new Error('Connection cancelled. Please try again and approve the connection.', { cause: error });
        } else if (errorMsg.includes('not found') || errorMsg.includes('no device')) {
          throw new Error('Hardware wallet not found. Please connect your device and try again.', { cause: error });
        } else if (errorMsg.includes('popup') || errorMsg.includes('blocked') || errorMsg.includes('iframe') || errorMsg.includes('closed')) {
          throw new Error('Trezor Connect could not open. Allow pop-ups for this site and try again.', { cause: error });
        }
      }


      throw new Error(`Failed to connect to ${walletId}: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }, [loadHardwareAccounts, pickHardwareAccount]);

  const disconnectWallet = useCallback(() => {
    StellarWalletsKit.disconnect().catch(() => {/* ignore */});
    setConnectedWallet(null);
  }, []);

  const fetchActiveAddress = useCallback(async (): Promise<string | null> => {
    const wallet = connectedWalletRef.current;
    if (!wallet || signingRef.current || !WATCHABLE_WALLETS.includes(wallet.id.toLowerCase())) return null;
    try {
      StellarWalletsKit.setWallet(wallet.id);
      const { address } = await StellarWalletsKit.fetchAddress();
      return address || null;
    } catch {
      return null;
    }
  }, []);

  const signWithWallet = useCallback(async (
    xdr: string,
    walletId: string,
    network: NetworkId,
    expectedAddress?: string,
  ): Promise<{ signedXdr: string; address: string; walletName: string }> => {
    signingRef.current = true;
    try {
      StellarWalletsKit.setWallet(walletId);
      const walletName = walletsRef.current.find(w => w.id === walletId)?.name || walletId;
      const networkPassphrase = passphraseFor(network);

      let address = expectedAddress;
      let path: string | undefined;

      if (isHardwareWallet(walletId)) {
        // Always drop the existing device connection first so the user is prompted
        // again for the derivation path (account) they want to sign with.
        const accounts = await loadHardwareAccounts(walletName);
        const selected = await pickHardwareAccount(walletName, accounts, 'sign');
        if (expectedAddress && selected.publicKey !== expectedAddress) {
          throw new Error(
            `The selected device account ${selected.publicKey.slice(0, 8)}… is not the signer ${expectedAddress.slice(0, 8)}…. ` +
            'Pick the matching account and try again.',
          );
        }
        address = selected.publicKey;
        path = walletId.toLowerCase().includes('trezor')
          ? `m/44'/148'/${selected.index}'`
          : `44'/148'/${selected.index}'`;
      }
      // Other wallets are asked to sign straight away: looking the address up first opens a
      // second popup for web wallets (Albedo, xBull, Ghostsig), which the browser then blocks.

      // Prefer "clean signing": hand the full transaction to the device so it can display the
      // operations, instead of a blind hash. Hash signing is only offered when the Ledger app
      // reports it cannot show this transaction, and only once the user has agreed here.
      const options = { networkPassphrase, ...(address ? { address } : {}), ...(path ? { path } : {}) };
      const isLedger = walletId.toLowerCase().includes('ledger');
      let result: { signedTxXdr: string; signerAddress?: string };
      try {
        result = await StellarWalletsKit.signTransaction(xdr, {
          ...options,
          ...(isLedger ? { nonBlindTx: true } : {}),
        } as typeof options);
      } catch (error) {
        if (!isLedger || !cannotClearSign(error)) throw error;
        const accepted = await confirmHashSigning(walletName, getTransactionHashFromXdr(xdr, network));
        if (!accepted) throw new Error('Signing cancelled', { cause: error });
        result = await StellarWalletsKit.signTransaction(xdr, options);
      }

      return { signedXdr: result.signedTxXdr, address: result.signerAddress || address || '', walletName };
    } finally {
      signingRef.current = false;
      if (connectedWalletRef.current) StellarWalletsKit.setWallet(connectedWalletRef.current.id);
    }
  }, [loadHardwareAccounts, pickHardwareAccount, confirmHashSigning]);

  return (
    <WalletKitContext.Provider value={{ wallets, connectedWallet, connectWallet, disconnectWallet, signWithWallet, refreshWallets, fetchActiveAddress }}>
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
      <Dialog open={!!hashSigning} onOpenChange={(open) => { if (!open) answerHashSigning(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{hashSigning?.walletName} cannot show this transaction</DialogTitle>
            <DialogDescription>
              The device can sign the transaction hash instead, but it will not show the operations. Only continue if
              you have reviewed the transaction in this app, and check that the device shows this exact hash.
            </DialogDescription>
          </DialogHeader>
          <p className="font-address text-xs break-all rounded bg-muted p-2">{hashSigning?.hash}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => answerHashSigning(false)}>Cancel</Button>
            <Button onClick={() => answerHashSigning(true)}>Sign the hash</Button>
          </div>
        </DialogContent>
      </Dialog>
    </WalletKitContext.Provider>
  );
};
