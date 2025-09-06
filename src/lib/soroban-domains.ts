/**
 * Shared utility functions for Soroban domain resolution
 */

import { isValidDomain } from './validation';
import { appConfig } from './appConfig';

interface SorobanDomainResult {
  address: string;
  success: true;
}

interface SorobanDomainError {
  error: string;
  success: false;
}

type SorobanDomainResponse = SorobanDomainResult | SorobanDomainError;

/**
 * Resolves a Soroban domain to its associated Stellar address
 */
export const resolveSorobanDomain = async (
  domain: string, 
  network: 'mainnet' | 'testnet'
): Promise<SorobanDomainResponse> => {
  if (!domain || !isValidDomain(domain)) {
    return { error: 'Invalid domain format', success: false };
  }

  try {
    // Import required modules  
    const StellarSDK = await import('@stellar/stellar-sdk');
    const { SorobanDomainsSDK } = await import('@creit.tech/sorobandomains-sdk');

    // Use proper SDK structure with consistent config
    const networkPassphrase = network === 'testnet' ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC;
    const rpcUrl = network === 'testnet' ? appConfig.TESTNET_SOROBAN_RPC : appConfig.MAINNET_SOROBAN_RPC;
    const rpcServer = new StellarSDK.rpc.Server(rpcUrl);
    
    const sdk = new SorobanDomainsSDK({
      stellarSDK: StellarSDK,
      rpc: rpcServer,
      network: networkPassphrase,
      vaultsContractId: appConfig.SOROBAN_DOMAINS[network],
      defaultFee: appConfig.DEFAULT_BASE_FEE.toString(),
      defaultTimeout: appConfig.DEFAULT_TX_TIMEOUT_SECONDS,
      simulationAccount: 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV'
    });

    // Search for the domain
    const res = await sdk.searchDomain({
      domain: domain.trim().toLowerCase()
    });

    // Extract values
    const v = (res && (res.value ?? res)) as any;
    if (v && typeof v.owner === 'string') {
      const resolvedAddress = v.address || v.owner;
      return { address: resolvedAddress, success: true };
    } else {
      return { error: 'Domain not found', success: false };
    }
  } catch (error: any) {
    console.error('Soroban domain resolution error:', error);
    let errorMessage = 'Failed to resolve domain';
    
    // Check for specific error types
    if (error.name === 'Domain404Error') {
      errorMessage = 'Domain not found';
    } else if (error.message?.includes('fetch')) {
      errorMessage = 'Network connection failed. Please check your internet connection.';
    } else if (error.message?.includes('timeout')) {
      errorMessage = 'Request timed out. Please try again.';
    } else if (error.message?.includes('ECONNREFUSED')) {
      errorMessage = 'Unable to connect to Soroban RPC. Please try again later.';
    }
    
    return { error: errorMessage, success: false };
  }
};

/**
 * Checks if a string looks like a Soroban domain (not a Stellar address)
 */
export const isLikelySorobanDomain = (input: string): boolean => {
  // If it starts with G or C and is 56 chars, it's likely a Stellar address
  if ((input.startsWith('G') || input.startsWith('C')) && input.length === 56) {
    return false;
  }
  
  // If it contains dots or is a valid domain format, it's likely a domain
  return isValidDomain(input);
};