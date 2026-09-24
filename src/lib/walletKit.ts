import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
import { AlbedoModule } from '@creit-tech/stellar-wallets-kit/modules/albedo';
import { BitgetModule } from '@creit-tech/stellar-wallets-kit/modules/bitget';
import { CactusLinkModule } from '@creit-tech/stellar-wallets-kit/modules/cactuslink';
import { FordefiModule } from '@creit-tech/stellar-wallets-kit/modules/fordefi';
import { FreighterModule } from '@creit-tech/stellar-wallets-kit/modules/freighter';
import { GhostsigModule } from '@creit-tech/stellar-wallets-kit/modules/ghostsig';
import { HanaModule } from '@creit-tech/stellar-wallets-kit/modules/hana';
import { KleverModule } from '@creit-tech/stellar-wallets-kit/modules/klever';
import { LedgerModule } from '@creit-tech/stellar-wallets-kit/modules/ledger';
import { LobstrModule } from '@creit-tech/stellar-wallets-kit/modules/lobstr';
import { OneKeyModule } from '@creit-tech/stellar-wallets-kit/modules/onekey';
import { RabetModule } from '@creit-tech/stellar-wallets-kit/modules/rabet';
import { TrezorModule } from '@creit-tech/stellar-wallets-kit/modules/trezor';
import { xBullModule } from '@creit-tech/stellar-wallets-kit/modules/xbull';

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

// Modules are listed explicitly instead of using defaultModules(): since 2.7.0 it
// also loads MetaMask, whose connector imports the kit by its npm name
// (@creit.tech/stellar-wallets-kit), which does not resolve with the JSR package.
StellarWalletsKit.init({
  modules: [
    new GhostsigModule(),
    new AlbedoModule(),
    new FreighterModule(),
    new FordefiModule(),
    new RabetModule(),
    new xBullModule(),
    new LobstrModule(),
    new HanaModule(),
    new KleverModule(),
    new OneKeyModule(),
    new BitgetModule(),
    new CactusLinkModule(),
    trezorModule,
    new LedgerModule(),
  ],
});

export { StellarWalletsKit };
