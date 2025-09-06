import { Transaction, xdr } from '@stellar/stellar-sdk';
import { getNetworkPassphrase } from '@/lib/stellar';

/**
 * Generates a transaction hash for verification
 */
export const generateTransactionFingerprint = (
  transactionXdr: string,
  network: 'mainnet' | 'testnet'
): string => {
  try {
    const networkPassphrase = getNetworkPassphrase(network);
    const transaction = new Transaction(transactionXdr, networkPassphrase);
    
    // Return full transaction hash
    return transaction.hash().toString('hex');
  } catch (error) {
    console.error('Error generating fingerprint:', error);
    return '';
  }
};

/**
 * Generates a more detailed fingerprint including operation summary
 */
export const generateDetailedFingerprint = (
  transactionXdr: string,
  network: 'mainnet' | 'testnet'
): { hash: string; operationSummary: string; sourceAccount: string } => {
  try {
    const networkPassphrase = getNetworkPassphrase(network);
    const transaction = new Transaction(transactionXdr, networkPassphrase);
    
    const hash = generateTransactionFingerprint(transactionXdr, network);
    const operationSummary = `${transaction.operations.length} op${transaction.operations.length !== 1 ? 's' : ''}`;
    const sourceAccount = transaction.source.substring(0, 4) + '...' + transaction.source.slice(-4);
    
    return {
      hash,
      operationSummary,
      sourceAccount
    };
  } catch (error) {
    console.error('Error generating detailed fingerprint:', error);
    return {
      hash: '',
      operationSummary: 'Unknown ops',
      sourceAccount: 'Unknown'
    };
  }
};