import { 
  StellarWalletsKit, 
  allowAllModules,
  FREIGHTER_ID,
} from '@creit.tech/stellar-wallets-kit';
import { LedgerModule } from '@creit.tech/stellar-wallets-kit/modules/ledger.module';

// Map app network to Stellar passphrase string (aligns with working dApp pattern)
const getPassphrase = (network: 'mainnet' | 'testnet') =>
  network === 'testnet'
    ? 'Test SDF Network ; September 2015'
    : 'Public Global Stellar Network ; September 2015';

export const createWalletKit = (walletId?: string, network: 'mainnet' | 'testnet' = 'mainnet') => {
  const kit = new StellarWalletsKit({
    modules: [...allowAllModules(), new LedgerModule()],
    // Use passphrase string for compatibility with various wallets (e.g., Freighter)
    // @ts-ignore - library accepts both enum and passphrase string
    network: getPassphrase(network),
    selectedWalletId: walletId || FREIGHTER_ID,
  });
  if (walletId) kit.setWallet(walletId);
  return kit;
};

export const signWithWallet = async (
  xdr: string,
  walletId: string,
  network: 'mainnet' | 'testnet'
): Promise<{ signedXdr: string; address: string; walletName: string }> => {
  const kit = createWalletKit(walletId, network);

  // Try explicit connect when supported by wallet module
  // @ts-ignore
  if (typeof (kit as any).connect === 'function') {
    try {
      // @ts-ignore
      await (kit as any).connect();
    } catch {
      // Some wallets don't require connect, continue
    }
  }

  const { address } = await kit.getAddress();
  const { signedTxXdr } = await kit.signTransaction(xdr);

  const supported = await kit.getSupportedWallets();
  const info = supported.find(w => w.id === walletId);

  return { signedXdr: signedTxXdr, address, walletName: info?.name || walletId };
};
