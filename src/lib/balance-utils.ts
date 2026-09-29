/**
 * Spendable balances, following the network's reserve rules.
 */

import { Decimal } from 'decimal.js';

export const BASE_RESERVE_XLM = new Decimal('0.5');
/** Kept aside for the transaction fee (0.01 XLM per operation) when offering "max". */
export const FEE_MARGIN_XLM = new Decimal('0.1');

interface ReserveInfo {
  subentry_count?: number;
  num_sponsoring?: number;
  num_sponsored?: number;
}

interface BalanceInfo {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  selling_liabilities?: string;
}

/** XLM the account must always hold: (2 + subentries + sponsoring − sponsored) × base reserve. */
export function minimumBalance(account: ReserveInfo): Decimal {
  const entries = 2 + (account.subentry_count ?? 0) + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0);
  return BASE_RESERVE_XLM.times(Math.max(entries, 0));
}

/**
 * What can be sent of one asset right now: the balance minus what open offers lock and, for
 * XLM, minus the minimum balance and a fee margin.
 */
export function spendableBalance(
  account: ReserveInfo & { balances: BalanceInfo[] },
  assetCode: string,
  assetIssuer?: string,
): Decimal {
  const native = assetCode === 'XLM' && !assetIssuer;
  const line = account.balances.find((b) =>
    native ? b.asset_type === 'native' : b.asset_code === assetCode && b.asset_issuer === assetIssuer,
  );
  if (!line) return new Decimal(0);
  let spendable = new Decimal(line.balance || '0').minus(line.selling_liabilities || '0');
  if (native) spendable = spendable.minus(minimumBalance(account)).minus(FEE_MARGIN_XLM);
  return Decimal.max(0, spendable);
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

/**
 * Key for an asset's price: its code alone is not enough, since anyone can issue a token
 * called "USDC" (or "XLM"), and it must never inherit the real asset's price.
 */
export const priceKey = (code: string | undefined, issuer?: string): string =>
  !issuer && (!code || code === 'XLM') ? 'XLM' : `${code}:${issuer ?? ''}`;
