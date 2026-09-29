import { describe, expect, it } from 'vitest';
import { Account, Keypair, Networks, StrKey, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import { planConfigChange, sameConfig, validateConfig, type MultisigConfig } from './multisig';

const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();
const C = Keypair.random().publicKey();
const thresholds = (low: number, med: number, high: number) => ({ low_threshold: low, med_threshold: med, high_threshold: high });

/** Decode the planned operations the way a signer would see them. */
const decode = (current: MultisigConfig, next: MultisigConfig) => {
  const builder = new TransactionBuilder(new Account(A, '1'), { fee: '100', networkPassphrase: Networks.TESTNET });
  planConfigChange(A, current, next).forEach((op) => builder.addOperation(op));
  return builder.setTimeout(0).build().operations as unknown as Array<Record<string, unknown>>;
};

describe('planConfigChange', () => {
  const current = { signers: [{ key: A, weight: 1 }, { key: B, weight: 1 }], thresholds: thresholds(1, 2, 2) };

  it('changes the master key through masterWeight, never as a signer', () => {
    const ops = decode(current, { signers: [{ key: A, weight: 0 }, { key: B, weight: 1 }, { key: C, weight: 1 }], thresholds: current.thresholds });
    expect(ops).toHaveLength(2);
    expect(ops[0].signer).toMatchObject({ ed25519PublicKey: C, weight: 1 });
    expect(ops[1].masterWeight).toBe(0);
    expect(ops.some((op) => (op.signer as { ed25519PublicKey?: string } | undefined)?.ed25519PublicKey === A)).toBe(false);
  });

  it('removes a signer with weight 0 and sets thresholds together', () => {
    const ops = decode(current, { signers: [{ key: A, weight: 1 }], thresholds: thresholds(1, 1, 1) });
    expect(ops[0].signer).toMatchObject({ ed25519PublicKey: B, weight: 0 });
    expect(ops[1]).toMatchObject({ lowThreshold: 1, medThreshold: 1, highThreshold: 1 });
  });

  it('keeps hash-based signers by type', () => {
    const hashX = StrKey.encodeSha256Hash(hash(Buffer.from('x')));
    const ops = decode(current, { signers: [...current.signers, { key: hashX, weight: 2 }], thresholds: current.thresholds });
    expect(StrKey.encodeSha256Hash(Buffer.from((ops[0].signer as { sha256Hash: Uint8Array }).sha256Hash))).toBe(hashX);
  });

  it('plans nothing when nothing changes', () => {
    expect(planConfigChange(A, current, current)).toHaveLength(0);
    expect(sameConfig(current, { signers: [...current.signers].reverse(), thresholds: current.thresholds })).toBe(true);
  });
});

describe('validateConfig', () => {
  it('refuses configurations that lock the account', () => {
    expect(validateConfig(A, { signers: [{ key: A, weight: 0 }, { key: B, weight: 1 }], thresholds: thresholds(1, 2, 3) }).errors.length).toBeGreaterThan(0);
    expect(validateConfig(A, { signers: [{ key: A, weight: 0 }], thresholds: thresholds(0, 0, 0) }).errors.length).toBeGreaterThan(0);
  });

  it('does not count pre-auth or hash(x) weight as a key that can sign', () => {
    const preAuth = StrKey.encodePreAuthTx(hash(Buffer.from('recovery')));
    const { errors, warnings } = validateConfig(A, {
      signers: [{ key: A, weight: 0 }, { key: preAuth, weight: 10 }],
      thresholds: thresholds(1, 1, 1),
    });
    expect(errors.some((e) => e.includes('At least one key'))).toBe(true);
    expect(warnings.some((w) => w.includes('pre-authorised transaction'))).toBe(true);
  });

  it('accepts a 2-of-3 without the master key, with a warning', () => {
    const { errors, warnings } = validateConfig(A, {
      signers: [{ key: A, weight: 0 }, { key: B, weight: 1 }, { key: C, weight: 1 }],
      thresholds: thresholds(2, 2, 2),
    });
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('own key'))).toBe(true);
  });

  it('rejects invalid keys, weights and duplicates', () => {
    expect(validateConfig(A, { signers: [{ key: 'GABC', weight: 1 }], thresholds: thresholds(0, 0, 0) }).errors.length).toBeGreaterThan(0);
    expect(validateConfig(A, { signers: [{ key: A, weight: 300 }], thresholds: thresholds(0, 0, 0) }).errors.length).toBeGreaterThan(0);
    expect(validateConfig(A, { signers: [{ key: B, weight: 1 }, { key: B, weight: 1 }], thresholds: thresholds(0, 0, 0) }).errors.length).toBeGreaterThan(0);
  });
});
