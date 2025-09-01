// Centralized optional wallet module configuration
// NOTE: WalletConnect requires a valid projectId from WalletConnect Cloud
// Fill these values to enable the modules. If left empty, modules will be skipped

export const walletConnectConfig = {
  // Get a project ID at https://cloud.walletconnect.com
  projectId: '',
  // Optional UI details
  name: 'Stellar Multisig',
  description: 'Connect using WalletConnect',
  iconUrl: '/assets/refractor-logo.png',
  // If you need to override, otherwise window.location.origin will be used
  url: undefined as string | undefined,
};

export const trezorConfig = {
  // Where to load Trezor dependencies from (example below)
  // See https://stellarwalletskit.dev/trezor-wallets
  url: '', // e.g., 'https://connect.trezor.io/9/'
  email: '', // e.g., 'you@example.com'
};
