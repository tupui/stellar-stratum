import { Transaction, xdr } from '@stellar/stellar-sdk';
import { getNetworkPassphrase } from '@/lib/stellar';

/**
 * Generates a human-readable fingerprint for transaction verification
 */
export const generateTransactionFingerprint = (
  transactionXdr: string,
  network: 'mainnet' | 'testnet'
): string => {
  try {
    const networkPassphrase = getNetworkPassphrase(network);
    const transaction = new Transaction(transactionXdr, networkPassphrase);
    
    // Use transaction hash as base for fingerprint
    const hash = transaction.hash().toString('hex');
    
    // Take first 8 chars, group into 4-char pairs for readability
    const shortHash = hash.substring(0, 8).toUpperCase();
    return `${shortHash.substring(0, 4)}-${shortHash.substring(4, 8)}`;
  } catch (error) {
    console.error('Error generating fingerprint:', error);
    return 'XXXX-XXXX';
  }
};

/**
 * Generates a more detailed fingerprint including operation summary
 */
export const generateDetailedFingerprint = (
  transactionXdr: string,
  network: 'mainnet' | 'testnet'
): { shortFingerprint: string; operationSummary: string; sourceAccount: string } => {
  try {
    const networkPassphrase = getNetworkPassphrase(network);
    const transaction = new Transaction(transactionXdr, networkPassphrase);
    
    const shortFingerprint = generateTransactionFingerprint(transactionXdr, network);
    const operationSummary = `${transaction.operations.length} op${transaction.operations.length !== 1 ? 's' : ''}`;
    const sourceAccount = transaction.source.substring(0, 4) + '...' + transaction.source.slice(-4);
    
    return {
      shortFingerprint,
      operationSummary,
      sourceAccount
    };
  } catch (error) {
    console.error('Error generating detailed fingerprint:', error);
    return {
      shortFingerprint: 'XXXX-XXXX',
      operationSummary: 'Unknown ops',
      sourceAccount: 'Unknown'
    };
  }
};