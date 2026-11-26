import { describe, expect, it } from 'vitest';
import { xdr } from '@stellar/stellar-sdk';
import { describeResultCodes, feeChargedOf, readResultCodes, SubmitError } from './stellar';

describe('feeChargedOf', () => {
  it('reads fee_charged from the response', () => {
    expect(feeChargedOf({ fee_charged: '100' })).toBe(100n);
  });

  it('decodes it from result_xdr when the response has none', () => {
    const result = new xdr.TransactionResult({
      feeCharged: xdr.Int64.fromString('300'),
      result: xdr.TransactionResultResult.txSuccess([]),
      ext: xdr.TransactionResultExt.v0(),
    });
    expect(feeChargedOf({ result_xdr: result.toXDR('base64') })).toBe(300n);
  });

  it('is null when neither is readable', () => {
    expect(feeChargedOf({})).toBeNull();
    expect(feeChargedOf({ result_xdr: 'not xdr' })).toBeNull();
  });
});

describe('result codes', () => {
  it('keeps the codes that say something and their reasons', () => {
    const read = readResultCodes({ transaction: 'tx_failed', operations: ['op_success', 'op_underfunded'] });
    expect(read.codes).toEqual(['tx_failed', 'op_underfunded']);
    expect(read.hints).toHaveLength(1);
    expect(describeResultCodes({ transaction: 'tx_bad_seq' })).toMatch(/^tx_bad_seq: the sequence number was already used/);
  });
});

describe('SubmitError', () => {
  it('carries its kind and details', () => {
    const error = new SubmitError('not-in-ledger', 'late', { waitedMs: 60_000 });
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe('not-in-ledger');
    expect(error.waitedMs).toBe(60_000);
    expect(error.message).toBe('late');
  });
});
