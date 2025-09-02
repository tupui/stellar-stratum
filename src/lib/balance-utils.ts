/**
 * Centralized utility functions for calculating available balances
 * considering reserve requirements and previous operations
 */

import { Decimal } from 'decimal.js';

interface Asset {
  code: string;
  issuer?: string;
  balance: string;
}

interface Operation {
  asset: string;
  amount: string;
  type?: 'payment' | 'swap' | 'merge' | string;
}

/**
 * Calculate the available balance for an asset, considering:
 * - Reserve requirements (minimum balance for XLM)
 * - Network fee margin (additional 1 XLM for transaction fees)
 * - Previous operations in the same transaction
 * - Asset-specific constraints
 */
export function calculateAvailableBalance(
  asset: Asset,
  previousOperations: Operation[] = [],
  reserveAmount: number = 1 // Default reserve for XLM
): number {
  const rawBalance = new Decimal(asset.balance || '0');
  
  // Calculate total amount already allocated in previous operations for this asset
  const allocatedAmount = previousOperations
    .filter(op => op.asset === asset.code)
    .reduce((total, op) => total.plus(new Decimal(op.amount || '0')), new Decimal(0));
  
  // Apply reserve requirements based on asset type
  let availableAfterReserve: Decimal;
  
  if (asset.code === 'XLM') {
    // XLM requires minimum balance for account existence + network fee margin
    const totalReserve = new Decimal(reserveAmount).plus(1); // Add 1 XLM margin for network fees
    availableAfterReserve = Decimal.max(0, rawBalance.minus(totalReserve));
  } else {
    // Non-native assets don't have reserve requirements
    availableAfterReserve = rawBalance;
  }
  
  // Subtract already allocated amounts
  const finalAvailable = Decimal.max(0, availableAfterReserve.minus(allocatedAmount));
  
  return finalAvailable.toNumber();
}

/**
 * Format balance display with proper precision
 */
export function formatBalance(balance: string | number): string {
  const num = typeof balance === 'string' ? parseFloat(balance) : balance;
  if (num === 0) return '0';
  if (num < 0.001) return '<0.001';
  return num.toLocaleString('en-US', { 
    maximumFractionDigits: num >= 1 ? 2 : 7,
    minimumFractionDigits: 0
  });
}

/**
 * Format balance for decimal-aligned display with fixed total width
 */
export function formatBalanceAligned(balance: string | number): string {
  const num = typeof balance === 'string' ? parseFloat(balance) : balance;
  if (num === 0) return '0.0000000'.padStart(20);
  if (num < 0.0000001) return '<0.0000001'.padStart(20);
  
  // Format with 7 decimal places and pad to consistent width
  const formatted = num.toFixed(7);
  return formatted.padStart(20); // Pad to 20 characters for alignment
}

/**
 * Format amount display with proper precision
 */
export function formatAmount(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num === 0) return '0';
  if (num < 0.0001) return num.toFixed(7);
  return num.toLocaleString('en-US', { 
    maximumFractionDigits: 7,
    minimumFractionDigits: 0
  });
}

/**
 * Validate and cap amount by available balance
 */
export function validateAndCapAmount(
  amount: string | number,
  availableBalance: number,
  precision: number = 7
): string {
  const decimalAmount = new Decimal(amount || '0');
  const decimalAvailableBalance = new Decimal(availableBalance || '0');
  
  if (decimalAmount.isNaN() || decimalAmount.lte(0)) {
    return '0';
  }
  
  // Cap by available balance using precise decimal arithmetic
  const cappedAmount = Decimal.min(decimalAmount, decimalAvailableBalance);
  
  // Round to specified precision to avoid floating point issues
  return cappedAmount.toDecimalPlaces(precision).toString();
}

/**
 * Calculate percentage of available balance being used
 */
export function calculateBalancePercentage(
  amount: string | number,
  availableBalance: number
): number {
  const decimalAmount = new Decimal(amount || '0');
  const decimalAvailableBalance = new Decimal(availableBalance || '0');
  
  if (decimalAvailableBalance.eq(0) || decimalAmount.isNaN() || decimalAmount.lte(0)) return 0;
  
  const percentage = decimalAmount.dividedBy(decimalAvailableBalance).mul(100);
  return Math.min(100, Math.max(0, percentage.toNumber()));
}