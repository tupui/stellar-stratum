import { tryParseTransaction, getInnerTransaction } from '@/lib/xdr/parse';

/**
 * Generates a transaction hash for verification
 */
export const generateTransactionFingerprint = (
  transactionXdr: string,
  network?: 'mainnet' | 'testnet'
): string => {
  try {
    const parsed = tryParseTransaction(transactionXdr);
    if (!parsed) return '';
    
    return parsed.tx.hash().toString('hex');
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
  network?: 'mainnet' | 'testnet'
): { hash: string; operationSummary: string; sourceAccount: string } => {
  try {
    const parsed = tryParseTransaction(transactionXdr);
    if (!parsed) {
      return {
        hash: '',
        operationSummary: 'Unknown ops',
        sourceAccount: 'Unknown'
      };
    }

    const { tx } = parsed;
    const innerTx = getInnerTransaction(tx);
    const hash = generateTransactionFingerprint(transactionXdr, network);
    const operationSummary = `${innerTx.operations.length} op${innerTx.operations.length !== 1 ? 's' : ''}`;
    const sourceAccount = innerTx.source.substring(0, 4) + '...' + innerTx.source.slice(-4);
    
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