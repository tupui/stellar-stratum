import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils';
import { LedgerModule } from '@creit-tech/stellar-wallets-kit/modules/ledger';
import { walletConnectConfig, trezorConfig } from '@/lib/walletConfig';

const modules: any[] = [...defaultModules(), new LedgerModule()];

// Optional WalletConnect module (only when projectId configured)
try {
  if (walletConnectConfig.projectId) {
    // Lazy require to avoid throwing in environments where it's not bundled
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wc = require('@creit-tech/stellar-wallets-kit/modules/walletconnect');
    modules.push(
      new wc.WalletConnectModule({
        url: walletConnectConfig.url ?? (typeof window !== 'undefined' ? window.location.origin : ''),
        projectId: walletConnectConfig.projectId,
        method: wc.WalletConnectAllowedMethods.SIGN,
        description: walletConnectConfig.description ?? 'Connect with WalletConnect',
        name: walletConnectConfig.name ?? 'Stellar DApp',
        icons: walletConnectConfig.iconUrl ? [walletConnectConfig.iconUrl] : [],
      })
    );
  }
} catch {
  // WalletConnect not available
}

// Optional Trezor module
try {
  if (trezorConfig.url && trezorConfig.email) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tz = require('@creit-tech/stellar-wallets-kit/modules/trezor');
    modules.push(
      new tz.TrezorModule({
        appUrl: trezorConfig.url,
        email: trezorConfig.email,
        appName: 'Stellar Multisig',
      })
    );
  }
} catch {
  // Trezor not available
}

StellarWalletsKit.init({ modules });

export { StellarWalletsKit };
