import { describe, expect, it } from 'vitest';
import { Asset, Horizon, Keypair, Networks, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { buildPaymentTransaction, type MemoInput } from './payments';

const SOURCE = Keypair.random().publicKey();
const FRIEND = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const TEST = new Asset('TEST', ISSUER);

const native = (balance: string) => ({ asset_type: 'native', balance, selling_liabilities: '0', buying_liabilities: '0' });
const trustline = (balance: string, limit = '1000') => ({
  asset_type: 'credit_alphanum4', asset_code: 'TEST', asset_issuer: ISSUER, balance, limit,
  selling_liabilities: '0', buying_liabilities: '0', is_authorized: true,
});

const accountJson = (id: string, balances: object[], subentries = 0) => ({
  id, account_id: id, sequence: '100', subentry_count: subentries, num_sponsoring: 0, num_sponsored: 0,
  balances, signers: [{ key: id, weight: 1, type: 'ed25519_public_key' }],
  thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 }, data_attr: {}, flags: {},
});

/** A Horizon stand-in: accounts by id (missing ones 404) and an order book with no paths. */
const fakeServer = (accounts: Record<string, ReturnType<typeof accountJson>>) =>
  ({
    loadAccount: async (id: string) => {
      if (!accounts[id]) throw Object.assign(new Error('Not Found'), { name: 'NotFoundError', response: { status: 404 } });
      return new Horizon.AccountResponse(accounts[id] as never);
    },
    strictSendPaths: () => ({ call: async () => ({ records: [] }) }),
    strictReceivePaths: () => ({ call: async () => ({ records: [] }) }),
  }) as unknown as Horizon.Server;

const server = fakeServer({
  [SOURCE]: accountJson(SOURCE, [native('100'), trustline('50')], 1),
  [FRIEND]: accountJson(FRIEND, [native('10')]),
});
const build = (ops: Parameters<typeof buildPaymentTransaction>[3], memo: MemoInput = { type: 'text', value: '' }) =>
  buildPaymentTransaction(server, SOURCE, 'testnet', ops, memo);
const decode = (xdr: string) => TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;

describe('buildPaymentTransaction', () => {
  it('builds a payment with one transaction memo and a day of validity', async () => {
    const tx = decode(await build([{ destination: FRIEND, amount: '10', asset: 'XLM' }], { type: 'id', value: '42' }));
    expect(tx.operations[0]).toMatchObject({ type: 'payment', destination: FRIEND, amount: '10.0000000' });
    expect(tx.memo.type).toBe('id');
    expect(Number(tx.timeBounds!.maxTime) - Date.now() / 1000).toBeGreaterThan(86_000);
  });

  it('creates an unfunded destination, then pays it', async () => {
    const fresh = Keypair.random().publicKey();
    const tx = decode(await build([
      { destination: fresh, amount: '2', asset: 'XLM' },
      { destination: fresh, amount: '1', asset: 'XLM' },
    ]));
    expect(tx.operations.map((op) => op.type)).toEqual(['createAccount', 'payment']);
  });

  it('refuses what the network would reject', async () => {
    const fresh = Keypair.random().publicKey();
    await expect(build([{ destination: fresh, amount: '0.5', asset: 'XLM' }])).rejects.toThrow(/at least 1 XLM/);
    await expect(build([{ destination: fresh, amount: '5', asset: 'TEST', assetIssuer: ISSUER }])).rejects.toThrow(/does not exist yet/);
    await expect(build([{ destination: FRIEND, amount: '5', asset: 'TEST', assetIssuer: ISSUER }])).rejects.toThrow(/no trustline/);
    // 100 XLM, one trustline: minimum balance 1.5 XLM plus the fee
    await expect(build([{ destination: FRIEND, amount: '99', asset: 'XLM' }])).rejects.toThrow(/can be spent/);
    await expect(build([{ destination: FRIEND, amount: '10', asset: 'XLM', receiveAsset: 'TEST', receiveAssetIssuer: ISSUER }])).rejects.toThrow(/no market path/);
  });

  it('only merges as the last operation, with trustlines emptied', async () => {
    const merge = { destination: FRIEND, amount: '0', asset: 'XLM', isAccountClosure: true };
    await expect(build([merge, { destination: FRIEND, amount: '1', asset: 'XLM' }])).rejects.toThrow(/last operation/);
    await expect(build([merge])).rejects.toThrow(/Send all your TEST/);
  });
});

describe('merging an account with drained trustlines', () => {
  it('removes the trustline, then merges', async () => {
    const holder = Keypair.random().publicKey();
    const merging = fakeServer({
      [SOURCE]: accountJson(SOURCE, [native('100'), trustline('50')], 1),
      [holder]: accountJson(holder, [native('10'), trustline('0', '1000')], 1),
    });
    const xdr = await buildPaymentTransaction(merging, SOURCE, 'testnet', [
      { destination: holder, amount: '50', asset: 'TEST', assetIssuer: ISSUER },
      { destination: holder, amount: '0', asset: 'XLM', isAccountClosure: true },
    ], { type: 'text', value: '' });
    expect(decode(xdr).operations.map((op) => op.type)).toEqual(['payment', 'changeTrust', 'accountMerge']);
    expect((decode(xdr).operations[1] as { line?: Asset }).line?.equals(TEST)).toBe(true);
  });
});
