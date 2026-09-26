/**
 * SEP-7 transaction URIs and the other ways a transaction reaches the app as text.
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */
import { Networks } from '@stellar/stellar-sdk';
import type { NetworkId } from '@/lib/xdr/parse';

export interface TransactionPayload {
  xdr: string;
  /**
   * Network the payload names. A SEP-7 URI always names one (no network_passphrase means the
   * public network); raw XDR carries none, so the caller has to decide.
   */
  network?: NetworkId;
}

const networkFromPassphrase = (passphrase: string): NetworkId | undefined => {
  if (passphrase === Networks.PUBLIC) return 'mainnet';
  if (passphrase === Networks.TESTNET) return 'testnet';
  return undefined;
};

/**
 * Parse a SEP-7 `tx` URI (`web+stellar:tx?xdr=…`, also accepting the bare `stellar:` scheme).
 * Returns null for anything else, including other operations such as `pay`.
 */
export function parseSEP7TxUri(uri: string): TransactionPayload | null {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== 'web+stellar:' && url.protocol !== 'stellar:') || url.pathname !== 'tx') return null;

  // A '+' in unencoded base64 is read back as a space by URLSearchParams; restore it.
  const xdr = url.searchParams.get('xdr')?.replace(/ /g, '+');
  if (!xdr) return null;

  const passphrase = url.searchParams.get('network_passphrase');
  // `network=public|testnet` is what earlier versions of this app wrote.
  const legacy = url.searchParams.get('network');
  let network: NetworkId | undefined;
  if (passphrase) {
    network = networkFromPassphrase(passphrase);
    if (!network) return null; // A network this app cannot sign for.
  } else if (legacy === 'testnet') {
    network = 'testnet';
  } else {
    network = 'mainnet';
  }
  return { xdr, network };
}

/** Build a SEP-7 `tx` URI for the given network. */
export function buildSEP7TxUri(xdr: string, network: NetworkId): string {
  const params = new URLSearchParams({ xdr });
  // SEP-7: network_passphrase is only set for networks other than the public one.
  if (network === 'testnet') params.set('network_passphrase', Networks.TESTNET);
  return `web+stellar:tx?${params.toString()}`;
}

/**
 * Read a transaction from pasted or scanned text: a SEP-7 URI, or base64 XDR that may be
 * wrapped over several lines or URL-encoded.
 */
export function parseTransactionPayload(data: string): TransactionPayload | null {
  if (!data || typeof data !== 'string') return null;
  const sep7 = parseSEP7TxUri(data);
  if (sep7) return sep7;

  let text = data.replace(/\s+/g, '');
  if (/%[0-9A-Fa-f]{2}/.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      return null;
    }
  }
  if (text.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  return { xdr: text };
}
