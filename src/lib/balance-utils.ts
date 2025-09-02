/**
 * Centralized utility functions for calculating available balances
 * considering reserve requirements and previous operations
 */

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
 * - Previous operations in the same transaction
 * - Asset-specific constraints
 */
export function calculateAvailableBalance(
  asset: Asset,
  previousOperations: Operation[] = [],
  reserveAmount: number = 1 // Default reserve for XLM
): number {
  const rawBalance = parseFloat(asset.balance) || 0;
  
  // Calculate total amount already allocated in previous operations for this asset
  const allocatedAmount = previousOperations
    .filter(op => op.asset === asset.code)
    .reduce((total, op) => total + (parseFloat(op.amount) || 0), 0);
  
  // Apply reserve requirements based on asset type
  let availableAfterReserve: number;
  
  if (asset.code === 'XLM') {
    // XLM requires minimum balance for account existence
    availableAfterReserve = Math.max(0, rawBalance - reserveAmount);
  } else {
    // Non-native assets don't have reserve requirements
    availableAfterReserve = rawBalance;
  }
  
  // Subtract already allocated amounts
  const finalAvailable = Math.max(0, availableAfterReserve - allocatedAmount);
  
  return finalAvailable;
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
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount) || numAmount <= 0) {
    return '0';
  }
  
  // Cap by available balance
  const cappedAmount = Math.min(numAmount, availableBalance);
  
  // Round to specified precision to avoid floating point issues
  return (Math.round(cappedAmount * Math.pow(10, precision)) / Math.pow(10, precision)).toString();
}

/**
 * Calculate percentage of available balance being used
 */
export function calculateBalancePercentage(
  amount: string | number,
  availableBalance: number
): number {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (availableBalance === 0 || isNaN(numAmount) || numAmount <= 0) return 0;
  return Math.min(100, Math.max(0, (numAmount / availableBalance) * 100));
}