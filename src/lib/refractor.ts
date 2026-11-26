import { TransactionBuilder } from '@stellar/stellar-sdk';
import { appConfig } from './appConfig';
import { getTransactionHash, passphraseFor } from './xdr/parse';

// Refractor (refractor.space) stores a transaction so co-signers can add signatures, for both
// networks. Its ID is the transaction hash on the network it was posted for.
const refractorNetwork = (network: 'mainnet' | 'testnet') => (network === 'testnet' ? 'testnet' : 'public');

export const submitToRefractor = async (xdr: string, network: 'mainnet' | 'testnet'): Promise<string> => {
  try {
    const response = await fetch(`${appConfig.REFRACTOR_API_BASE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ network: refractorNetwork(network), xdr }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Refractor API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const expected = getTransactionHash(TransactionBuilder.fromXdr(xdr, passphraseFor(network)));
    if (result?.hash !== expected) {
      throw new Error('Refractor stored the transaction under an unexpected ID');
    }
    return expected;
  } catch (error) {
    throw new Error(`Failed to submit to Refractor: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
  }
};

export const pullFromRefractor = async (
  refractorId: string,
): Promise<{ xdr: string; network: 'mainnet' | 'testnet' }> => {
  const response = await fetch(`${appConfig.REFRACTOR_API_BASE}/${encodeURIComponent(refractorId)}`);
  if (response.status === 404) throw new Error('No transaction with this ID on Refractor');
  if (!response.ok) throw new Error(`Refractor API error: ${response.status}`);

  const result = await response.json();
  const xdr = result?.xdr;
  if (typeof xdr !== 'string' || !xdr) throw new Error('Refractor returned an invalid XDR payload');
  if (result.network !== 'public' && result.network !== 'testnet') {
    throw new Error(`Refractor returned an unknown network: ${String(result.network)}`);
  }
  const network = result.network === 'testnet' ? 'testnet' : 'mainnet';
  let hash: string;
  try {
    hash = getTransactionHash(TransactionBuilder.fromXdr(xdr, passphraseFor(network)));
  } catch {
    throw new Error('Refractor returned a payload that is not a valid Stellar transaction');
  }
  // The ID is the transaction hash, which commits to the network: a different transaction, or
  // the same one claimed for the other network, cannot match it.
  if (hash !== refractorId.trim().toLowerCase()) {
    throw new Error('Refractor returned a different transaction than the one requested');
  }
  return { xdr, network };
};
