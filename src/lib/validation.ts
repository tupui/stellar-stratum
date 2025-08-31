/**
 * Centralized input validation utilities for security and consistency
 */

/**
 * Validates a Stellar public key format
 */
export const isValidPublicKey = (key: string): boolean => {
  return typeof key === 'string' && key.match(/^G[A-Z2-7]{55}$/) !== null;
};

/**
 * Validates a Stellar amount (numeric string with max 7 decimal places)
 */
export const isValidAmount = (amount: string): boolean => {
  const numericRegex = /^\d+(\.\d{1,7})?$/;
  const num = parseFloat(amount);
  return numericRegex.test(amount) && num > 0 && num <= 922337203685.4775807;
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