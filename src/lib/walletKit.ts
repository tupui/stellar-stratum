import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils';
import { LedgerModule } from '@creit-tech/stellar-wallets-kit/modules/ledger';
import { TrezorModule } from '@creit-tech/stellar-wallets-kit/modules/trezor';

// Trezor Connect requires a manifest (app identity) before it can be started.
// coreMode 'auto' routes through Trezor Suite desktop first, then the hosted
// iframe (WebUSB/Bridge transport). The core-in-popup fallback is deliberately
// avoided: Trezor blocks Safe 7 and newer devices in that mode.
const trezorModule = new TrezorModule({
  appUrl: 'https://stellar-stratum.xyz',
  appName: 'Stellar Stratum',
  email: 'contact@consulting-manao.com',
  lazyLoad: true,
  coreMode: 'auto',
});

StellarWalletsKit.init({
  modules: [...defaultModules(), trezorModule, new LedgerModule()],
});

export { StellarWalletsKit };
