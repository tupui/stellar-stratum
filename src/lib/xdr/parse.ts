import { Transaction, FeeBumpTransaction, TransactionBuilder, Networks, xdr as StellarXdr } from '@stellar/stellar-sdk';

export type NetworkId = 'mainnet' | 'testnet';

export const passphraseFor = (network: NetworkId): string =>
  network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;

interface ParsedTransaction {
  tx: Transaction | FeeBumpTransaction;
  isFeeBump: boolean;
}

/**
 * Parse a classic or fee-bump transaction envelope for the given network.
 *
 * The network passphrase is not part of the XDR: any envelope decodes under any passphrase,
 * only the hash (and so what a signature commits to) changes. The network must therefore
 * come from the caller (app state, SEP-7 network_passphrase, Refractor metadata), never
 * from trying to parse.
 */
export const tryParseTransaction = (xdr: string, network: NetworkId): ParsedTransaction | null => {
  if (!xdr?.trim()) return null;
  try {
    const tx = TransactionBuilder.fromXDR(xdr.trim(), passphraseFor(network));
    return { tx, isFeeBump: tx instanceof FeeBumpTransaction };
  } catch {
    return null;
  }
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
 * Hex-encoded transaction hash, the ID used by Horizon, Refractor and explorers
 */
export const getTransactionHash = (tx: Transaction | FeeBumpTransaction): string =>
  StellarXdr.encodeBytes(tx.hash(), 'hex');

/** Hash of an envelope on the given network, or '' when the XDR does not parse. */
export const getTransactionHashFromXdr = (xdr: string, network: NetworkId): string => {
  const parsed = tryParseTransaction(xdr, network);
  return parsed ? getTransactionHash(parsed.tx) : '';
};
