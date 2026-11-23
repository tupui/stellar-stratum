/** Throwaway testnet accounts for the capture, and the guard that keeps it off mainnet. */
import type { BrowserContext } from '@playwright/test';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, type xdr } from '@stellar/stellar-sdk';

const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');

/** Mainnet hosts the app may call. Every request to them is aborted, prices included. */
const MAINNET_HOSTS = [
  'horizon.stellar.org',
  'horizon.stellar.lobstr.co',
  'horizon.stellarx.com',
  'rpc.ankr.com',
  'rpc.lightsail.network',
  'api.soroswap.finance',
  'api.defindex.io',
];

export type Accounts = { A: Keypair; B: Keypair; C: Keypair; D: Keypair };

const fund = async (kp: Keypair) => {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
};

const submit = async (source: Keypair, ops: xdr.Operation[]) => {
  const builder = new TransactionBuilder(await horizon.loadAccount(source.publicKey()), { fee: '1000', networkPassphrase: Networks.TESTNET });
  ops.forEach((op) => builder.addOperation(op));
  const tx = builder.setTimeout(120).build();
  tx.sign(source);
  return horizon.submitTransaction(tx);
};

export const sign = (envelope: string, ...signers: Keypair[]) => {
  const tx = TransactionBuilder.fromXDR(envelope, Networks.TESTNET);
  signers.forEach((kp) => tx.sign(kp));
  return tx.toXDR();
};

/**
 * A: a 2-of-3 multisig (master, B and C weigh 1; medium and high thresholds 2) with a USDC
 * trustline and some history. D: a funded account A pays and that paid A.
 */
export const setupAccounts = async (): Promise<Accounts> => {
  const [A, B, C, D] = [Keypair.random(), Keypair.random(), Keypair.random(), Keypair.random()];
  await Promise.all([fund(A), fund(D)]);
  await submit(A, [
    Operation.changeTrust({ asset: USDC }),
    Operation.payment({ destination: D.publicKey(), asset: Asset.native(), amount: '250' }),
    Operation.setOptions({ signer: { ed25519PublicKey: B.publicKey(), weight: 1 } }),
    Operation.setOptions({ signer: { ed25519PublicKey: C.publicKey(), weight: 1 } }),
    Operation.setOptions({ masterWeight: 1, lowThreshold: 1, medThreshold: 2, highThreshold: 2 }),
  ]);
  await submit(D, [Operation.payment({ destination: A.publicKey(), asset: Asset.native(), amount: '42.5' })]);
  return { A, B, C, D };
};

/** Abort every mainnet request and start the app on testnet. Returns the hosts it tried. */
export const guardMainnet = async (context: BrowserContext) => {
  const blocked = new Set<string>();
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (MAINNET_HOSTS.includes(host) || host.includes('mainnet')) {
      blocked.add(host);
      return route.abort();
    }
    return route.continue();
  });
  await context.addInitScript(() => localStorage.setItem('stellar-network', 'testnet'));
  return blocked;
};
