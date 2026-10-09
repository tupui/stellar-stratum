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

/** A muxed account (M…): a G… account plus a 64-bit ID, used by exchanges instead of a memo. */
export const isMuxedAddress = (address: string): boolean => {
  if (typeof address !== 'string' || address.length !== 69 || address[0] !== 'M') return false;
  try {
    return StrKey.isValidMed25519PublicKey(address);
  } catch {
    return false;
  }
};

/**
 * The account an entered address opens: a G… address is that account, a muxed (M…) address is
 * the account behind it. Null for anything else.
 */
export const accountIdOf = (address: string): string | null => {
  if (isValidPublicKey(address)) return address;
  if (!isMuxedAddress(address)) return null;
  return StrKey.encodeEd25519PublicKey(StrKey.decodeMed25519PublicKey(address).subarray(0, 32));
};

/** A contract (C…). */
export const isContractAddress = (address: string): boolean => {
  if (typeof address !== 'string' || address.length !== 56 || address[0] !== 'C') return false;
  try {
    return StrKey.isValidContract(address);
  } catch {
    return false;
  }
};

/** An address a payment can be sent to: an account (G…), a muxed account (M…) or a contract (C…). */
export const isValidPaymentDestination = (address: string): boolean =>
  isValidPublicKey(address) || isMuxedAddress(address) || isContractAddress(address);

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