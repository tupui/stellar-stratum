/**
 * Centralized wallet module configuration
 * Fill these values to enable the optional wallet modules
 */

export const walletConnectConfig = {
  // Project ID from https://cloud.walletconnect.com (required for WalletConnect)
  projectId: '',
  // App metadata
  name: 'Stellar Multisig',
  description: 'Connect using WalletConnect',
  iconUrl: '/assets/refractor-logo.png',
  url: undefined as string | undefined,
};

export const trezorConfig = {
  // Trezor Connect configuration
  url: '',
  email: '',
};
