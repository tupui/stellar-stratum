import { rpc } from '@stellar/stellar-sdk';
import { appConfig } from './appConfig';

// Centralized RPC client management for oracle and domain operations
// Eliminates duplication and ensures consistent configuration across the app

export type NetworkType = 'mainnet' | 'testnet';

// RPC server instances cache to avoid recreating servers
const rpcServerCache = new Map<string, rpc.Server>();

/**
 * Get the RPC URL for a network
 */
export const getRpcUrl = (network: NetworkType): string => {
  return network === 'testnet' ? appConfig.TESTNET_SOROBAN_RPC : appConfig.MAINNET_SOROBAN_RPC;
};

/**
 * Create or get cached RPC server instance
 * @param network - 'mainnet' or 'testnet'
 */
export const createRpcServer = (network: NetworkType): rpc.Server => {
  if (rpcServerCache.has(network)) {
    return rpcServerCache.get(network)!;
  }
  
  const rpcUrl = getRpcUrl(network);
  const server = new rpc.Server(rpcUrl);
  
  rpcServerCache.set(network, server);
  return server;
};

/**
 * Create RPC server for oracle operations
 */
export const createOracleRpcServer = (network: NetworkType = 'mainnet'): rpc.Server => {
  return createRpcServer(network);
};

/**
 * Create RPC server for Soroban domains
 */
export const createDomainsRpcServer = (network: NetworkType): rpc.Server => {
  return createRpcServer(network);
};

/**
 * Clear RPC server cache (useful for testing or configuration changes)
 */
export const clearRpcCache = (): void => {
  rpcServerCache.clear();
};