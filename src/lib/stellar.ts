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
    // Always use mainnet for Refractor regardless of the network parameter
    const apiNetwork = 'public';

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
