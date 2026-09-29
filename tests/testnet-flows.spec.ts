/**
 * End-to-end flows on Stellar TESTNET only. Accounts are throwaway friendbot accounts, the app
 * is used watch-only (no wallet extension in the test browser) and signatures are added
 * outside the app, then imported. Every request to a mainnet endpoint is blocked and makes the
 * test fail: on testnet the app must not talk to mainnet at all.
 */
import { expect, test, type Page } from '@playwright/test';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
const MAINNET_HOSTS = [
  'horizon.stellar.org',
  'horizon.stellar.lobstr.co',
  'horizon.stellarx.com',
  'rpc.ankr.com',
  'rpc.lightsail.network',
  'api.soroswap.finance',
  'api.defindex.io',
];

const fund = async (kp: Keypair) => {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
};

const xlmBalance = async (id: string) =>
  Number((await horizon.loadAccount(id)).balances.find((b) => b.asset_type === 'native')!.balance);

/** Abort mainnet requests and remember them so the test can fail on them. */
const guardMainnet = async (page: Page) => {
  const blocked: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (MAINNET_HOSTS.includes(url.hostname)) {
      blocked.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(() => localStorage.setItem('stellar-network', 'testnet'));
  return blocked;
};

const openAccount = async (page: Page, account: string) => {
  await page.goto(`/?address=${account}&network=testnet`);
  await expect(page.getByText(account).first()).toBeVisible({ timeout: 60_000 });
};

const sign = (xdr: string, ...signers: Keypair[]) => {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  signers.forEach((kp) => tx.sign(kp));
  return tx.toXDR();
};

/** Build a payment in the Payment tab and return the XDR the app shows. */
const buildPayment = async (page: Page, destination: string, amount: string) => {
  await page.getByRole('button', { name: /Initiate Multisig Transaction/ }).click();
  await page.getByPlaceholder('Enter address').fill(destination);
  await page.getByRole('button', { name: 'Edit amount to send' }).click();
  await page.getByLabel('Amount to send').fill(amount);
  await page.getByLabel('Amount to send').press('Enter');
  await page.getByRole('button', { name: 'Bundle' }).click();
  await page.getByRole('button', { name: 'Build Transaction' }).click();
  const raw = page.locator('text=Raw XDR').locator('xpath=../../following-sibling::p');
  await expect(raw).toBeVisible({ timeout: 30_000 });
  return (await raw.innerText()).trim();
};

const importXdr = async (page: Page, xdr: string) => {
  await page.getByRole('tab', { name: 'Import' }).click();
  await page.getByPlaceholder('Paste transaction XDR here...').fill(xdr);
};

test('payment: build, sign outside the app, submit from the Import tab', async ({ page }) => {
  const A = Keypair.random();
  const B = Keypair.random();
  await Promise.all([fund(A), fund(B)]);
  const blocked = await guardMainnet(page);

  await openAccount(page, A.publicKey());
  const xdr = await buildPayment(page, B.publicKey(), '12.5');
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  // The hash shown for verification must be the testnet hash
  await expect(page.getByText(Buffer.from(tx.hash()).toString('hex')).first()).toBeVisible();
  await expect(page.getByText('Testnet', { exact: true }).first()).toBeVisible();

  const before = await xlmBalance(B.publicKey());
  await importXdr(page, sign(xdr, A));
  await page.getByRole('button', { name: 'Send Transaction to Testnet' }).click();
  await expect(page.getByText('Transaction Submitted Successfully')).toBeVisible({ timeout: 90_000 });
  expect(await xlmBalance(B.publicKey())).toBeCloseTo(before + 12.5, 5);
  expect(blocked).toEqual([]);
});

test('the review checks the sequence number against the account as it is now', async ({ page }) => {
  const A = Keypair.random();
  const B = Keypair.random();
  await Promise.all([fund(A), fund(B)]);
  const blocked = await guardMainnet(page);
  await openAccount(page, A.publicKey());

  // Another device uses a sequence number after the app loaded the account
  const elsewhere = new TransactionBuilder(await horizon.loadAccount(A.publicKey()), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.bumpSequence({ bumpTo: '0' }))
    .setTimeout(300)
    .build();
  elsewhere.sign(A);
  await horizon.submitTransaction(elsewhere);

  // The app's own transaction must not be flagged as out of sequence
  await buildPayment(page, B.publicKey(), '1');
  await expect(page.getByText('Pay 1 XLM to')).toBeVisible();
  await expect(page.getByText(/cannot land yet|has already used sequence/)).toHaveCount(0);

  // A transaction that skips ahead is
  const account = await horizon.loadAccount(A.publicKey());
  account.incrementSequenceNumber();
  account.incrementSequenceNumber();
  const ahead = new TransactionBuilder(account, { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: B.publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(3600)
    .build();
  await importXdr(page, ahead.toXDR());
  await expect(page.getByText(/must first send 2 other transaction/)).toBeVisible({ timeout: 30_000 });
  expect(blocked).toEqual([]);
});

test('2-of-2 multisig: one signature is not enough, two are', async ({ page }) => {
  const A = Keypair.random();
  const B = Keypair.random();
  const C = Keypair.random();
  await Promise.all([fund(A), fund(C)]);
  // A becomes a 2-of-2 with B
  const setup = new TransactionBuilder(await horizon.loadAccount(A.publicKey()), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: B.publicKey(), weight: 1 } }))
    .addOperation(Operation.setOptions({ lowThreshold: 2, medThreshold: 2, highThreshold: 2 }))
    .setTimeout(60)
    .build();
  setup.sign(A);
  await horizon.submitTransaction(setup);
  const blocked = await guardMainnet(page);

  await openAccount(page, A.publicKey());
  const xdr = await buildPayment(page, C.publicKey(), '3');
  await expect(page.getByText('Weight: 0/2')).toBeVisible();

  await importXdr(page, sign(xdr, A));
  await expect(page.getByText('Weight: 1/2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send for Signature' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Transaction to Testnet' })).toHaveCount(0);

  await importXdr(page, sign(xdr, A, B));
  await expect(page.getByText('Weight: 2/2')).toBeVisible();
  await page.getByRole('button', { name: 'Send Transaction to Testnet' }).click();
  await expect(page.getByText('Transaction Submitted Successfully')).toBeVisible({ timeout: 90_000 });
  expect(blocked).toEqual([]);
});

test('Refractor share link opens the transaction on testnet', async ({ page }) => {
  const A = Keypair.random();
  await fund(A);
  const tx = new TransactionBuilder(await horizon.loadAccount(A.publicKey()), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: A.publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(3600)
    .build();
  const posted = await fetch('https://api.refractor.space/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ network: 'testnet', xdr: tx.toXDR() }),
  }).then((r) => r.json());
  const blocked = await guardMainnet(page);
  // Start from mainnet on purpose: the link itself must switch the app to testnet
  await page.addInitScript(() => localStorage.setItem('stellar-network', 'mainnet'));

  await page.goto(`/?r=${posted.hash}`);
  await expect(page.getByText(posted.hash).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Testnet', { exact: true }).first()).toBeVisible();
  // The switch is announced until acknowledged, and not remembered for the next visit
  await expect(page.getByText('The link you opened switched the app to')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('stellar-network'))).toBe('mainnet');
  // The app starts on mainnet here, so its mainnet price lookups before the switch are expected
  // (and blocked). The transaction's account must never be read from mainnet Horizon.
  expect(blocked.filter((url) => url.includes('horizon'))).toEqual([]);
});

test('air-gapped signer keeps the network of a SEP-7 QR and hashes for it', async ({ page }) => {
  const A = Keypair.random();
  const tx = new TransactionBuilder(new (await import('@stellar/stellar-sdk')).Account(A.publicKey(), '1'), {
    fee: '1000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
    .setTimeout(0)
    .build();
  const uri = `web+stellar:tx?xdr=${encodeURIComponent(tx.toXDR())}&network_passphrase=${encodeURIComponent(Networks.TESTNET)}`;
  const blocked = await guardMainnet(page);
  await page.addInitScript(() => localStorage.setItem('stellar-network', 'mainnet'));

  await page.goto('/sign');
  await page.getByPlaceholder('Or paste a transaction XDR / SEP-7 URI').fill(uri);
  await page.getByRole('button', { name: 'Load transaction' }).click();
  await expect(page.getByText('Signing for')).toContainText('Testnet');
  await expect(page.getByText(Buffer.from(tx.hash()).toString('hex')).first()).toBeVisible();
  expect(blocked).toEqual([]);
});
