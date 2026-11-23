import { describe, expect, it } from 'vitest';
import { operationLabel, signerTypeLabel } from './labels';

describe('operationLabel', () => {
  it('reads Horizon and SDK names as words', () => {
    expect(operationLabel('set_options')).toBe('Set options');
    expect(operationLabel('change_trust')).toBe('Change trust');
    expect(operationLabel('payment')).toBe('Payment');
    expect(operationLabel('pathPaymentStrictSend')).toBe('Path payment strict send');
    expect(operationLabel('invokeHostFunction')).toBe('Invoke host function');
  });

  it('keeps an empty name as it is', () => {
    expect(operationLabel('')).toBe('');
  });
});

describe('signerTypeLabel', () => {
  it('names each kind of signer', () => {
    expect(signerTypeLabel('ed25519_public_key')).toBe('Ed25519 key');
    expect(signerTypeLabel('sha256_hash')).toBe('Hash(x)');
    expect(signerTypeLabel('preauth_tx')).toBe('Pre-authorized transaction');
    expect(signerTypeLabel('ed25519_signed_payload')).toBe('Signed payload');
    expect(signerTypeLabel('something_new')).toBe('Something new');
  });
});
