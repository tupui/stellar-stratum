import { Ban, FileText, HandCoins, KeyRound, Landmark } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LegalHeader, Section, Summary } from '@/components/legal';
import { TEXT_LINK } from '@/lib/legal';

const Terms = () => (
  <>
    <LegalHeader icon={FileText} title="Terms of use">
      The rules for using Stellar Stratum. Using the app means you accept them.
    </LegalHeader>
    <Summary
      points={[
        {
          icon: KeyRound,
          title: 'Your keys, your transactions',
          text: 'Your wallet signs. The app never holds your keys or funds, and nobody can reverse a transaction the network accepted.',
        },
        {
          icon: Ban,
          title: 'No financial service',
          text: 'Stellar Stratum is not a broker or custodian, and nothing in it is advice.',
        },
        {
          icon: Landmark,
          title: 'Not operated by SDF',
          text: 'The Stellar Development Foundation does not operate Stellar Stratum and is not liable for it.',
        },
        {
          icon: HandCoins,
          title: 'Free',
          text: 'The app costs nothing. Each transaction pays its Stellar network fee.',
        },
      ]}
    />

    <Section title="The service">
      <p>
        Stellar Stratum is a web app to manage Stellar multisig accounts. It shows balances and activity, builds
        transactions, collects signatures and submits transactions to the Stellar network. It runs in your browser.
        Consulting Manao GmbH only operates the infrastructure that serves it, free of charge. Its company details are in
        the{' '}
        <Link to="/legal/impressum" className={TEXT_LINK}>
          Impressum
        </Link>
        .
      </p>
      <p>
        The Stellar Development Foundation does not operate Stellar Stratum and is not responsible or liable for it.
        Stellar is a trademark of the Stellar Development Foundation, used here to name the network.
      </p>
    </Section>

    <Section title="Not a financial service">
      <p>
        Stellar Stratum is not a financial service, a broker or a custodian. It never holds your secret keys or your
        funds: your wallet signs, and your browser sends the signed transaction to the network. Nothing in the app is
        financial, investment, tax or legal advice. Prices and exchange rates come from Reflector oracles and Kraken. They
        are for information only and can be wrong or out of date.
      </p>
    </Section>

    <Section title="Costs">
      <p>
        The app is free. Each transaction pays a Stellar network fee in XLM, which the review screen shows before you
        sign.
      </p>
    </Section>

    <Section title="Your responsibility">
      <p>
        You hold your keys and choose your signers. Check every transaction on the review screen and on your signing
        device before you sign. A transaction the network accepts is final, and nobody can reverse it. The app warns you
        when a configuration change could lock an account, and it checks the transactions the Soroswap and DeFindex APIs
        build, but these checks can miss a case. You decide what you sign.
      </p>
    </Section>

    <Section title="Other services">
      <p>
        The app relies on the Stellar network and its Horizon and RPC servers, Refractor, Reflector, Kraken, Soroswap,
        DeFindex and the wallet you choose. Each works under its own terms. Consulting Manao GmbH is not responsible for
        them, for their availability or for what they return. The{' '}
        <Link to="/legal/privacy" className={TEXT_LINK}>
          Privacy policy
        </Link>{' '}
        lists what each of them receives.
      </p>
    </Section>

    <Section title="Acceptable use">
      <p>
        Use the app only lawfully. Do not disrupt it or the services it relies on, do not try to get around its
        protections, and do not use it to infringe the rights of others.
      </p>
    </Section>

    <Section title="No warranty">
      <p>
        The app is provided "as is" and "as available", without warranties of any kind. It can contain errors and be
        unavailable.
      </p>
    </Section>

    <Section title="Liability">
      <p>
        Consulting Manao GmbH is liable only where the law does not allow its liability to be excluded: for intent, gross
        negligence, personal injury and under product liability law.
      </p>
    </Section>

    <Section title="Changes">
      <p>
        These terms can change. A change applies from the day it is published here. If you do not accept it, stop using
        the app.
      </p>
    </Section>

    <Section title="Governing law">
      <p>
        Austrian law applies, excluding its conflict-of-laws rules and the UN Convention on Contracts for the
        International Sale of Goods. The courts of Graz, Austria, have jurisdiction as far as the law allows. If you are a
        consumer, the mandatory protections of your country of residence still apply.
      </p>
    </Section>
  </>
);

export default Terms;
