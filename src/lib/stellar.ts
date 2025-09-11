import { 
  StellarWalletsKit, 
  ISupportedWallet,
  allowAllModules,
  WalletNetwork
} from '@creit.tech/stellar-wallets-kit';
import { LedgerModule } from '@creit.tech/stellar-wallets-kit/modules/ledger.module';
import { WalletConnectModule, WalletConnectAllowedMethods } from '@creit.tech/stellar-wallets-kit/modules/walletconnect.module';
import { TrezorModule } from '@creit.tech/stellar-wallets-kit/modules/trezor.module';
import { walletConnectConfig, trezorConfig } from './walletConfig';
import { appConfig } from './appConfig';

import { Horizon, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

// Network configuration using centralized config
const getNetworkConfig = (network: 'mainnet' | 'testnet') => ({
  passphrase: network === 'testnet' ? appConfig.TESTNET_PASSPHRASE : appConfig.MAINNET_PASSPHRASE,
  horizonUrl: network === 'testnet' ? appConfig.TESTNET_HORIZON : appConfig.MAINNET_HORIZON
});

// Export network configuration getter for reuse
export const getNetworkPassphrase = (network: 'mainnet' | 'testnet') => getNetworkConfig(network).passphrase;
export const getHorizonUrl = (network: 'mainnet' | 'testnet') => getNetworkConfig(network).horizonUrl;

// Create Stellar Wallets Kit instance for specific network
export const createStellarKit = (network: 'mainnet' | 'testnet' = 'mainnet') => {
  const config = getNetworkConfig(network);
  const modules: any[] = [...allowAllModules(), new LedgerModule()];

  // WalletConnect (optional)
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
  } catch (e) {
  }

  // Trezor (optional)
  try {
    if (trezorConfig.url && trezorConfig.email) {
      modules.push(new TrezorModule({ appUrl: trezorConfig.url, email: trezorConfig.email, appName: 'Stellar Multisig' }));
    }
  } catch (e) {
  }

  return new StellarWalletsKit({
    modules,
    // @ts-expect-error - Freighter types not available - library accepts both enum and passphrase string
    network: config.passphrase,
  });
};

// Default kit for mainnet (backward compatibility)
export const stellarKit = createStellarKit('mainnet');

// Create Horizon server for specific network
export const createHorizonServer = (network: 'mainnet' | 'testnet' = 'mainnet', customUrl?: string) => {
  const config = getNetworkConfig(network);
  const horizonUrl = customUrl || config.horizonUrl;
  return new Horizon.Server(horizonUrl);
};

// Default horizon server for mainnet (backward compatibility)
export const horizonServer = createHorizonServer('mainnet');

export interface AccountData {
  publicKey: string;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
  }>;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers: Array<{
    key: string;
    weight: number;
    type: string;
  }>;
}

export const connectWallet = async (walletId: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<{ publicKey: string; walletName: string }> => {
  try {
    const kit = createStellarKit(network);
    // Set the selected wallet generically
    kit.setWallet(walletId);

    // Try explicit connect when supported by wallet module
    try {
      // @ts-expect-error - Freighter types not available
      if (typeof (kit as any).connect === 'function') {
        await (kit as any).connect();
      }
    } catch {
      // Some wallets don't require connect, continue
    }

    // Request address (triggers permission prompt and account selection for hardware wallets)
    const { address } = await kit.getAddress();

    // Get wallet info
    const supportedWallets = await kit.getSupportedWallets();
    const walletInfo = supportedWallets.find(w => w.id === walletId);

    return {
      publicKey: address,
      walletName: walletInfo?.name || walletId,
    };
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
};

export const fetchAccountData = async (publicKey: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<AccountData> => {
  try {
    const server = createHorizonServer(network);
    const account = await server.loadAccount(publicKey);
    
    return {
      publicKey,
      balances: account.balances.map(balance => {
        const baseBalance = {
          asset_type: balance.asset_type,
          balance: balance.balance
        };
        
        // Add asset_code and asset_issuer for non-native assets
        if (balance.asset_type !== 'native' && 'asset_code' in balance) {
          return {
            ...baseBalance,
            asset_code: balance.asset_code,
            asset_issuer: balance.asset_issuer
          };
        }
        
        return baseBalance;
      }),
      thresholds: {
        low_threshold: account.thresholds.low_threshold,
        med_threshold: account.thresholds.med_threshold,
        high_threshold: account.thresholds.high_threshold
      },
      signers: account.signers.map(signer => ({
        key: signer.key,
        weight: signer.weight,
        type: signer.type
      }))
    };
  } catch (error: any) {
    
    // Check if it's a NotFoundError (account doesn't exist)
    if (error?.name === 'NotFoundError' || 
        error?.response?.status === 404 || 
        error?.response?.type === 'https://stellar.org/horizon-errors/not_found') {
      const networkName = network === 'mainnet' ? 'Mainnet' : 'Testnet';
      throw new Error(
        `Account not found on Stellar ${networkName}. ` +
        `This account doesn't exist yet. To use this account, you need to either: ` +
        `1) Switch to the correct network, or 2) Fund the account first to activate it on ${networkName}.`
      );
    }
    
    // For other errors, provide a generic message
    throw new Error('Failed to load account data from Horizon');
  }
};

export const getSupportedWallets = async (network: 'mainnet' | 'testnet' = 'mainnet'): Promise<ISupportedWallet[]> => {
  try {
    // Create kit for the specified network
    const kit = createStellarKit(network);
    const wallets = await kit.getSupportedWallets();

    // Filter and prioritize wallets
    const priorityOrder = ['freighter', 'xbull', 'ledger', 'lobstr', 'hot', 'albedo', 'rabet'];

    return wallets
      .filter((wallet) => wallet.name)
      .sort((a, b) => {
        const aIndex = priorityOrder.indexOf(a.id.toLowerCase());
        const bIndex = priorityOrder.indexOf(b.id.toLowerCase());
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.name.localeCompare(b.name);
      });
  } catch (error) {
    throw error;
  }
};

export const signTransaction = async (xdr: string): Promise<string> => {
  try {
    const { signedTxXdr } = await stellarKit.signTransaction(xdr);
    return signedTxXdr;
  } catch (error) {
    throw new Error('Failed to sign transaction');
  }
};

export const submitTransaction = async (signedXdr: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<any> => {
  try {
    const config = getNetworkConfig(network);
    const transaction = TransactionBuilder.fromXDR(signedXdr, config.passphrase);
    const server = createHorizonServer(network);
    const result = await server.submitTransaction(transaction);
    return result;
  } catch (error) {
    throw new Error('Failed to submit transaction');
  }
};

// Refractor integration functions
export const submitToRefractor = async (xdr: string, network: 'mainnet' | 'testnet'): Promise<string> => {
  try {
    const apiNetwork = network === 'testnet' ? 'testnet' : 'public';
    
    
    const response = await fetch(`${appConfig.REFRACTOR_API_BASE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        network: apiNetwork,
        xdr,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Refractor API error: ${response.status} - ${errorText}`);
    }

    // Compute hash (ID) to share based on network
    const config = getNetworkConfig(network);
    const tx = TransactionBuilder.fromXDR(xdr, config.passphrase);
    const txHash = tx.hash().toString('hex');
    
    return txHash;
  } catch (error) {
    throw new Error(`Failed to submit to Refractor: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const pullFromRefractor = async (refractorId: string): Promise<string> => {
  try {
    const response = await fetch(`${appConfig.REFRACTOR_API_BASE}/${refractorId}`);

    if (!response.ok) {
      throw new Error('Failed to fetch from Refractor');
    }

    const result = await response.json();
    return result.xdr;
  } catch (error) {
    throw new Error('Failed to fetch transaction from Refractor');
  }
};