// Centralized configuration constants
export const appConfig = {
  // Network configurations
  MAINNET_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
  TESTNET_PASSPHRASE: 'Test SDF Network ; September 2015',
  
  // Horizon URLs
  MAINNET_HORIZON: 'https://horizon.stellar.org',
  TESTNET_HORIZON: 'https://horizon-testnet.stellar.org',
  
  // Soroban RPC URLs
  MAINNET_SOROBAN_RPC: 'https://mainnet.sorobanrpc.com',
  TESTNET_SOROBAN_RPC: 'https://testnet.sorobanrpc.com',
  
  // API endpoints
  REFRACTOR_API_BASE: 'https://api.refractor.space/tx',
  LAB_BASE: 'https://laboratory.stellar.org/#xdr-viewer?input=',
  
  // Soroban Domains
  SOROBAN_DOMAINS: {
    mainnet: 'CATRNPHYKNXAPNLHEYH55REB6YSAJLGCPA4YM6L3WUKSZOPI77M2UMKI',
    testnet: 'CDODLZIO3OY5ZBCNYQALDZWLW2NN533WIDZUDNW2NRWJGLTWSABGSMH7'
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