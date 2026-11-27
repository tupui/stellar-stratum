/**
 * End-to-end flows on Stellar TESTNET only. Accounts are throwaway friendbot accounts, the app
 * is used watch-only (no wallet extension in the test browser) and signatures are added
 * outside the app, then imported. Every request to a mainnet endpoint is blocked and makes the
 * test fail: on testnet the app must not talk to mainnet at all.
 */
import { expect, test, type Page } from '@playwright/test';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { decodeEnvelope, encodeEnvelope, encodeSignatureSet } from '../src/lib/airgap/payloads';
import { encodeSinglePartUR, URAssembler } from '../src/lib/airgap/ur';

const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
const MAINNET_HOSTS = [
  'horizon.stellar.org',
  'horizon.stellar.lobstr.co',
  'horizon.stellarx.com',
  'rpc.ankr.com',
  'api.soroswap.finance',
  'api.defindex.io',
];

const fund = async (kp: Keypair) => {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
};

const xlmBalance = async (id: string) =>
  Number((await horizon.loadAccount(id)).balances.find((b) => b.asset_type === 'native')!.balance);

// Testnet balances are shown at mainnet prices, read from Reflector through this RPC. The tests
// never contact mainnet, so these reads are aborted too, but they are expected.
const PRICE_HOSTS = ['rpc.lightsail.network'];

// Reviewing a contract call with unknown tokens reads Soroswap's token list, on both networks.
const isTokenList = (url: URL) => url.hostname === 'api.soroswap.finance' && url.pathname === '/asset-list';

/** Abort mainnet requests and remember the unexpected ones so the test can fail on them. */
const guardMainnet = async (page: Page) => {
  const blocked: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (PRICE_HOSTS.includes(url.hostname)) return route.abort();
    if (isTokenList(url)) return route.continue();
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
  // The header's account pill reads the short key
  const short = `${account.slice(0, 8)}…${account.slice(-8)}`;
  await expect(page.getByRole('button', { name: `Account ${short}` })).toBeVisible({ timeout: 60_000 });
};

const sign = (xdr: string, ...signers: Keypair[]) => {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  signers.forEach((kp) => tx.sign(kp));
  return tx.toXDR();
};

/** Build a payment in the Payment tab and return the XDR the app shows. */
const buildPayment = async (page: Page, destination: string, amount: string) => {
  await page.getByRole('button', { name: 'New Transaction' }).click();
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
  // While a transaction is reviewed the builder is folded to one row: open it first.
  const expand = page.getByRole('button', { name: 'Expand Transaction Builder' });
  if (await expand.isVisible()) await expand.click();
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
  await expect(page.getByRole('img', { name: 'Weight 0 of 2' })).toBeVisible();

  await importXdr(page, sign(xdr, A));
  await expect(page.getByRole('img', { name: 'Weight 1 of 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send for Signature' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send Transaction to Testnet' })).toHaveCount(0);

  await importXdr(page, sign(xdr, A, B));
  await expect(page.getByRole('img', { name: 'Weight 2 of 2' })).toBeVisible();
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
  // The app starts on mainnet here: the transaction's account must never be read from mainnet Horizon.
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
  await page.getByRole('button', { name: 'Load Transaction' }).click();
  await expect(page.getByText('Signing for')).toContainText('Testnet');
  await expect(page.getByText(Buffer.from(tx.hash()).toString('hex')).first()).toBeVisible();
  expect(blocked).toEqual([]);
});

/** Read the animated QR on the page frame by frame, as the air-gapped signer's camera would. */
const readAnimatedQr = async (page: Page) => {
  const canvas = page.getByRole('img', { name: 'QR code of the transaction' });
  const assembler = new URAssembler();
  for (let i = 0; i < 60; i++) {
    const { width, height, pixels } = await canvas.evaluate((el: HTMLCanvasElement) => {
      const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height);
      return { width: data.width, height: data.height, pixels: Array.from(data.data) };
    });
    const code = jsQR(Uint8ClampedArray.from(pixels), width, height);
    if (code) {
      const state = assembler.receive(code.data);
      if (state.status === 'complete') return state.payload;
      expect(state.status).toBe('collecting');
    }
    await page.waitForTimeout(120);
  }
  throw new Error('The animated QR never completed');
};

/** Show a QR code to the scanner through its image upload (the test browser has no camera). */
const uploadQr = async (page: Page, text: string) => {
  const buffer = await QRCode.toBuffer(text, { margin: 2, scale: 6 });
  await page.locator('input[type=file][accept^="image/"]').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer });
};

test('air-gap: an animated QR out, a Signature QR back', async ({ page }) => {
  const A = Keypair.random();
  const B = Keypair.random();
  await Promise.all([fund(A), fund(B)]);
  // Ten payments do not fit one readable QR code: the app must animate them.
  const builder = new TransactionBuilder(await horizon.loadAccount(A.publicKey()), { fee: '1000', networkPassphrase: Networks.TESTNET });
  for (let i = 0; i < 10; i++) builder.addOperation(Operation.payment({ destination: B.publicKey(), asset: Asset.native(), amount: '1' }));
  const tx = builder.setTimeout(3600).build();
  const blocked = await guardMainnet(page);

  await openAccount(page, A.publicKey());
  await page.getByRole('button', { name: 'New Transaction' }).click();
  await importXdr(page, tx.toXDR());
  await expect(page.getByRole('img', { name: 'Weight 0 of 1' })).toBeVisible({ timeout: 30_000 });
  await page.getByText('Air-gapped (Offline)').click();
  await page.getByRole('button', { name: 'Air-gap Sync' }).click();
  await expect(page.getByText(/\d parts, read in any order/)).toBeVisible();

  await expect(page.getByText(Buffer.from(tx.hash()).toString('hex')).first()).toBeVisible();
  // The offline device reads the whole transaction, on testnet, from the frames
  const received = decodeEnvelope((await readAnimatedQr(page)).cbor);
  expect(received).toEqual({ xdr: tx.toXDR(), network: 'testnet' });

  // and answers with its signature only. A signature for another transaction is refused first.
  await page.getByRole('button', { name: 'Scan Signature' }).click();
  const other = TransactionBuilder.fromXDR(tx.toXDR(), Networks.PUBLIC);
  other.sign(A);
  await uploadQr(page, encodeSinglePartUR(encodeSignatureSet({ hash: other.hash(), signatures: other.signatures })));
  await expect(page.getByText('Not this transaction')).toBeVisible();

  const signed = TransactionBuilder.fromXDR(received.xdr, Networks.TESTNET);
  signed.sign(A);
  await uploadQr(page, encodeSinglePartUR(encodeSignatureSet({ hash: signed.hash(), signatures: signed.signatures })));
  await expect(page.getByText('Signature added').first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Weight 1 of 1' })).toBeVisible();

  const before = await xlmBalance(B.publicKey());
  await page.getByRole('button', { name: 'Send Transaction to Testnet' }).click();
  await expect(page.getByText('Transaction Submitted Successfully')).toBeVisible({ timeout: 90_000 });
  expect(await xlmBalance(B.publicKey())).toBeCloseTo(before + 10, 5);
  expect(blocked).toEqual([]);
});

test('air-gapped signer loads a transaction read from an animated QR', async ({ page }) => {
  const A = Keypair.random();
  const builder = new TransactionBuilder(new (await import('@stellar/stellar-sdk')).Account(A.publicKey(), '1'), {
    fee: '1000',
    networkPassphrase: Networks.TESTNET,
  });
  for (let i = 0; i < 10; i++) builder.addOperation(Operation.bumpSequence({ bumpTo: String(i + 2) }));
  const tx = builder.setTimeout(0).build();
  const blocked = await guardMainnet(page);
  await page.addInitScript(() => localStorage.setItem('stellar-network', 'mainnet'));

  await page.goto('/sign');
  // What the scanner hands over once every frame is in: the whole transaction as one UR
  await page.getByPlaceholder('Or paste a transaction XDR / SEP-7 URI').fill(encodeSinglePartUR(encodeEnvelope(tx.toXDR(), 'testnet')));
  await page.getByRole('button', { name: 'Load Transaction' }).click();
  await expect(page.getByText('Signing for')).toContainText('Testnet');
  await expect(page.getByText(Buffer.from(tx.hash()).toString('hex')).first()).toBeVisible();
  expect(blocked).toEqual([]);
});
