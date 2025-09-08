import { createHorizonServer } from './stellar';

// Shared constants for filtering transactions/payments
export const MIN_NATIVE_PAYMENT_XLM = 1; // Minimum XLM amount to avoid spam
export const ALLOWED_TYPES = ['payment', 'create_account'] as const;

// Cache durations
export const TRANSACTION_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Normalized transaction record type
export interface NormalizedTransaction {
  id: string;
  createdAt: Date;
  type: 'payment' | 'create_account';
  direction: 'in' | 'out';
  amount: number; // Always in XLM
  counterparty: string;
  transactionHash: string;
}

// Retry with exponential backoff for rate limit errors
export const retryWithBackoff = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRateLimit = error?.status === 429 || error?.status === 503;
      if (isRateLimit && i < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 10000); // Exponential backoff, max 10s
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
};

// Normalize payment record from Horizon API
export const normalizePaymentRecord = (
  record: any, 
  accountPublicKey: string
): NormalizedTransaction | null => {
  try {
    // Only process allowed transaction types
    if (!ALLOWED_TYPES.includes(record.type)) {
      return null;
    }

    // Only process native XLM transactions
    if (record.asset_type !== 'native') {
      return null;
    }

    const amount = parseFloat(record.amount);
    
    // Filter out small amounts to avoid spam
    if (amount < MIN_NATIVE_PAYMENT_XLM) {
      return null;
    }

    // Determine direction and counterparty
    let direction: 'in' | 'out';
    let counterparty: string;

    if (record.type === 'create_account') {
      // For create_account, we are either creating or being created
      if (record.funder === accountPublicKey) {
        direction = 'out';
        counterparty = record.account;
      } else {
        direction = 'in';
        counterparty = record.funder;
      }
    } else {
      // For payment operations
      if (record.from === accountPublicKey) {
        direction = 'out';
        counterparty = record.to;
      } else {
        direction = 'in';
        counterparty = record.from;
      }
    }

    // Skip self-transactions
    if (counterparty === accountPublicKey) {
      return null;
    }

    return {
      id: record.paging_token || `${record.transaction_hash}-${record.type}`,
      createdAt: new Date(record.created_at),
      type: record.type,
      direction,
      amount,
      counterparty,
      transactionHash: record.transaction_hash,
    };
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('Failed to normalize payment record:', error, record);
    }
    return null;
  }
};

// Fetch paginated payments for an account
export const fetchAccountPayments = async (
  publicKey: string,
  network: 'mainnet' | 'testnet',
  cursor?: string,
  limit: number = 200
) => {
  const server = createHorizonServer(network);
  
  let query = server
    .payments()
    .forAccount(publicKey)
    .order('desc')
    .limit(limit);
    
  if (cursor) {
    query = query.cursor(cursor);
  }
  
  return await retryWithBackoff(() => query.call());
};

// Get Horizon transaction URL for external viewing
export const getHorizonTransactionUrl = (
  network: 'mainnet' | 'testnet',
  transactionHash: string
): string => {
  const baseUrl = network === 'testnet' 
    ? 'https://horizon-testnet.stellar.org' 
    : 'https://horizon.stellar.org';
  return `${baseUrl}/transactions/${transactionHash}`;
};