/**
 * Dynamic imports for Stellar SDK operations to improve bundle splitting
 * This module provides lazy-loaded functions for heavy Stellar operations
 */

// Dynamic imports for Stellar SDK - split heavy operations from main bundle
export const createStellarTransaction = async () => {
  const { TransactionBuilder } = await import('@stellar/stellar-sdk');
  return TransactionBuilder;
};

export const loadStellarOperations = async () => {
  const { Operation, Asset, Memo } = await import('@stellar/stellar-sdk');
  return { Operation, Asset, Memo };
};

export const loadStellarTransaction = async () => {
  const { Transaction } = await import('@stellar/stellar-sdk');
  return Transaction;
};

export const loadStellarKeypair = async () => {
  const { Keypair } = await import('@stellar/stellar-sdk');
  return Keypair;
};

export const loadStellarNetworks = async () => {
  const { Networks } = await import('@stellar/stellar-sdk');
  return Networks;
};

// Dynamic wallet module imports for better code splitting
export const loadLedgerModule = async () => {
  const { LedgerModule } = await import('@creit.tech/stellar-wallets-kit/modules/ledger.module');
  return LedgerModule;
};

export const loadWalletConnectModule = async () => {
  const { WalletConnectModule, WalletConnectAllowedMethods } = await import('@creit.tech/stellar-wallets-kit/modules/walletconnect.module');
  return { WalletConnectModule, WalletConnectAllowedMethods };
};

export const loadTrezorModule = async () => {
  const { TrezorModule } = await import('@creit.tech/stellar-wallets-kit/modules/trezor.module');
  return TrezorModule;
};

// Dynamic QR code library imports
export const loadQRLibraries = async () => {
  const [qrcode, jsqr, zxing] = await Promise.all([
    import('qrcode'),
    import('jsqr'),
    import('@zxing/library')
  ]);
  return { qrcode, jsqr, zxing };
};

// Cache for loaded modules to prevent re-imports
const moduleCache = new Map<string, any>();

export const getCachedModule = <T>(key: string, loader: () => Promise<T>): Promise<T> => {
  if (moduleCache.has(key)) {
    return Promise.resolve(moduleCache.get(key));
  }
  
  return loader().then(module => {
    moduleCache.set(key, module);
    return module;
  });
};