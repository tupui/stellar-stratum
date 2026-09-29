import { describe, expect, it } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Memo,
  MuxedAccount,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk';
import { describeOperation, describeTransaction } from './describe';

const SOURCE = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();

const build = (
  configure: (b: TransactionBuilder) => void,
  options: Partial<ConstructorParameters<typeof TransactionBuilder>[1]> = {},
  sequence = '100',
) => {
  const builder = new TransactionBuilder(new Account(SOURCE, sequence), { fee: '100', networkPassphrase: Networks.TESTNET, ...options });
  configure(builder);
  if (!options.timebounds) builder.setTimeout(3600);
  return TransactionBuilder.fromXDR(builder.build().toXDR(), Networks.TESTNET) as Transaction;
};

const texts = (notices: { text: string }[]) => notices.map((n) => n.text).join('\n');

describe('describeOperation', () => {
  it('names the counterparty and amounts in the one-line summary', () => {
    const tx = build((b) => b.addOperation(Operation.payment({ destination: OTHER, asset: Asset.native(), amount: '12.5' })));
    const view = describeOperation(tx.operations[0], 'testnet');
    expect(view.summary).toBe(`Pay 12.5 XLM to ${OTHER.slice(0, 8)}…${OTHER.slice(-8)}`);
    expect(view.fields).toContainEqual({ label: 'To', value: OTHER, mono: true });
  });

  it('makes a giveaway offer price visible', () => {
    const usd = new Asset('USD', OTHER);
    const tx = build((b) =>
      b.addOperation(Operation.manageSellOffer({ selling: usd, buying: Asset.native(), amount: '10000', price: '0.0000001' })),
    );
    expect(describeOperation(tx.operations[0], 'testnet').summary).toBe(
      `Offer to sell 10000 USD (${OTHER.slice(0, 8)}…${OTHER.slice(-8)}) for 0.001 XLM`,
    );
  });

  it('reads the trustline asset (the field is "line")', () => {
    const usd = new Asset('USD', OTHER);
    const tx = build((b) => b.addOperation(Operation.changeTrust({ asset: usd, limit: '0' })));
    const view = describeOperation(tx.operations[0], 'testnet');
    expect(view.summary).toContain('Remove the trustline to USD');
    expect(view.fields).toContainEqual({ label: 'USD issuer', value: OTHER, mono: true });
  });

  it('flags look-alike well-known assets', () => {
    const fakeUsdc = new Asset('USDC', OTHER);
    const fakeXlm = new Asset('XLM', OTHER);
    const tx = build((b) =>
      b
        .addOperation(Operation.payment({ destination: OTHER, asset: fakeUsdc, amount: '1' }))
        .addOperation(Operation.payment({ destination: OTHER, asset: fakeXlm, amount: '1' })),
    );
    expect(texts(describeOperation(tx.operations[0], 'mainnet').notices)).toMatch(/not Circle's/);
    expect(texts(describeOperation(tx.operations[1], 'testnet').notices)).toMatch(/not the native lumen/);
  });

  it('warns that a sequence bump near the maximum can lock the account', () => {
    const tx = build((b) => b.addOperation(Operation.bumpSequence({ bumpTo: '9223372036854775807' })));
    const view = describeOperation(tx.operations[0], 'testnet');
    expect(view.notices.some((n) => n.severity === 'critical')).toBe(true);
  });

  it('shows hidden characters in data entries', () => {
    const tx = build((b) => b.addOperation(Operation.manageData({ name: 'pay\u202Eto', value: 'x' })));
    const view = describeOperation(tx.operations[0], 'testnet');
    expect(view.fields[0].value).toBe('pay⟨U+202E⟩to');
    expect(texts(view.notices)).toMatch(/invisible or direction-changing/);
  });

  it('never leaves an operation type undescribed', () => {
    const tx = build((b) => b.addOperation(Operation.inflation()));
    expect(describeOperation(tx.operations[0], 'testnet').notices[0].text).toMatch(/does not decode/);
  });

  it('points out muxed addresses', () => {
    const muxed = new MuxedAccount(new Account(OTHER, '0'), '7').accountId();
    const tx = build((b) => b.addOperation(Operation.payment({ destination: muxed, asset: Asset.native(), amount: '1' })));
    expect(texts(describeOperation(tx.operations[0], 'testnet').notices)).toMatch(/muxed address/);
  });
});

describe('describeTransaction', () => {
  const payment = (b: TransactionBuilder) => b.addOperation(Operation.payment({ destination: OTHER, asset: Asset.native(), amount: '1' }));

  it('shows a minimum sequence number, which the SDK getter hides when it is 0', () => {
    const tx = build(payment, { minAccountSequence: '0' }, '9223372036854775806');
    const view = describeTransaction(tx);
    expect(view.validity).toContainEqual({ label: 'Minimum account sequence', value: '0' });
    const critical = view.notices.filter((n) => n.severity === 'critical').map((n) => n.text).join('\n');
    expect(critical).toMatch(/stays valid after the account sends other transactions/);
    expect(critical).toMatch(/close to the maximum/);
  });

  it('compares the sequence number with the account', () => {
    const ahead = build(payment, {}, '104');
    expect(texts(describeTransaction(ahead, { account: { publicKey: SOURCE, sequence: '100' } }).notices)).toMatch(
      /must first send 4 other transaction/,
    );
    const used = build(payment, {}, '99');
    expect(texts(describeTransaction(used, { account: { publicKey: SOURCE, sequence: '100' } }).notices)).toMatch(/already used/);
    const next = build(payment, {}, '100');
    expect(describeTransaction(next, { account: { publicKey: SOURCE, sequence: '100' } }).notices).toEqual([]);
  });

  it('lists extra signers and ledger bounds', () => {
    const tx = build(payment, { extraSigners: [OTHER], ledgerbounds: { minLedger: 5, maxLedger: 10 } });
    const view = describeTransaction(tx);
    expect(view.validity).toContainEqual({ label: 'Also requires a signature from', value: OTHER, mono: true });
    expect(view.validity).toContainEqual({ label: 'Ledgers', value: '5 to 10' });
  });

  it('warns about transactions that never expire', () => {
    const tx = build(payment, { timebounds: { minTime: 0, maxTime: 0 } });
    expect(texts(describeTransaction(tx).notices)).toMatch(/never expires/);
  });

  it('shows the fee in XLM, split for contract calls, and warns when it is high', () => {
    const tx = build(
      (b) => b.addOperation(Operation.extendFootprintTtl({ extendTo: 100 })).setSorobanData(new SorobanDataBuilder().setResourceFee(2_000_000).build()),
      { fee: '150000000' },
    );
    const view = describeTransaction(tx);
    expect(view.fee).toEqual({ total: '15.2', inclusion: '15', resource: '0.2' });
    expect(texts(view.notices)).toMatch(/fee can be up to 15.2 XLM/);
  });

  it('reveals reordering characters in text memos and shows their bytes', () => {
    const tx = build(payment, { memo: Memo.text('\u202E54321') });
    const view = describeTransaction(tx);
    expect(view.memo?.text).toBe('⟨U+202E⟩54321');
    expect(view.memo?.hex).toBe('e280ae3534333231');
    expect(texts(view.notices)).toMatch(/memo contains invisible/);
  });

  it('shows invalid UTF-8 memo bytes instead of replacing them', () => {
    const tx = build(payment, { memo: new Memo('text', Buffer.from([0xff, 0xfe])) });
    const view = describeTransaction(tx);
    expect(view.memo).toEqual({ type: 'text', text: '', hex: 'fffe' });
  });
});
