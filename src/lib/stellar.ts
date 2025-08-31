import { 
  StellarWalletsKit, 
  ISupportedWallet,
  allowAllModules,
  FREIGHTER_ID
} from '@creit.tech/stellar-wallets-kit';
import { LedgerModule } from '@creit.tech/stellar-wallets-kit/modules/ledger.module';
import { Horizon, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

// Initialize Stellar Wallets Kit using the working pattern (use passphrase for maximum compatibility)
export const stellarKit = new StellarWalletsKit({
  modules: [...allowAllModules(), new LedgerModule()],
  // @ts-ignore - library accepts both enum and passphrase string
  network: 'Public Global Stellar Network ; September 2015',
  selectedWalletId: FREIGHTER_ID,
});

// Horizon server for account data
export const horizonServer = new Horizon.Server('https://horizon.stellar.org'); // Change to testnet for testing

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

export const connectWallet = async (walletId: string): Promise<{ publicKey: string; walletName: string }> => {
  try {
    console.log('Connecting to wallet:', walletId);

    // Direct Freighter path for reliability
    if (walletId.toLowerCase().includes('freighter')) {
      console.log('Checking for Freighter in iframe environment...');
      console.log('window.freighterApi:', (window as any).freighterApi);
      console.log('window.freighter:', (window as any).freighter);
      
      const isInIframe = window !== window.top;
      console.log('Running in iframe:', isInIframe);
      
      if (isInIframe) {
        console.warn('Freighter in iframe detected; attempting StellarWalletsKit fallback');
        try {
          const kit = stellarKit;
          kit.setWallet(FREIGHTER_ID);
          // @ts-ignore
          if (typeof (kit as any).connect === 'function') {
            await (kit as any).connect();
          }
          const { address } = await kit.getAddress();
          console.log('Freighter fallback via StellarWalletsKit succeeded:', address);
          return { publicKey: address, walletName: 'Freighter' };
        } catch (fallbackErr) {
          console.error('Freighter fallback via StellarWalletsKit failed:', fallbackErr);
          console.warn('Will try direct window.freighterApi access next');
        }
      }
      
      const w = (window as any).freighterApi || (window as any).freighter;
      if (!w) {
        console.log('Freighter extension not found on window object (likely due to iframe or missing extension)');
        throw new Error('Freighter extension not accessible. Please open this app in a new tab or install Freighter.');
      }
      
      console.log('Freighter object found:', w);
      console.log('Freighter methods:', Object.keys(w));
      
      try {
        const isConnected = typeof w.isConnected === 'function' ? await w.isConnected() : false;
        if (!isConnected) {
          if (typeof w.requestAccess === 'function') {
            await w.requestAccess();
          } else if (typeof w.connect === 'function') {
            await w.connect();
          }
        }
      } catch (error) {
        console.warn('Freighter access check failed:', error);
      }

      const address = (await (w.getPublicKey?.() || w.requestPublicKey?.())) as string;
      if (!address || !/^G[A-Z2-7]{55}$/.test(address)) {
        throw new Error('Freighter did not return a valid public key');
      }
      return { publicKey: address, walletName: 'Freighter' };
    }
    
    // Use the stellarKit directly - it already has all modules
    const kit = stellarKit;

    // Set the selected wallet
    kit.setWallet(walletId);

    // Explicitly connect for Freighter and similar extension wallets
    try {
      // @ts-ignore
      if (typeof (kit as any).connect === 'function') {
        await (kit as any).connect();
      }
    } catch (e) {
      // ignore and continue to getAddress
    }
    
    // Request address (triggers permission prompt and account selection for hardware wallets)
    const { address } = await kit.getAddress();
    
    console.log('Successfully connected to:', address);
    
    // Get wallet info
    const supportedWallets = await kit.getSupportedWallets();
    const walletInfo = supportedWallets.find(w => w.id === walletId);
    
    return {
      publicKey: address,
      walletName: walletInfo?.name || walletId
    };
  } catch (error) {
    console.error('Wallet connection failed:', error);
    
    // Provide user-friendly error messages
    const errorMsg = String(error || '').toLowerCase();
    const isHardware = walletId.toLowerCase().includes('ledger') || walletId.toLowerCase().includes('trezor');
    
    if (isHardware) {
      if (errorMsg.includes('cancelled') || errorMsg.includes('denied')) {
        throw new Error('Connection cancelled. Please try again and approve the connection.');
      } else if (errorMsg.includes('not found') || errorMsg.includes('no device')) {
        throw new Error('Hardware wallet not found. Please connect your device and try again.');
      }
    }
    
    // For Freighter and other wallets, provide generic error with original message
    throw new Error(`Failed to connect to ${walletId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const fetchAccountData = async (publicKey: string): Promise<AccountData> => {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    
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
  } catch (error) {
    console.error('Failed to fetch account data:', error);
    throw new Error('Failed to load account data from Horizon');
  }
};

export const getSupportedWallets = async (): Promise<ISupportedWallet[]> => {
  try {
    // Use stellarKit directly - it already has all modules loaded
    const wallets = await stellarKit.getSupportedWallets();
    console.log('Available wallets:', wallets.map(w => ({ id: w.id, name: w.name, available: w.isAvailable })));
    
    // Filter and prioritize wallets
    const priorityOrder = ['freighter', 'xbull', 'ledger', 'trezor', 'albedo', 'rabet'];
    
    return wallets
      .filter(wallet => wallet.name) // Only include wallets with names
      .sort((a, b) => {
        const aIndex = priorityOrder.indexOf(a.id.toLowerCase());
        const bIndex = priorityOrder.indexOf(b.id.toLowerCase());
        
        // If both are in priority list, sort by index
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        
        // If only one is in priority list, prioritize it
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        
        // Otherwise sort alphabetically
        return a.name.localeCompare(b.name);
      });
  } catch (error) {
    console.error('Failed to get supported wallets:', error);
    throw error;
  }
};

export const signTransaction = async (xdr: string): Promise<string> => {
  try {
    const { signedTxXdr } = await stellarKit.signTransaction(xdr);
    return signedTxXdr;
  } catch (error) {
    console.error('Failed to sign transaction:', error);
    throw new Error('Failed to sign transaction');
  }
};

export const submitTransaction = async (signedXdr: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<any> => {
  try {
    const networkPassphrase = network === 'testnet' ? 'Test SDF Network ; September 2015' : 'Public Global Stellar Network ; September 2015';
    const serverUrl = network === 'testnet' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org';
    
    const transaction = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
    const server = new Horizon.Server(serverUrl);
    const result = await server.submitTransaction(transaction);
    return result;
  } catch (error) {
    console.error('Failed to submit transaction:', error);
    throw new Error('Failed to submit transaction');
  }
};

// Refractor integration functions
export const submitToRefractor = async (xdr: string, network: 'mainnet' | 'testnet'): Promise<string> => {
  try {
    const apiNetwork = network === 'testnet' ? 'testnet' : 'public';
    const response = await fetch('https://api.refractor.space/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        network: apiNetwork,
        xdr,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to submit to Refractor');
    }

    // Compute hash (ID) to share based on network
    const networkPassphrase = apiNetwork === 'testnet' ? 'Test SDF Network ; September 2015' : 'Public Global Stellar Network ; September 2015';
    const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
    return tx.hash().toString('hex');
  } catch (error) {
    console.error('Failed to submit to Refractor:', error);
    throw new Error('Failed to submit to Refractor');
  }
};

export const pullFromRefractor = async (refractorId: string): Promise<string> => {
  try {
    const response = await fetch(`https://api.refractor.space/tx/${refractorId}`);

    if (!response.ok) {
      throw new Error('Failed to fetch from Refractor');
    }

    const result = await response.json();
    return result.xdr;
  } catch (error) {
    console.error('Failed to pull from Refractor:', error);
    throw new Error('Failed to fetch transaction from Refractor');
  }
};