// Centralized configuration constants
export const appConfig = {
  // Network configurations
  MAINNET_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
  TESTNET_PASSPHRASE: 'Test SDF Network ; September 2015',
  
  // Horizon URLs
  MAINNET_HORIZON: 'https://horizon.stellar.org',
  TESTNET_HORIZON: 'https://horizon-testnet.stellar.org',
  
  // Soroban RPC URLs
  MAINNET_SOROBAN_RPC: 'https://soroban-rpc.mainnet.stellar.gateway.fm',
  TESTNET_SOROBAN_RPC: 'https://soroban-rpc.testnet.stellar.gateway.fm',
  
  // API endpoints
  REFRACTOR_API_BASE: 'https://api.reflector.network/v1/txs',
  LAB_BASE: 'https://laboratory.stellar.org/#xdr-viewer?input=',
  
  // Soroban Domains
  SOROBAN_DOMAINS: {
    mainnet: 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU',
    testnet: 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU'
  },
  
  // Oracle contract
  ORACLE_CONTRACT: 'CBXEUUO3FWPQJE2ZRRF6J5DHHRUDFO3SOWSB7BAFF3TKA3AVCVMEDOEN',
  
  // Timing constants
  DEFAULT_TX_TIMEOUT_SECONDS: 300,
  WALLET_CHECK_INTERVAL: 1000,
  WALLET_TIMEOUT: 30000,
  PRICE_REFETCH_INTERVAL: 5 * 60 * 1000, // 5 minutes
  
  // Limits
  MAX_OPERATIONS_PER_TX: 100,
  DEFAULT_BASE_FEE: 100,
} as const;