/**
 * The screens drawn on the design canvas, grouped in the flows that reach them. One list serves
 * the capture (how to bring each screen up on testnet) and the canvas layout (page, title, size).
 */
import type { Page } from '@playwright/test';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { sign, type Accounts } from './testnet.ts';

export type Board = {
  /** File name on the canvas, without `.dc.html`. */
  name: string;
  /** Canvas page id. */
  page: string;
  title: string;
  /** 390 px wide instead of 1280. */
  phone?: boolean;
  /** The subject is an open dialog: the board is one viewport, clipped. */
  dialog?: boolean;
};

export type Ctx = {
  page: Page;
  base: string;
  accounts: Accounts;
  /** Bring the screen up with `ready`, then save it as board `name`. */
  shot: (name: string, ready: () => Promise<void>) => Promise<void>;
};

export type Flow = { name: string; phone?: boolean; boards: Board[]; run: (ctx: Ctx) => Promise<void> };

export const PAGES = [
  { id: 'map', name: 'Map' },
  { id: 'connect', name: 'Connect' },
  { id: 'dashboard', name: 'Dashboard' },
  { id: 'build', name: 'Build' },
  { id: 'review', name: 'Review and sign' },
  { id: 'coordinate', name: 'Coordinate and submit' },
  { id: 'airgap', name: 'Air-gapped signer' },
  { id: 'other', name: 'Other' },
  { id: 'ideas', name: 'Ideas' },
];

const openAccount = async ({ page, base, accounts }: Ctx) => {
  await page.goto(`${base}/?address=${accounts.A.publicKey()}&network=testnet`);
  await page.getByText('Account Information').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
};

const openBuilder = async (ctx: Ctx) => {
  await openAccount(ctx);
  await ctx.page.getByRole('button', { name: /Initiate Multisig Transaction/ }).click();
  await ctx.page.getByText('Transaction Builder').waitFor();
};

/** Fill a 125 XLM payment to D. */
const fillPayment = async ({ page, accounts }: Ctx) => {
  await page.getByPlaceholder('Enter address').fill(accounts.D.publicKey());
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Edit amount to send' }).click();
  await page.getByLabel('Amount to send').fill('125');
  await page.getByLabel('Amount to send').press('Enter');
  await page.waitForTimeout(800);
};

/** Build the bundled payment and return the XDR the review shows. */
const buildPayment = async ({ page }: Ctx) => {
  await page.getByRole('button', { name: 'Build Transaction' }).click();
  const raw = page.locator('text=Raw XDR').locator('xpath=../../following-sibling::p');
  await raw.waitFor({ timeout: 30_000 });
  return (await raw.innerText()).trim();
};

/** The success overlay is not a dialog: a click on its backdrop closes it. */
const closeOverlay = async (page: Page) => {
  if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  else await page.mouse.click(4, 4);
  await page.waitForTimeout(800);
};

const sep7 = (accounts: Accounts) => {
  const tx = new TransactionBuilder(new Account(accounts.A.publicKey(), '1'), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: accounts.D.publicKey(), asset: Asset.native(), amount: '125' }))
    .setTimeout(0)
    .build();
  return `web+stellar:tx?xdr=${encodeURIComponent(tx.toXDR())}&network_passphrase=${encodeURIComponent(Networks.TESTNET)}`;
};

const signerFlow = (phone: boolean): Flow => {
  const suffix = phone ? '-phone' : '';
  const label = phone ? ' · phone' : '';
  return {
    name: phone ? 'airgap-phone' : 'airgap',
    phone,
    boards: [
      { name: `airgap-empty${suffix}`, page: 'airgap', title: `/sign · empty${label}`, phone },
      { name: `airgap-loaded${suffix}`, page: 'airgap', title: `/sign · loaded${label}`, phone },
    ],
    run: async (ctx) => {
      const { page, base, shot } = ctx;
      await page.goto(`${base}/sign`);
      const input = page.getByPlaceholder('Or paste a transaction XDR / SEP-7 URI');
      await shot(`airgap-empty${suffix}`, () => input.waitFor());
      await shot(`airgap-loaded${suffix}`, async () => {
        await input.fill(sep7(ctx.accounts));
        await page.getByRole('button', { name: 'Load transaction' }).click();
        await page.getByText('Signing for').waitFor();
        await page.waitForTimeout(1500);
      });
    },
  };
};

export const FLOWS: Flow[] = [
  {
    name: 'connect',
    boards: [
      { name: 'connect-landing', page: 'connect', title: 'Landing' },
      { name: 'connect-wallets', page: 'connect', title: 'Connect wallet' },
      { name: 'connect-manual', page: 'connect', title: 'Connect · enter an address' },
      { name: 'connect-load-failed', page: 'connect', title: 'Failed to load account' },
    ],
    run: async ({ page, base, shot }) => {
      await page.goto(`${base}/`);
      await shot('connect-landing', () => page.getByText('Made Simple').waitFor());
      await shot('connect-wallets', async () => {
        await page.getByRole('button', { name: 'Connect wallet' }).click();
        await page.waitForTimeout(2500);
      });
      await shot('connect-manual', () => page.getByRole('button', { name: /address|Watch|manual/i }).first().click());
      await page.goto(`${base}/?address=${Keypair.random().publicKey()}&network=testnet`);
      await shot('connect-load-failed', () => page.getByText('Failed to load account').waitFor({ timeout: 60_000 }));
    },
  },
  {
    name: 'dashboard',
    boards: [
      { name: 'dash-balances', page: 'dashboard', title: 'Balances' },
      { name: 'dash-activity', page: 'dashboard', title: 'Activity' },
      { name: 'dash-multisig', page: 'dashboard', title: 'Multisig' },
      { name: 'dash-endpoints', page: 'dashboard', title: 'Horizon endpoints', dialog: true },
      { name: 'multisig-confirm', page: 'dashboard', title: 'Edit configuration · confirm' },
      { name: 'multisig-edit', page: 'dashboard', title: 'Edit configuration' },
    ],
    run: async (ctx) => {
      const { page, shot } = ctx;
      await openAccount(ctx);
      await shot('dash-balances', () => page.waitForTimeout(1500));
      await shot('dash-activity', async () => {
        await page.getByRole('button', { name: 'Activity', exact: true }).click();
        await page.waitForTimeout(6000);
      });
      await shot('dash-endpoints', async () => {
        await page.getByTitle('Horizon endpoints').click();
        await page.waitForTimeout(1500);
      });
      await page.keyboard.press('Escape');
      await shot('dash-multisig', async () => {
        await page.getByRole('button', { name: 'Multisig', exact: true }).click();
        await page.waitForTimeout(1500);
      });
      await shot('multisig-confirm', async () => {
        await page.getByRole('button', { name: /Edit/ }).last().click();
        await page.waitForTimeout(800);
      });
      await shot('multisig-edit', async () => {
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.waitForTimeout(1500);
      });
    },
  },
  {
    name: 'build',
    boards: [
      { name: 'build-payment', page: 'build', title: 'Payment' },
      { name: 'build-payment-filled', page: 'build', title: 'Payment · filled' },
      { name: 'build-payment-bundled', page: 'build', title: 'Payment · bundled' },
      { name: 'build-contract', page: 'build', title: 'Contract' },
      { name: 'build-contract-filled', page: 'build', title: 'Contract · loaded' },
      { name: 'build-defi', page: 'build', title: 'DeFi' },
      { name: 'build-import', page: 'build', title: 'Import' },
    ],
    run: async (ctx) => {
      const { page, shot } = ctx;
      await openBuilder(ctx);
      await shot('build-payment', () => page.waitForTimeout(2000));
      await shot('build-payment-filled', () => fillPayment(ctx));
      await shot('build-payment-bundled', async () => {
        await page.getByRole('button', { name: 'Bundle' }).click();
        await page.waitForTimeout(800);
      });
      await shot('build-defi', async () => {
        await page.getByRole('tab', { name: 'DeFi' }).click();
        await page.waitForTimeout(1500);
      });
      await shot('build-import', () => page.getByRole('tab', { name: 'Import' }).click());
      await shot('build-contract', () => page.getByRole('tab', { name: 'Contract' }).click());
      await shot('build-contract-filled', async () => {
        await page.getByPlaceholder('C…').fill(Asset.native().contractId(Networks.TESTNET));
        await page.getByRole('button', { name: 'Load', exact: true }).click();
        await page.getByText('Function').first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1500);
      });
    },
  },
  {
    name: 'sign',
    boards: [
      { name: 'review-unsigned', page: 'review', title: 'Review · no signature' },
      { name: 'review-partly-signed', page: 'review', title: 'Review · 1 of 2' },
      { name: 'review-ready', page: 'review', title: 'Review · weight reached' },
      { name: 'review-airgap-mode', page: 'review', title: 'Air-gapped mode' },
      { name: 'review-airgap-qr', page: 'review', title: 'Air-gap sync QR', dialog: true },
      { name: 'share-sent', page: 'coordinate', title: 'Sent to Refractor', dialog: true },
      { name: 'share-link', page: 'coordinate', title: 'Share link', dialog: true },
      { name: 'submit-success', page: 'coordinate', title: 'Submitted' },
    ],
    run: async (ctx) => {
      const { page, shot, accounts } = ctx;
      await openBuilder(ctx);
      await fillPayment(ctx);
      await page.getByRole('button', { name: 'Bundle' }).click();
      let xdr = '';
      await shot('review-unsigned', async () => {
        xdr = await buildPayment(ctx);
        await page.waitForTimeout(2500);
      });
      await shot('review-airgap-mode', async () => {
        await page.getByText('Air-gapped (Offline)').click();
        await page.waitForTimeout(500);
      });
      await shot('review-airgap-qr', async () => {
        await page.getByRole('button', { name: 'Air-gap sync' }).click();
        await page.waitForTimeout(1500);
      });
      await closeOverlay(page);
      await page.getByText('Refractor (Online)').click();

      await page.getByRole('tab', { name: 'Import' }).click();
      const paste = page.getByPlaceholder('Paste transaction XDR here...');
      await shot('review-partly-signed', async () => {
        await paste.fill(sign(xdr, accounts.A));
        await page.getByText('Weight: 1/2').waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1500);
      });
      await shot('share-sent', async () => {
        await page.getByRole('button', { name: 'Send for Signature' }).click();
        await page.getByText('Send this transaction to other signers').waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1500);
      });
      await closeOverlay(page);
      await shot('share-link', async () => {
        await page.getByText('Last Submitted').locator('xpath=../..').getByRole('button').last().click();
        await page.getByText('Share Transaction for Signature').waitFor({ timeout: 10_000 });
      });
      await closeOverlay(page);
      await shot('review-ready', async () => {
        await paste.fill(sign(xdr, accounts.A, accounts.B));
        await page.getByText('Weight: 2/2').waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1500);
      });
      await shot('submit-success', async () => {
        await page.getByRole('button', { name: 'Send Transaction to Testnet' }).click();
        await page.getByText('Transaction Submitted Successfully').waitFor({ timeout: 90_000 });
        await page.waitForTimeout(1000);
      });
    },
  },
  signerFlow(false),
  signerFlow(true),
  {
    name: 'other',
    boards: [
      { name: 'legal-impressum', page: 'other', title: 'Legal · Impressum' },
      { name: 'misc-404', page: 'other', title: 'Not found' },
    ],
    run: async ({ page, base, shot }) => {
      await page.goto(`${base}/legal/impressum`);
      await shot('legal-impressum', () => page.waitForTimeout(800));
      await page.goto(`${base}/nope`);
      await shot('misc-404', () => page.waitForTimeout(800));
    },
  },
];

export const BOARDS: Board[] = FLOWS.flatMap((f) => f.boards);
