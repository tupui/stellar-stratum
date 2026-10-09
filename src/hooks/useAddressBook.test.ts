import { describe, expect, it } from 'vitest';
import { Account, Address, Keypair, MuxedAccount, StrKey, nativeToScVal } from '@stellar/stellar-sdk';
import { paidRecipient, type PaymentLike } from './useAddressBook';

const ME = Keypair.random().publicKey();
const FRIEND = Keypair.random().publicKey();
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 7));
const record = (fields: Partial<PaymentLike>): PaymentLike => ({ paging_token: '1', created_at: '2026-01-01T00:00:00Z', type: 'payment', ...fields });
const call = (fn: string, changes: PaymentLike['asset_balance_changes']) =>
  record({
    type: 'invoke_host_function',
    source_account: ME,
    parameters: [new Address(VAULT).toScVal(), nativeToScVal(fn, { type: 'symbol' })].map((v) => ({ value: v.toXDR('base64'), type: 'x' })),
    asset_balance_changes: changes,
  });

describe('paidRecipient', () => {
  it('lists a muxed recipient by the M… address that was paid', () => {
    const muxed = new MuxedAccount(new Account(FRIEND, '0'), '42').accountId();
    expect(paidRecipient(record({ from: ME, to: FRIEND, to_muxed: muxed, asset_type: 'native', amount: '5' }), ME)).toEqual({ address: muxed, amount: 5 });
    expect(paidRecipient(record({ from: ME, to: FRIEND, asset_type: 'credit_alphanum4', amount: '5' }), ME)).toEqual({ address: FRIEND, amount: 0 });
  });

  it('lists a contract paid with a transfer, but not what other calls move', () => {
    const transfer = { type: 'transfer', from: ME, to: VAULT, asset_type: 'native', amount: '3.0000000' };
    expect(paidRecipient(call('transfer', [transfer]), ME)).toEqual({ address: VAULT, amount: 3 });
    expect(paidRecipient(call('deposit', [transfer]), ME)).toBeNull();
    expect(paidRecipient(call('transfer', [{ ...transfer, from: VAULT, to: ME }]), ME)).toBeNull();
    expect(paidRecipient({ ...call('transfer', [transfer]), source_account: FRIEND }, ME)).toBeNull();
  });

  it('ignores incoming payments', () => {
    expect(paidRecipient(record({ from: FRIEND, to: ME, asset_type: 'native', amount: '1' }), ME)).toBeNull();
  });
});
