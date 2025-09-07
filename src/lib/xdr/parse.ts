import { Transaction, FeeBumpTransaction, TransactionBuilder, Networks } from '@stellar/stellar-sdk';

export interface ParsedTransaction {
  tx: Transaction | FeeBumpTransaction;
  network: 'public' | 'testnet';
  isFeeBump: boolean;
}

/**
 * Robust XDR parsing that supports both classic and fee-bump transactions
 * Tries both networks to find the correct one
 */
export const tryParseTransaction = (xdr: string): ParsedTransaction | null => {
  if (!xdr?.trim()) return null;

  const networkConfigs = [
    { passphrase: Networks.PUBLIC, network: 'public' as const },
    { passphrase: Networks.TESTNET, network: 'testnet' as const },
  ];

  for (const { passphrase, network } of networkConfigs) {
    try {
      // Try parsing as fee-bump transaction first
      try {
        const feeBumpTx = TransactionBuilder.fromXDR(xdr, passphrase) as FeeBumpTransaction;
        if (feeBumpTx && 'innerTransaction' in feeBumpTx) {
          return {
            tx: feeBumpTx,
            network,
            isFeeBump: true,
          };
        }
      } catch {
        // Not a fee-bump, continue to classic transaction
      }

      // Try parsing as classic transaction
      const tx = new Transaction(xdr, passphrase);
      return {
        tx,
        network,
        isFeeBump: false,
      };
    } catch {
      // Continue to next network
    }
  }

  return null;
};

/**
 * Get the actual transaction for operations (handles fee-bump wrapper)
 */
export const getInnerTransaction = (tx: Transaction | FeeBumpTransaction): Transaction => {
  if ('innerTransaction' in tx) {
    return tx.innerTransaction;
  }
  return tx as Transaction;
};

/**
 * Get source account from any transaction type
 */
export const getSourceAccount = (tx: Transaction | FeeBumpTransaction): string => {
  const innerTx = getInnerTransaction(tx);
  return innerTx.source;
};