import { parseSEP7TxUri, extractXdrFromData } from './sep7';

export interface QRResult {
  type: 'sep7' | 'deeplink' | 'address' | 'xdr' | 'refractor-id' | 'unknown';
  data: string;
  metadata?: {
    refractorId?: string;
    xdr?: string;
    address?: string;
    origin?: string;
  };
}

/**
 * Centralized QR code data parser for all supported types
 */
export const parseQRData = (data: string): QRResult => {
  if (!data?.trim()) {
    return { type: 'unknown', data: '' };
  }

  const trimmedData = data.trim();

  // Try parsing as URL first
  try {
    const url = new URL(trimmedData);
    
    // SEP-7 transaction URI
    if ((url.protocol === 'stellar:' || url.protocol === 'web+stellar:') && url.pathname === 'tx') {
      const sep7Data = parseSEP7TxUri(trimmedData);
      if (sep7Data?.xdr) {
        return {
          type: 'sep7',
          data: trimmedData,
          metadata: {
            xdr: sep7Data.xdr,
            origin: sep7Data.origin_domain,
            refractorId: extractRefractorId(sep7Data.callback)
          }
        };
      }
    }

    // Deep link with refractor ID (e.g., https://domain.com?r=abc123)
    const refractorParam = url.searchParams.get('r');
    if (refractorParam) {
      return {
        type: 'deeplink',
        data: trimmedData,
        metadata: {
          refractorId: refractorParam
        }
      };
    }

    // Other URLs are unknown
    return { type: 'unknown', data: trimmedData };
  } catch {
    // Not a valid URL, continue with other checks
  }

  // Try extracting XDR (handles both raw XDR and SEP-7 embedded XDR)
  const xdr = extractXdrFromData(trimmedData);
  if (xdr) {
    return {
      type: 'xdr',
      data: trimmedData,
      metadata: { xdr }
    };
  }

  // Check if it looks like a Stellar address
  if (isValidStellarAddress(trimmedData)) {
    return {
      type: 'address',
      data: trimmedData,
      metadata: { address: trimmedData }
    };
  }

  // Check if it looks like a refractor ID (alphanumeric, reasonable length)
  if (isValidRefractorId(trimmedData)) {
    return {
      type: 'refractor-id',
      data: trimmedData,
      metadata: { refractorId: trimmedData }
    };
  }

  return { type: 'unknown', data: trimmedData };
};

/**
 * Extract refractor ID from callback URL
 */
const extractRefractorId = (callback?: string): string | undefined => {
  if (!callback) return undefined;
  
  try {
    const callbackUrl = new URL(callback);
    if (callbackUrl.hostname === 'refractor.space') {
      return callbackUrl.searchParams.get('r') || undefined;
    }
  } catch {
    // Invalid callback URL
  }
  
  return undefined;
};

/**
 * Basic Stellar address validation
 */
const isValidStellarAddress = (data: string): boolean => {
  // Stellar public keys start with 'G' and are 56 characters
  // Muxed accounts start with 'M' and are 69 characters
  return (
    (data.startsWith('G') && data.length === 56) ||
    (data.startsWith('M') && data.length === 69)
  ) && /^[A-Z2-7]+$/.test(data);
};

/**
 * Basic refractor ID validation
 */
const isValidRefractorId = (data: string): boolean => {
  // Alphanumeric, reasonable length (6-50 chars)
  return /^[a-zA-Z0-9]{6,50}$/.test(data);
};
