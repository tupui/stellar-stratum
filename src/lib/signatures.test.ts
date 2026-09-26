import { describe, expect, it } from 'vitest';
import { Account, Asset, Keypair, MuxedAccount, Networks, Operation, StrKey, TransactionBuilder, hash, type xdr } from '@stellar/stellar-sdk';
import { computeSignatureStatus, involvedAccounts, operationThresholdLevel, type AccountAuth } from './signatures';

const A = Keypair.random();
const B = Keypair.random();
const C = Keypair.random();
const D = Keypair.random();

const account = (kp: Keypair, signers: Array<[string, number]>, [low, med, high]: [number, number, number]): AccountAuth => ({
  publicKey: kp.publicKey(),
  signers: signers.map(([key, weight]) => ({ key, weight })),
  thresholds: { low_threshold: low, med_threshold: med, high_threshold: high },
});

// A is a 2-of-2 with B (payments need 2); D is a plain account.
const accounts = new Map([
  [A.publicKey(), account(A, [[A.publicKey(), 1], [B.publicKey(), 1]], [1, 2, 2])],
  [D.publicKey(), account(D, [[D.publicKey(), 1]], [0, 0, 0])],
]);

const build = (ops: xdr.Operation[], network = Networks.TESTNET) => {
  const builder = new TransactionBuilder(new Account(A.publicKey(), '1'), { fee: '100', networkPassphrase: network });
  ops.forEach((op) => builder.addOperation(op));
  return builder.setTimeout(0).build();
};
const pay = (source?: string) =>
  Operation.payment({ source, destination: C.publicKey(), asset: Asset.native(), amount: '1' });
const reparse = (tx: { toXDR: () => string }) => TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);

describe('operationThresholdLevel', () => {
  it('follows stellar-core', () => {
    const levelOf = (op: xdr.Operation) => operationThresholdLevel(build([op]).operations[0] as never);
    expect(levelOf(Operation.setOptions({ signer: { ed25519PublicKey: C.publicKey(), weight: 1 } }))).toBe('high');
    expect(levelOf(Operation.setOptions({ masterWeight: 0 }))).toBe('high');
    expect(levelOf(Operation.setOptions({ homeDomain: 'example.org' }))).toBe('med');
    expect(levelOf(Operation.accountMerge({ destination: C.publicKey() }))).toBe('high');
    expect(levelOf(Operation.bumpSequence({ bumpTo: '5' }))).toBe('low');
    expect(levelOf(pay())).toBe('med');
  });
});

describe('computeSignatureStatus', () => {
  it('counts only signatures that verify, per threshold', () => {
    const tx = build([pay()]);
    expect(computeSignatureStatus(tx, accounts)).toMatchObject({ ready: false, requirements: [{ level: 'med', threshold: 2, weight: 0 }] });
    tx.sign(A);
    expect(computeSignatureStatus(reparse(tx), accounts).requirements[0].weight).toBe(1);
    tx.sign(B);
    expect(computeSignatureStatus(reparse(tx), accounts)).toMatchObject({ ready: true });
  });

  it('does not count a signature made for another network', () => {
    const tx = build([pay()]);
    tx.sign(A);
    tx.sign(B);
    const onMainnet = TransactionBuilder.fromXDR(tx.toXDR(), Networks.PUBLIC);
    expect(computeSignatureStatus(onMainnet, accounts).requirements[0].weight).toBe(0);
  });

  it('requires the signers of an operation source account', () => {
    const tx = build([pay(D.publicKey())]);
    expect(involvedAccounts(tx)).toEqual([A.publicKey(), D.publicKey()]);
    tx.sign(A);
    tx.sign(B);
    expect(computeSignatureStatus(tx, accounts).ready).toBe(false);
    tx.sign(D); // thresholds of 0 still need one signature
    expect(computeSignatureStatus(tx, accounts).ready).toBe(true);
  });

  it('treats a muxed source as its base account', () => {
    const muxed = new MuxedAccount(new Account(D.publicKey(), '0'), '7').accountId();
    expect(involvedAccounts(build([pay(muxed)]))).toContain(D.publicKey());
  });

  it('is never ready while an account is unknown', () => {
    const status = computeSignatureStatus(build([pay(C.publicKey())]), accounts);
    expect(status.ready).toBe(false);
    expect(status.requirements.some((r) => !r.known)).toBe(true);
  });

  it('supports hash(x) and pre-authorised transaction signers', () => {
    const preimage = Buffer.from('secret');
    const hashX = StrKey.encodeSha256Hash(hash(preimage));
    const withHashX = new Map([[A.publicKey(), account(A, [[A.publicKey(), 0], [hashX, 1]], [1, 1, 1])]]);
    const tx = build([pay()]);
    tx.signHashX(preimage);
    expect(computeSignatureStatus(tx, withHashX).ready).toBe(true);

    const unsigned = build([pay()]);
    const preAuth = StrKey.encodePreAuthTx(unsigned.hash());
    expect(computeSignatureStatus(unsigned, new Map([[A.publicKey(), account(A, [[preAuth, 1]], [1, 1, 1])]])).ready).toBe(true);
  });

  it('needs the fee source signature on a fee bump', () => {
    const inner = build([pay()]);
    inner.sign(A);
    inner.sign(B);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(D, '200', inner, Networks.TESTNET);
    expect(computeSignatureStatus(feeBump, accounts).ready).toBe(false);
    feeBump.sign(D);
    expect(computeSignatureStatus(feeBump, accounts).ready).toBe(true);
  });
});
