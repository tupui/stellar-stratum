/**
 * SEP-7 transaction URIs and the other ways a transaction reaches the app as text.
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */
import { Networks } from '@stellar/stellar-sdk';
import type { NetworkId } from '@/lib/xdr/parse';
import { isValidPaymentDestination } from '@/lib/validation';
import { readUR } from '@/lib/airgap/read';

export interface TransactionPayload {
  xdr: string;
  /**
   * Network the payload names. A SEP-7 URI always names one (no network_passphrase means the
   * public network); raw XDR carries none, so the caller has to decide.
   */
  network?: NetworkId;
}

/** A SEP-7 URI the app recognizes but will not act on, with the reason to show. */
export interface Refusal {
  refused: string;
}

export const isRefusal = (value: unknown): value is Refusal =>
  typeof value === 'object' && value !== null && 'refused' in value;

const UNKNOWN_NETWORK = 'This request is for a network Stratum does not support.';

const networkFromPassphrase = (passphrase: string): NetworkId | undefined => {
  if (passphrase === Networks.PUBLIC) return 'mainnet';
  if (passphrase === Networks.TESTNET) return 'testnet';
  return undefined;
};

/** The URL of a SEP-7 URI (`web+stellar:` or bare `stellar:`), or null for anything else. */
const sep7Url = (uri: string): URL | null => {
  try {
    const url = new URL(uri.trim());
    return url.protocol === 'web+stellar:' || url.protocol === 'stellar:' ? url : null;
  } catch {
    return null;
  }
};

/**
 * Parse a SEP-7 `tx` URI (`web+stellar:tx?xdr=…`, also accepting the bare `stellar:` scheme).
 * Returns null for anything else, including other operations such as `pay`, and a refusal for a
 * network the app cannot sign for or a transaction with fields left to fill in (`replace`).
 */
export function parseSEP7TxUri(uri: string): TransactionPayload | Refusal | null {
  const url = sep7Url(uri);
  if (!url || url.pathname !== 'tx') return null;

  // A '+' in unencoded base64 is read back as a space by URLSearchParams; restore it.
  const xdr = url.searchParams.get('xdr')?.replace(/ /g, '+');
  if (!xdr) return null;

  // `replace` marks fields of the transaction as placeholders for the signer to fill in. Signed as
  // is, the placeholders would be what the network executes.
  if (url.searchParams.has('replace')) {
    return { refused: 'This request leaves parts of the transaction for the signer to fill in. Ask for the complete transaction.' };
  }

  const passphrase = url.searchParams.get('network_passphrase');
  // `network=public|testnet` is what earlier versions of this app wrote.
  const legacy = url.searchParams.get('network');
  let network: NetworkId | undefined;
  if (passphrase) {
    network = networkFromPassphrase(passphrase);
    if (!network) return { refused: UNKNOWN_NETWORK };
  } else if (legacy === 'testnet') {
    network = 'testnet';
  } else {
    network = 'mainnet';
  }
  return { xdr, network };
}

/** A SEP-7 payment request. Amount and memo are as written in the URI, for the form to check. */
export interface PayRequest {
  destination: string;
  network: NetworkId;
  amount?: string;
  /** Absent for XLM. */
  asset?: { code: string; issuer: string };
  memo?: { type: 'text' | 'id'; value: string };
}

/**
 * Parse a SEP-7 `pay` URI. No network_passphrase means the public network, as for `tx`.
 * Returns null for anything else, and a refusal for an unknown network, an invalid destination
 * or a memo the app cannot send (hash and return memos).
 */
export function parseSEP7PayUri(uri: string): PayRequest | Refusal | null {
  const url = sep7Url(uri);
  if (!url || url.pathname !== 'pay') return null;
  const params = url.searchParams;

  const passphrase = params.get('network_passphrase');
  const network = passphrase ? networkFromPassphrase(passphrase) : 'mainnet';
  if (!network) return { refused: UNKNOWN_NETWORK };

  const destination = params.get('destination')?.trim() ?? '';
  if (!isValidPaymentDestination(destination)) return { refused: 'This payment request has no valid destination.' };

  const request: PayRequest = { destination, network };
  const amount = params.get('amount');
  if (amount !== null) request.amount = amount.trim();
  const code = params.get('asset_code');
  const issuer = params.get('asset_issuer') ?? '';
  if (code && !(code === 'XLM' && !issuer)) request.asset = { code, issuer };

  const memo = params.get('memo');
  if (memo) {
    // SEP-7 names MEMO_TEXT and MEMO_ID; Albedo, Sunce and the stellar-uri library write text and id.
    const memoType = (params.get('memo_type') ?? 'MEMO_TEXT').toUpperCase().replace(/^MEMO_/, '');
    if (memoType !== 'TEXT' && memoType !== 'ID') {
      return { refused: `This request needs a ${memoType.toLowerCase()} memo, which Stratum cannot send.` };
    }
    request.memo = { type: memoType === 'ID' ? 'id' : 'text', value: memo };
  }
  return request;
}

/** Build a SEP-7 `tx` URI for the given network. */
export function buildSEP7TxUri(xdr: string, network: NetworkId): string {
  const params = new URLSearchParams({ xdr });
  // SEP-7: network_passphrase is only set for networks other than the public one.
  if (network === 'testnet') params.set('network_passphrase', Networks.TESTNET);
  return `web+stellar:tx?${params.toString()}`;
}

/**
 * Read a transaction from pasted or scanned text: a SEP-7 URI, a `stellar-envelope` UR (what the
 * scanner makes of an animated QR), or base64 XDR that may be wrapped over several lines or
 * URL-encoded.
 */
export function parseTransactionPayload(data: string): TransactionPayload | Refusal | null {
  if (!data || typeof data !== 'string') return null;
  const sep7 = parseSEP7TxUri(data);
  if (sep7) return sep7;

  const ur = readUR(data);
  if (ur) {
    if (isRefusal(ur)) return ur;
    if (ur.kind === 'signatures') {
      return { refused: 'This QR code holds signatures, not a transaction. Scan it with Scan Signature in Air-gap Sync.' };
    }
    return { xdr: ur.xdr, network: ur.network };
  }

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
