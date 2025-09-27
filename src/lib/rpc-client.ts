import { rpc } from '@stellar/stellar-sdk';
import { appConfig } from './appConfig';

// Centralized RPC client management for all Stellar RPC operations
// Eliminates duplication and ensures consistent configuration across the app

export type RpcEndpointType = 'standard' | 'archive';
export type NetworkType = 'mainnet' | 'testnet';

// RPC server instances cache to avoid recreating servers
const rpcServerCache = new Map<string, rpc.Server>();

/**
 * Get the appropriate RPC URL for a network and endpoint type
 */
export const getRpcUrl = (network: NetworkType, endpointType: RpcEndpointType = 'standard'): string => {
  if (endpointType === 'archive') {
    return network === 'testnet' ? appConfig.TESTNET_ARCHIVE_RPC : appConfig.MAINNET_ARCHIVE_RPC;
  }
  return network === 'testnet' ? appConfig.TESTNET_SOROBAN_RPC : appConfig.MAINNET_SOROBAN_RPC;
};

/**
 * Create or get cached RPC server instance
 * @param network - 'mainnet' or 'testnet'
 * @param endpointType - 'standard' for regular operations, 'archive' for historical data
 */
export const createRpcServer = (network: NetworkType, endpointType: RpcEndpointType = 'standard'): rpc.Server => {
  const cacheKey = `${network}-${endpointType}`;
  
  if (rpcServerCache.has(cacheKey)) {
    return rpcServerCache.get(cacheKey)!;
  }
  
  const rpcUrl = getRpcUrl(network, endpointType);
  const server = new rpc.Server(rpcUrl);
  
  rpcServerCache.set(cacheKey, server);
  return server;
};

/**
 * Create RPC server for transaction history (uses archive endpoints)
 */
export const createHistoryRpcServer = (network: NetworkType): rpc.Server => {
  return createRpcServer(network, 'archive');
};

/**
 * Create RPC server for oracle operations (uses standard endpoints)
 */
export const createOracleRpcServer = (network: NetworkType = 'mainnet'): rpc.Server => {
  return createRpcServer(network, 'standard');
};

/**
 * Create RPC server for Soroban domains (uses standard endpoints)
 */
export const createDomainsRpcServer = (network: NetworkType): rpc.Server => {
  return createRpcServer(network, 'standard');
};

/**
 * Clear RPC server cache (useful for testing or configuration changes)
 */
export const clearRpcCache = (): void => {
  rpcServerCache.clear();
};