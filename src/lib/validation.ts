/**
 * CRITICAL: Centralized input validation utilities for security and consistency
 * This is FUNDAMENTAL to preventing fund loss in self-custody applications
 */

/**
 * CRITICAL: Validates a Stellar public key format
 * Invalid keys could lead to fund loss
 */
export const isValidPublicKey = (key: string): boolean => {
  if (typeof key !== 'string') return false;
  if (key.length !== 56) return false;
  return key.match(/^G[A-Z2-7]{55}$/) !== null;
};

/**
 * CRITICAL: Validates a Stellar amount (numeric string with max 7 decimal places)
 * Invalid amounts could lead to transaction failures or fund loss
 */
export const isValidAmount = (amount: string): boolean => {
  if (typeof amount !== 'string') return false;
  if (amount.length === 0) return false;
  
  const numericRegex = /^\d+(\.\d{1,7})?$/;
  if (!numericRegex.test(amount)) return false;
  
  const num = parseFloat(amount);
  if (isNaN(num)) return false;
  if (num <= 0) return false;
  if (num > Number.MAX_SAFE_INTEGER) return false;
  
  return true;
};

/**
 * Validates a Soroban domain name format
 */
export const isValidDomain = (domain: string): boolean => {
  // Basic domain validation - alphanumeric, hyphens, dots allowed
  // No spaces, no special chars except hyphens and dots
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
  return typeof domain === 'string' && 
         domain.length > 0 && 
         domain.length <= 253 && 
         domainRegex.test(domain) &&
         !domain.startsWith('-') &&
         !domain.endsWith('-');
};

/**
 * CRITICAL: Validates XDR format for Stellar transactions
 * Invalid XDR could lead to transaction failures or fund loss
 */
export const isValidXdr = (xdr: string): boolean => {
  if (typeof xdr !== 'string') return false;
  if (xdr.length === 0) return false;
  
  try {
    // Basic XDR format validation - should be base64
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(xdr)) return false;
    
    // Try to decode as base64
    const decoded = atob(xdr);
    if (decoded.length === 0) return false;
    
    return true;
  } catch {
    return false;
  }
};

/**
 * CRITICAL: Validates asset code format
 * Invalid asset codes could lead to transaction failures
 */
export const isValidAssetCode = (code: string): boolean => {
  if (typeof code !== 'string') return false;
  if (code.length === 0) return false;
  if (code.length > 12) return false; // Stellar asset code limit
  
  // Asset codes can be alphanumeric
  const assetCodeRegex = /^[A-Z0-9]+$/;
  return assetCodeRegex.test(code);
};

/**
 * Sanitizes error messages for user display while preserving full error for logging
 */
export const sanitizeError = (error: unknown): { userMessage: string; fullError: string } => {
  const fullError = error instanceof Error ? error.message : String(error);
  
  // Common error patterns and their user-friendly versions
  const errorMappings: Record<string, string> = {
    'Network Error': 'Connection failed. Please check your internet connection.',
    'timeout': 'The request timed out. Please try again.',
    'ECONNREFUSED': 'Unable to connect to the server. Please try again later.',
    'Domain404Error': 'Domain not found',
    'Failed to fetch': 'Network connection failed. Please try again.',
  };

  // Check for known error patterns
  for (const [pattern, userMessage] of Object.entries(errorMappings)) {
    if (fullError.toLowerCase().includes(pattern.toLowerCase())) {
      return { userMessage, fullError };
    }
  }

  // Default sanitized message
  const userMessage = 'An unexpected error occurred. Please try again.';
  
  return { userMessage, fullError };
};