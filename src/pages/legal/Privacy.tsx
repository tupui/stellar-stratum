import { EyeOff, Globe, KeyRound, Lock, Server } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Code, Entries, Entry, LegalHeader, Section, Summary } from '@/components/legal';
import { LEGAL_EMAIL, TEXT_LINK } from '@/lib/legal';

const CONTACT = (
  <a href={`mailto:${LEGAL_EMAIL}`} className={TEXT_LINK}>
    {LEGAL_EMAIL}
  </a>
);

const Privacy = () => (
  <>
    <LegalHeader icon={Lock} title="Privacy policy">
      What Stellar Stratum processes, why, and what you can do about it.
    </LegalHeader>
    <Summary
      points={[
        {
          icon: KeyRound,
          title: 'Your keys stay in your wallet',
          text: 'Stellar Stratum never sees a secret key. Your wallet signs and hands back the signed transaction.',
        },
        {
          icon: Server,
          title: 'No server of ours',
          text: 'The app runs in your browser and talks to the Stellar network and the services below directly.',
        },
        {
          icon: EyeOff,
          title: 'No tracking',
          text: 'No account, no cookies, no analytics, no advertising.',
        },
        {
          icon: Globe,
          title: 'Public and permanent',
          text: 'Accounts, transactions and signatures on the Stellar network are public, and nobody can erase them.',
        },
      ]}
    />

    <Section title="Who is responsible">
      <p>
        Consulting Manao GmbH, Köppling 35, 8565 Söding-Sankt Johann, Austria, is the controller. Write to {CONTACT}{' '}
        for anything about your data. Company details are in the{' '}
        <Link to="/legal/impressum" className={TEXT_LINK}>
          Impressum
        </Link>
        .
      </p>
    </Section>

    <Section title="What is processed">
      <Entries title="Data">
        <Entry name="Stellar addresses" where="Stellar network, public">
          The accounts you connect, enter or open from a link, and the addresses you pay. The app needs them to read
          balances, activity and signers, and to build transactions.
        </Entry>
        <Entry name="Transactions and signatures" where="Stellar network, public">
          The transactions you build, sign and submit, with their signatures.
        </Entry>
        <Entry name="Shared transactions" where="Refractor">
          A transaction you share with co-signers through Refractor, with the signatures collected so far.
        </Entry>
        <Entry name="IP address and browser" where="Each host contacted">
          Every server your browser contacts receives them with each request.
        </Entry>
        <Entry name="Settings and caches" where="Your browser">
          What the app keeps in your browser, listed under{' '}
          <a href="#storage" className={TEXT_LINK}>
            Browser storage
          </a>
          .
        </Entry>
      </Entries>
    </Section>

    <Section title="Why, and on what basis">
      <p>
        The app processes this data to do what you ask of it: show an account, build, share and submit transactions
        (Art. 6(1)(b) GDPR). The hosting provider processes your IP address to deliver the app and keep it secure, which
        rests on our legitimate interest in a working and secure service (Art. 6(1)(f) GDPR).
      </p>
    </Section>

    <Section title="What you must provide">
      <p>
        You need no account, and the app asks for no name or email. To show an account, it needs the account's address.
        To sign, you need a wallet that holds a signing key. No decision about you is automated.
      </p>
    </Section>

    <Section title="Who receives it">
      <p>
        Consulting Manao GmbH runs no server for the app. Your browser sends requests directly to the hosts below, each
        when you use the feature that needs it. Each of them sees your IP address and works under its own privacy policy.
      </p>
      <Entries title="Hosting">
        <Entry name="Radicle Garden" where="European Union">
          Hosts the app on Radicle Pages and serves its files. Radicle Garden is run by Monadic Works GmbH in Berlin on
          Scaleway servers in the European Union.
        </Entry>
      </Entries>
      <Entries title="Stellar network">
        <Entry name={<Code>horizon.stellar.org</Code>} where="SDF">
          Horizon on Mainnet, run by the Stellar Development Foundation: the accounts you open or pay, their activity,
          asset issuers, and the transactions you submit.
        </Entry>
        <Entry name={<Code>horizon-testnet.stellar.org</Code>} where="SDF">
          The same on Testnet.
        </Entry>
        <Entry name="Horizon mirrors" where="Mainnet">
          <Code>horizon.stellar.lobstr.co</Code>, <Code>horizon.stellarx.com</Code> and <Code>rpc.ankr.com</Code>: the
          same, when the Horizon before them in your list does not answer a submission or you turn it off.
        </Entry>
        <Entry name="Your Horizon servers" where="Your choice">
          The servers you add in the Horizon settings receive what the default ones would.
        </Entry>
        <Entry name={<Code>rpc.lightsail.network</Code>} where="Lightsail Network">
          Soroban RPC on Mainnet: contract calls simulated before you sign, network fees, and the Reflector prices and
          exchange rates the app shows on both networks.
        </Entry>
        <Entry name={<Code>soroban-testnet.stellar.org</Code>} where="SDF">
          Soroban RPC on Testnet: contract calls simulated before you sign, and network fees.
        </Entry>
        <Entry name="Asset issuers" where="Their websites">
          The <Code>stellar.toml</Code> file and logo of each asset the app shows, from its issuer's website or{' '}
          <Code>ipfs.io</Code>.
        </Entry>
      </Entries>
      <Entries title="Services">
        <Entry name={<Code>api.refractor.space</Code>} where="Refractor">
          The transactions you share for signing, and the ones you open from a Refractor link.
        </Entry>
        <Entry name={<Code>api.kraken.com</Code>} where="Kraken">
          Daily prices for the activity chart. The requests name currency pairs and no account.
        </Entry>
        <Entry name={<Code>api.soroswap.finance</Code>} where="Soroswap">
          Swap and liquidity quotes and transactions on Mainnet, with your address and amounts. Its token list on both
          networks, when you review a contract call that names tokens the app does not know. The token logos load from
          the sites that list names.
        </Entry>
        <Entry name={<Code>api.defindex.io</Code>} where="DeFindex">
          Vault details, deposits and withdrawals on Mainnet, with your address and amounts.
        </Entry>
      </Entries>
      <Entries title="Wallets">
        <Entry name="Browser extensions" where="Your browser">
          Freighter, LOBSTR, Rabet, Hana, Klever, OneKey, Bitget, Fordefi and Cactus Link receive your address and each
          transaction you ask them to sign.
        </Entry>
        <Entry name="Web wallets" where="Their websites">
          Albedo (<Code>albedo.link</Code>), xBull (<Code>wallet.xbull.app</Code>) and GHOSTSIG (
          <Code>ghostsig.dev</Code>) open in a window of their own and receive the same.
        </Entry>
        <Entry name="Hardware wallets" where="Your device">
          Ledger connects over USB. Trezor connects through Trezor Connect from <Code>connect.trezor.io</Code> and
          Trezor Suite or Trezor Bridge on your computer.
        </Entry>
        <Entry name="Wallet logos" where="Their websites">
          When the wallet list opens, logos load from <Code>stellar.creit.tech</Code> and{' '}
          <Code>uni.onekey-asset.com</Code>.
        </Entry>
      </Entries>
      <Entries title="Only when you follow a link">
        <Entry name="Explorers and tools" where="Their websites">
          <Code>stellar.expert</Code>, <Code>lab.stellar.org</Code>, <Code>refractor.space</Code> and the other sites
          the app links to.
        </Entry>
        <Entry name="Share buttons" where="Your choice">
          Email, WhatsApp and Telegram receive the Refractor link you share.
        </Entry>
      </Entries>
      <p>
        The air-gapped signer blocks the app's own network requests while it is open. The wallet you sign with there
        works as it does anywhere else.
      </p>
    </Section>

    <Section title="Outside the European Union">
      <p>
        Radicle Garden hosts the app in the European Union. Your browser calls the other hosts above directly. They see
        your IP address, work under their own privacy policies and may process your data outside the European Union.
      </p>
    </Section>

    <Section title="How long">
      <p>
        Consulting Manao GmbH keeps nothing about you. Radicle Garden deletes its access logs, with your IP address, as
        its privacy policy states. Refractor keeps shared transactions under its own terms. What your browser keeps is
        listed below, with how long. What reaches the Stellar network stays on its ledger for good.
      </p>
    </Section>

    <Section id="storage" title="Browser storage">
      <p>
        Stellar Stratum sets no cookies. It keeps the entries below in your browser's storage. Each entry is needed to
        provide the service you ask for, so under §165(3) TKG 2021 none needs your consent. The app cannot work without
        them. None of them tracks you, and none is sent to Consulting Manao GmbH. Angle brackets stand for the part that
        varies, such as an account address.
      </p>
      <Entries title="Local storage">
        <Entry name={<Code>stellar-network</Code>} where="Until cleared">
          Mainnet or Testnet, as you last chose.
        </Entry>
        <Entry name={<Code>stellar-quote-currency</Code>} where="Until cleared">
          The currency you show values in.
        </Entry>
        <Entry name={<Code>horizon-endpoints-v1</Code>} where="Until cleared">
          The Horizon servers you added or turned off.
        </Entry>
        <Entry name={<Code>contract-recents-v1</Code>} where="Until cleared">
          The last five contracts you called on each network.
        </Entry>
        <Entry name={<Code>{'account-history-<account>-<network>'}</Code>} where="Until cleared">
          The newest 1,000 transactions of each account you open, so its activity loads fast.
        </Entry>
        <Entry name={<Code>{'stellar-stratum-address-book-v2-<account>-<network>'}</Code>} where="Until cleared">
          Up to 500 addresses each account you open has paid, suggested when you enter a destination.
        </Entry>
        <Entry name={<Code>{'stellar_asset_cache_v4_<asset>'}</Code>} where="1 day">
          The name and logo of an asset, from its issuer. A failed lookup is kept for 30 minutes.
        </Entry>
        <Entry name={<Code>{'stellar_toml_cache_v4_<domain>:<network>'}</Code>} where="1 day">
          The assets an issuer's <Code>stellar.toml</Code> lists.
        </Entry>
        <Entry name={<Code>stellar_asset_prices_v2</Code>} where="24 hours per price">
          The last price of each asset, shown when the oracle cannot be reached.
        </Entry>
        <Entry name={<Code>stellar_price_fetch_timestamp</Code>} where="Until cleared">
          When a price was last read.
        </Entry>
        <Entry name={<Code>kraken_supported_pairs_v1</Code>} where="Until cleared, renewed daily">
          The currency pairs Kraken quotes, with <Code>kraken_supported_pairs_timestamp_v1</Code>, when they were read.
        </Entry>
        <Entry name={<Code>{'kraken_<asset>_usd_ohlc_daily_v1'}</Code>} where="Until cleared, renewed daily">
          A year of daily prices of an asset for the activity chart, with <Code>{'kraken_<asset>_last_fetch_v1'}</Code>,
          when they were read.
        </Entry>
        <Entry name={<Code>{'kraken_fx_<pair>_ohlc_daily_v2'}</Code>} where="Until cleared, renewed daily">
          A year of daily exchange rates of a currency pair, with <Code>{'kraken_fx_<pair>_last_fetch_v2'}</Code>, when
          they were read.
        </Entry>
      </Entries>
      <Entries title="Session storage">
        <Entry name={<Code>deeplink-xdr</Code>} where="This tab">
          With <Code>deeplink-refractor-id</Code> and <Code>deeplink-source-account</Code>: a transaction opened from a
          Refractor link, until the transaction builder shows it.
        </Entry>
        <Entry name={<Code>LOBSTR_CONNECTION_KEY</Code>} where="This tab">
          The connection to the LOBSTR extension, kept by LOBSTR's library.
        </Entry>
      </Entries>
      <Entries title="Wallets (local storage)">
        <Entry name={<Code>@StellarWalletsKit/selectedModuleId</Code>} where="Until you disconnect">
          The wallet you connected.
        </Entry>
        <Entry name={<Code>@StellarWalletsKit/activeAddress</Code>} where="Until you disconnect">
          The address it gave.
        </Entry>
        <Entry name={<Code>@StellarWalletsKit/hardwareWalletPaths</Code>} where="Until you disconnect">
          The accounts of a Ledger or Trezor you connected, with their derivation paths.
        </Entry>
        <Entry name={<Code>@StellarWalletsKit/usedWalletsIds</Code>} where="Until cleared">
          The wallets you used, listed first next time.
        </Entry>
        <Entry name={<Code>@StellarWalletsKit/wcSessionPaths</Code>} where="Until cleared">
          WalletConnect sessions, written empty by the wallet library: the app offers no WalletConnect wallet.
        </Entry>
      </Entries>
      <p>
        Disconnecting removes the connected wallet and its address. Clearing this site's data in your browser removes
        every entry above. Neither touches your accounts on the Stellar network. Wallet extensions and wallet websites
        keep their own data under their own policies.
      </p>
    </Section>

    <Section title="Your rights">
      <p>
        You can ask for access to your data, its correction or erasure, restricted processing and a copy to take
        elsewhere, and object to processing based on our legitimate interest (Arts. 15 to 21 GDPR). Write to {CONTACT}.
        What is in your browser is under your control: clearing this site's data removes it. Nobody can correct or erase
        what is on the Stellar ledger.
      </p>
      <p>
        You can also complain to the Austrian Data Protection Authority (Datenschutzbehörde,{' '}
        <a href="https://www.dsb.gv.at" target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
          dsb.gv.at
        </a>
        ) or to the authority in your country (Art. 77 GDPR).
      </p>
    </Section>

    <Section title="Changes">
      <p>This policy can change. The version published here applies from the day it is published.</p>
    </Section>
  </>
);

export default Privacy;
