import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils';
import { LedgerModule } from '@creit-tech/stellar-wallets-kit/modules/ledger';
import { TrezorModule } from '@creit-tech/stellar-wallets-kit/modules/trezor';

// Trezor Connect requires a manifest (app identity) before it can be started.
const trezorModule = new TrezorModule({
  appUrl: 'https://stellar-stratum.xyz',
  appName: 'Stellar Stratum',
  email: 'contact@consulting-manao.com',
  lazyLoad: true,
});

StellarWalletsKit.init({
  modules: [...defaultModules(), trezorModule, new LedgerModule()],
});

export { StellarWalletsKit };
