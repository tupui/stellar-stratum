import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils';
import { LedgerModule } from '@creit-tech/stellar-wallets-kit/modules/ledger';
import { walletConnectConfig, trezorConfig } from '@/lib/walletConfig';

const modules: any[] = [...defaultModules(), new LedgerModule()];

// Optional WalletConnect (only when projectId configured)
if (walletConnectConfig.projectId) {
  try {
    // Dynamic so the module is only loaded when configured
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wc = await import('@creit-tech/stellar-wallets-kit/modules/wallet-connect');
    modules.push(
      new (wc as any).WalletConnectModule({
        url: walletConnectConfig.url ?? (typeof window !== 'undefined' ? window.location.origin : ''),
        projectId: walletConnectConfig.projectId,
        method: (wc as any).WalletConnectAllowedMethods.SIGN,
        description: walletConnectConfig.description ?? 'Connect with WalletConnect',
        name: walletConnectConfig.name ?? 'Stellar DApp',
        icons: walletConnectConfig.iconUrl ? [walletConnectConfig.iconUrl] : [],
      })
    );
  } catch {
    // WalletConnect not available
  }
}

if (trezorConfig.url && trezorConfig.email) {
  try {
    const tz = await import('@creit-tech/stellar-wallets-kit/modules/trezor');
    modules.push(
      new (tz as any).TrezorModule({
        appUrl: trezorConfig.url,
        email: trezorConfig.email,
        appName: 'Stellar Multisig',
      })
    );
  } catch {
    // Trezor not available
  }
}

StellarWalletsKit.init({ modules });

export { StellarWalletsKit };
