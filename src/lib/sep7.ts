/**
 * SEP-7 URI Scheme parsing and building utilities
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

export interface SEP7TxPayload {
  xdr: string;
  network?: 'public' | 'testnet';
  callback?: string;
  pubkey?: string;
  msg?: string;
  origin_domain?: string;
  signature?: string;
}

/**
 * Parse a SEP-7 transaction URI
 * @param uri - The stellar: URI to parse
 * @returns Parsed payload or null if invalid
 */
export function parseSEP7TxUri(uri: string): SEP7TxPayload | null {
  try {
    const url = new URL(uri);
    
    if (url.protocol !== 'stellar:') {
      return null;
    }

    if (url.pathname !== 'tx') {
      return null;
    }

    const xdr = url.searchParams.get('xdr');
    if (!xdr) {
      return null;
    }

    return {
      xdr,
      network: url.searchParams.get('network') as 'public' | 'testnet' || undefined,
      callback: url.searchParams.get('callback') || undefined,
      pubkey: url.searchParams.get('pubkey') || undefined,
      msg: url.searchParams.get('msg') || undefined,
      origin_domain: url.searchParams.get('origin_domain') || undefined,
      signature: url.searchParams.get('signature') || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Build a SEP-7 transaction URI
 * @param payload - The SEP-7 payload
 * @returns The stellar: URI string
 */
export function buildSEP7TxUri(payload: SEP7TxPayload): string {
  const url = new URL('stellar:tx');
  
  url.searchParams.set('xdr', payload.xdr);
  
  if (payload.network) {
    url.searchParams.set('network', payload.network);
  }
  
  if (payload.callback) {
    url.searchParams.set('callback', payload.callback);
  }
  
  if (payload.pubkey) {
    url.searchParams.set('pubkey', payload.pubkey);
  }
  
  if (payload.msg) {
    url.searchParams.set('msg', payload.msg);
  }
  
  if (payload.origin_domain) {
    url.searchParams.set('origin_domain', payload.origin_domain);
  }
  
  if (payload.signature) {
    url.searchParams.set('signature', payload.signature);
  }
  
  return url.toString();
}

/**
 * Extract XDR from either a raw XDR string or SEP-7 URI
 * @param data - Raw XDR or SEP-7 URI
 * @returns Extracted XDR string or null if invalid
 */
export function extractXdrFromData(data: string): string | null {
  // Try parsing as SEP-7 URI first
  const sep7Data = parseSEP7TxUri(data);
  if (sep7Data) {
    return sep7Data.xdr;
  }
  
  // If not SEP-7, assume it's raw XDR
  // Basic validation: XDR should be base64-like
  if (data && typeof data === 'string' && data.length > 0) {
    return data;
  }
  
  return null;
}