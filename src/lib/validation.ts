/**
 * CRITICAL: Centralized input validation utilities for security and consistency
 * This is FUNDAMENTAL to preventing fund loss in self-custody applications
 */

import { StrKey } from '@stellar/stellar-sdk';

/**
 * CRITICAL: Validates a Stellar Ed25519 public key.
 * Uses StrKey to verify the checksum — a regex alone would accept typo'd
 * addresses with a valid alphabet but invalid checksum, risking fund loss.
 */
export const isValidPublicKey = (key: string): boolean => {
  if (typeof key !== 'string') return false;
  if (key.length !== 56 || key[0] !== 'G') return false;
  try {
    return StrKey.isValidEd25519PublicKey(key);
  } catch {
    return false;
  }
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