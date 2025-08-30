import { 
  StellarWalletsKit, 
  WalletNetwork, 
  allowAllModules,
  ISupportedWallet 
} from '@creit.tech/stellar-wallets-kit';
import { Horizon, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

// Initialize Stellar Wallets Kit instance
export const stellarKit = new StellarWalletsKit({
  network: WalletNetwork.PUBLIC, // Change to TESTNET for testing
  selectedWalletId: undefined,
  modules: allowAllModules(),
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
    // Set the selected wallet
    stellarKit.setWallet(walletId);
    
    // Request access/connection
    const { address } = await stellarKit.getAddress();
    
    // Get wallet info
    const supportedWallets = await stellarKit.getSupportedWallets();
    const walletInfo = supportedWallets.find(w => w.id === walletId);
    
    return {
      publicKey: address,
      walletName: walletInfo?.name || walletId
    };
  } catch (error) {
    console.error('Failed to connect wallet:', error);
    throw new Error(`Failed to connect to ${walletId}`);
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
  return stellarKit.getSupportedWallets();
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

export const submitTransaction = async (signedXdr: string): Promise<any> => {
  try {
    const transaction = TransactionBuilder.fromXDR(signedXdr, 'https://horizon.stellar.org'); // Change for testnet
    const result = await horizonServer.submitTransaction(transaction);
    return result;
  } catch (error) {
    console.error('Failed to submit transaction:', error);
    throw new Error('Failed to submit transaction');
  }
};