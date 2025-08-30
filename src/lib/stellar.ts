import { 
  StellarWalletsKit, 
  WalletNetwork, 
  ISupportedWallet,
  xBullModule,
  FreighterModule,
  AlbedoModule,
  RabetModule
} from '@creit.tech/stellar-wallets-kit';
import { Horizon, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

// Initialize base modules that work reliably
const getBaseModules = () => {
  return [
    new xBullModule(),
    new FreighterModule(),
    new AlbedoModule(), 
    new RabetModule(),
  ];
};

// Safely add hardware wallet modules with error handling
const getHardwareModules = async () => {
  const modules: any[] = [];
  
  // Set up Buffer globally FIRST - before any module imports
  try {
    const { Buffer } = await import('buffer');
    
    // Make Buffer available globally in multiple ways for maximum compatibility
    if (typeof window !== 'undefined') {
      (window as any).Buffer = Buffer;
    }
    if (typeof globalThis !== 'undefined') {
      (globalThis as any).Buffer = Buffer;
    }
    if (typeof global !== 'undefined') {
      (global as any).Buffer = Buffer;
    }
    
    // Small delay to ensure Buffer is properly set before module evaluation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Now try to load Ledger module
    try {
      const { LedgerModule } = await import('@creit.tech/stellar-wallets-kit/modules/ledger.module');
      modules.push(new LedgerModule());
      console.log('Ledger module loaded successfully');
    } catch (ledgerError) {
      console.warn('Ledger module failed to load:', ledgerError);
    }
  } catch (bufferError) {
    console.warn('Buffer polyfill failed:', bufferError);
  }
  
  try {
    // Try to load Trezor module
    const { TrezorModule } = await import('@creit.tech/stellar-wallets-kit/modules/trezor.module');
    
    modules.push(new TrezorModule({
      appUrl: typeof window !== 'undefined' ? window.location.origin : 'https://localhost:5173',
      appName: "Stellar Multisig Wallet",
      email: "support@yourdomain.com",
    }));
    console.log('Trezor module loaded successfully');
  } catch (error) {
    console.warn('Trezor module not available:', error);
  }
  
  return modules;
};

// Initialize Stellar Wallets Kit instance with safe module loading
export const createStellarKit = async () => {
  const baseModules = getBaseModules();
  const hardwareModules = await getHardwareModules();
  
  return new StellarWalletsKit({
    network: WalletNetwork.PUBLIC,
    selectedWalletId: undefined,
    modules: [...baseModules, ...hardwareModules],
  });
};

// Initialize with base modules immediately, hardware modules loaded later
export const stellarKit = new StellarWalletsKit({
  network: WalletNetwork.PUBLIC,
  selectedWalletId: undefined,
  modules: getBaseModules(),
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
    console.log('Attempting to connect wallet with ID:', walletId);
    
    // Use the enhanced kit that has hardware wallets loaded
    let kit = stellarKit;
    try {
      kit = await createStellarKit();
    } catch (error) {
      console.warn('Using base kit for connection:', error);
    }
    
    // Set the selected wallet
    kit.setWallet(walletId);
    
    // Special handling for hardware wallets
    const isLedger = walletId.toLowerCase().includes('ledger');
    const isTrezor = walletId.toLowerCase().includes('trezor');
    
    if (isLedger || isTrezor) {
      // Hardware wallet specific error handling
      try {
        console.log('Connecting to hardware wallet:', walletId);
        const { address } = await kit.getAddress();
        
        // Get wallet info
        const supportedWallets = await kit.getSupportedWallets();
        const walletInfo = supportedWallets.find(w => w.id === walletId);
        
        return {
          publicKey: address,
          walletName: walletInfo?.name || walletId
        };
      } catch (hwError: any) {
        console.error('Hardware wallet error:', hwError);
        const errorMsg = String(hwError?.message || '').toLowerCase();
        
        if (isLedger) {
          if (errorMsg.includes('no device') || errorMsg.includes('not found')) {
            throw new Error('Ledger device not found. Please connect your Ledger device via USB.');
          } else if (errorMsg.includes('locked') || errorMsg.includes('unlock')) {
            throw new Error('Please unlock your Ledger device and try again.');
          } else if (errorMsg.includes('app') || errorMsg.includes('stellar')) {
            throw new Error('Please open the Stellar app on your Ledger device.');
          } else if (errorMsg.includes('denied') || errorMsg.includes('rejected')) {
            throw new Error('Connection denied. Please approve the connection on your Ledger device.');
          } else if (errorMsg.includes('timeout')) {
            throw new Error('Connection timeout. Please check your Ledger device and try again.');
          }
        }
        
        if (isTrezor) {
          if (errorMsg.includes('bridge') || errorMsg.includes('not found')) {
            throw new Error('Trezor Bridge not found. Please install Trezor Bridge and connect your device.');
          } else if (errorMsg.includes('popup') || errorMsg.includes('cancelled')) {
            throw new Error('Connection cancelled. Please approve the connection in the Trezor popup.');
          }
        }
        
        // Generic hardware wallet error
        throw new Error(`Hardware wallet connection failed: ${hwError?.message || 'Unknown error'}`);
      }
    }

    // Regular wallet connection flow
    try {
      // @ts-ignore - connect may not exist for all modules
      if (typeof (kit as any).connect === 'function') {
        await (kit as any).connect();
      }
    } catch (e) {
      // Ignore connect errors here, we'll retry on getAddress
    }
    
    // Request address (triggers permission prompt when needed)
    let address: string;
    try {
      ({ address } = await kit.getAddress());
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('not connected') || msg.includes('connect')) {
        // Retry after attempting connect
        try {
          // @ts-ignore
          if (typeof (kit as any).connect === 'function') {
            await (kit as any).connect();
          }
          ({ address } = await kit.getAddress());
        } catch (retryErr) {
          throw retryErr;
        }
      } else {
        throw err;
      }
    }
    
    // Get wallet info
    const supportedWallets = await kit.getSupportedWallets();
    const walletInfo = supportedWallets.find(w => w.id === walletId);
    
    return {
      publicKey: address,
      walletName: walletInfo?.name || walletId
    };
  } catch (error) {
    console.error('Failed to connect wallet:', error);
    throw error; // Re-throw the error as-is to preserve specific error messages
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
    // Try to create enhanced kit with hardware wallets first
    let kit = stellarKit;
    
    try {
      kit = await createStellarKit();
    } catch (error) {
      console.warn('Failed to load hardware wallet modules, using base modules:', error);
      // Fallback to base stellarKit if hardware modules fail
    }
    
    const wallets = await kit.getSupportedWallets();
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