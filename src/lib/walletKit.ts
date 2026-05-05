import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils';
import { LedgerModule } from '@creit-tech/stellar-wallets-kit/modules/ledger';
import { walletConnectConfig, trezorConfig } from '@/lib/walletConfig';

const modules: any[] = [...defaultModules(), new LedgerModule()];

// Optional WalletConnect (only when projectId configured)
// Use variable-based dynamic import paths so the bundler does not statically
// analyze and try to bundle these optional/native-dependent modules.
if (walletConnectConfig.projectId) {
  try {
    const wcPath = /* @vite-ignore */ '@creit-tech/stellar-wallets-kit/modules/wallet-connect';
    const wc: any = await import(/* @vite-ignore */ wcPath);
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
  } catch {
    // WalletConnect not available
  }
}

if (trezorConfig.url && trezorConfig.email) {
  try {
    const tzPath = /* @vite-ignore */ '@creit-tech/stellar-wallets-kit/modules/trezor';
    const tz: any = await import(/* @vite-ignore */ tzPath);
    modules.push(
      new tz.TrezorModule({
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
