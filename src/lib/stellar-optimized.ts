/**
 * Optimized Stellar operations with enhanced caching and performance
 * This module provides cached and optimized versions of Stellar operations
 */

import { EnhancedCache, caches } from './enhanced-cache';
import { createHorizonServer, getNetworkPassphrase } from './stellar';
import { loadStellarTransaction, loadStellarKeypair, getCachedModule } from './stellar-dynamic';

const { networkRequests, accountData } = caches;

// Cache for expensive operations
const operationCache = new EnhancedCache({
  ttl: 30000, // 30 seconds for operation results
  maxSize: 100,
  storage: 'memory'
});

// Optimized account data fetching with caching
export const fetchAccountDataCached = async (publicKey: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<any> => {
  const cacheKey = `account-${publicKey}-${network}`;
  
  const cached = accountData.get(cacheKey);
  if (cached) return cached;
  
  const { fetchAccountData } = await import('./stellar');
  const data = await fetchAccountData(publicKey, network);
  
  accountData.set(cacheKey, data);
  return data;
};

// Optimized transaction validation with caching
export const validateTransactionCached = async (xdr: string, network: 'mainnet' | 'testnet') => {
  const cacheKey = `validate-${xdr.substring(0, 20)}-${network}`;
  
  return operationCache.get(cacheKey) || await operationCache.set(cacheKey, async () => {
    const Transaction = await loadStellarTransaction();
    const networkPassphrase = getNetworkPassphrase(network);
    
    try {
      const transaction = new Transaction(xdr, networkPassphrase);
      return { valid: true, transaction };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : 'Invalid XDR' };
    }
  });
};

// Cached signature verification
export const verifySignatureCached = async (transactionHash: Buffer, signature: Buffer, publicKey: string) => {
  const cacheKey = `verify-${transactionHash.toString('hex').substring(0, 16)}-${publicKey}`;
  
  return operationCache.get(cacheKey) || await operationCache.set(cacheKey, async () => {
    const Keypair = await loadStellarKeypair();
    
    try {
      const keypair = Keypair.fromPublicKey(publicKey);
      return keypair.verify(transactionHash, signature);
    } catch {
      return false;
    }
  });
};

// Optimized network requests with deduplication
export const submitTransactionOptimized = async (signedXdr: string, network: 'mainnet' | 'testnet' = 'mainnet') => {
  const cacheKey = `submit-${signedXdr.substring(0, 20)}-${network}`;
  
  // Use network requests cache to prevent duplicate submissions
  return networkRequests.get(cacheKey) || await networkRequests.set(cacheKey, async () => {
    const { submitTransaction } = await import('./stellar');
    return submitTransaction(signedXdr, network);
  });
};

// Batch account loading for multiple addresses
export const loadAccountsBatch = async (publicKeys: string[], network: 'mainnet' | 'testnet') => {
  const server = createHorizonServer(network);
  
  // Use Promise.allSettled to handle individual failures gracefully
  const results = await Promise.allSettled(
    publicKeys.map(async (publicKey) => {
      const cacheKey = `account-${publicKey}-${network}`;
      
      const cached = accountData.get(cacheKey);
      if (cached) return { publicKey, data: cached };
      
      try {
        const account = await server.loadAccount(publicKey);
        const data = {
          publicKey,
          balances: account.balances,
          thresholds: account.thresholds,
          signers: account.signers
        };
        
        accountData.set(cacheKey, data);
        return { publicKey, data };
      } catch (error) {
        return { publicKey, error: error instanceof Error ? error.message : 'Failed to load account' };
      }
    })
  );
  
  return results.map((result, index) => ({
    publicKey: publicKeys[index],
    ...(result.status === 'fulfilled' ? result.value : { error: result.reason })
  }));
};

// Clear caches when needed (e.g., network switch)
export const clearStellarCaches = () => {
  operationCache.clear();
  accountData.clear();
  networkRequests.clear();
};