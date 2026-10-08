import { describe, expect, it } from 'vitest';
import { Account, Address, Asset, Horizon, Keypair, MuxedAccount, Networks, StrKey, TransactionBuilder, scValToNative, type Transaction, type xdr } from '@stellar/stellar-sdk';
import { buildPaymentTransaction, type MemoInput, type SorobanServer } from './payments';

const SOURCE = Keypair.random().publicKey();
const FRIEND = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const TEST = new Asset('TEST', ISSUER);
const muxed = (account: string, id: string) => new MuxedAccount(new Account(account, '0'), id).accountId();

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

  it('pays a muxed address, looking up the account behind it', async () => {
    const deposit = muxed(FRIEND, '42');
    const tx = decode(await build([{ destination: deposit, amount: '10', asset: 'XLM' }]));
    expect(tx.operations[0]).toMatchObject({ type: 'payment', destination: deposit, amount: '10.0000000' });
  });

  it('does not create an account from a muxed address, or merge into itself through one', async () => {
    const fresh = Keypair.random().publicKey();
    await expect(build([{ destination: muxed(fresh, '1'), amount: '2', asset: 'XLM' }])).rejects.toThrow(/G… address first/);
    // Once created through its G… address, the same account can be paid as a muxed one.
    const tx = decode(await build([
      { destination: fresh, amount: '2', asset: 'XLM' },
      { destination: muxed(fresh, '1'), amount: '1', asset: 'XLM' },
    ]));
    expect(tx.operations.map((op) => op.type)).toEqual(['createAccount', 'payment']);
    const merge = { destination: muxed(SOURCE, '7'), amount: '0', asset: 'XLM', isAccountClosure: true };
    await expect(build([merge])).rejects.toThrow(/merged into itself/);
  });

  it('pays a contract by calling transfer on the asset contract, alone in its transaction', async () => {
    const vault = StrKey.encodeContract(Buffer.alloc(32, 7));
    const pay = { destination: vault, amount: '12.5', asset: 'TEST', assetIssuer: ISSUER };
    // Soroban RPC stand-in: these contracts exist, and the call is returned as built, unsimulated.
    const soroban = (...contracts: string[]) =>
      ({
        getContractData: async (id: string) => {
          if (!contracts.includes(id)) throw { code: 404, message: 'Contract data not found' };
          return {};
        },
        prepareTransaction: async (tx: Transaction) => tx,
      }) as unknown as SorobanServer;
    const deployed = soroban(vault, TEST.contractId(Networks.TESTNET));
    const buildUnsimulated = (ops: Parameters<typeof buildPaymentTransaction>[3], memo: MemoInput = { type: 'text', value: '' }, rpc = deployed) =>
      buildPaymentTransaction(server, SOURCE, 'testnet', ops, memo, rpc);
    const tx = decode(await buildUnsimulated([pay]));
    expect(tx.operations).toHaveLength(1);
    const { func } = tx.operations[0] as { func: xdr.HostFunction };
    if (func.type !== 'hostFunctionTypeInvokeContract') throw new Error('not a contract call');
    const call = func.invokeContract;
    expect(Address.fromScAddress(call.contractAddress).toString()).toBe(TEST.contractId(Networks.TESTNET));
    expect(call.functionName.toString()).toBe('transfer');
    expect(call.args.map((arg) => scValToNative(arg))).toEqual([SOURCE, vault, 125000000n]);

    await expect(buildUnsimulated([pay, { destination: FRIEND, amount: '1', asset: 'XLM' }])).rejects.toThrow(/only operation/);
    await expect(buildUnsimulated([{ ...pay, receiveAsset: 'XLM' }])).rejects.toThrow(/asset itself/);
    await expect(buildUnsimulated([{ ...pay, isAccountClosure: true }])).rejects.toThrow(/merged into a contract/);
    await expect(buildUnsimulated([pay], { type: 'id', value: '42' })).rejects.toThrow(/memo/);
    await expect(buildUnsimulated([pay], undefined, soroban(TEST.contractId(Networks.TESTNET)))).rejects.toThrow(/no contract at/);
    await expect(buildUnsimulated([pay], undefined, soroban(vault))).rejects.toThrow(/no asset contract/);
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

  it('merges into a muxed address', async () => {
    const holder = Keypair.random().publicKey();
    const merging = fakeServer({
      [SOURCE]: accountJson(SOURCE, [native('100')]),
      [holder]: accountJson(holder, [native('10')]),
    });
    const merge = { destination: muxed(holder, '42'), amount: '0', asset: 'XLM', isAccountClosure: true };
    const xdr = await buildPaymentTransaction(merging, SOURCE, 'testnet', [merge], { type: 'text', value: '' });
    expect(decode(xdr).operations[0]).toMatchObject({ type: 'accountMerge', destination: merge.destination });
  });
});
