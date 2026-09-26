import { describe, expect, it } from 'vitest';
import { Account, Keypair, Networks, Operation, StrKey, TransactionBuilder, hash, type xdr } from '@stellar/stellar-sdk';
import { interpretTransaction } from './interpret';
import { passphraseFor, tryParseTransaction } from './parse';

const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();

/** Operations as the signing screen gets them: decoded from the XDR. */
const decoded = (ops: xdr.Operation[]) => {
  const builder = new TransactionBuilder(new Account(A, '1'), { fee: '100', networkPassphrase: Networks.TESTNET });
  ops.forEach((op) => builder.addOperation(op));
  return TransactionBuilder.fromXDR(builder.setTimeout(0).build().toXDR(), Networks.TESTNET).operations;
};

describe('interpretTransaction', () => {
  const account = { publicKey: A, signers: [{ key: A, weight: 1 }, { key: B, weight: 1 }], thresholds: { low: 1, med: 1, high: 1 } };

  it('shows hash(x) and pre-auth signers as the strkeys Horizon lists', () => {
    const secret = hash(Buffer.from('x'));
    const result = interpretTransaction(
      decoded([
        Operation.setOptions({ signer: { sha256Hash: secret, weight: 10 } }),
        Operation.setOptions({ signer: { preAuthTx: secret, weight: 1 } }),
      ]),
      { sourceAccount: A, account },
    );
    const keys = result!.multisig!.signerChanges.map((c) => c.key);
    expect(keys).toContain(StrKey.encodeSha256Hash(secret));
    expect(keys).toContain(StrKey.encodePreAuthTx(secret));
  });

  it('reports a master key change even without the account state (air-gapped)', () => {
    const result = interpretTransaction(decoded([Operation.setOptions({ masterWeight: 0 })]), { sourceAccount: A, account: null });
    expect(result!.multisig!.signerChanges).toEqual([expect.objectContaining({ key: A, kind: 'removed', isMasterKey: true })]);
  });

  it('never claims a threshold of 0 needs no signature', () => {
    const result = interpretTransaction(
      decoded([Operation.setOptions({ lowThreshold: 0, medThreshold: 0, highThreshold: 0 })]),
      { sourceAccount: A, account: { ...account, thresholds: { low: 1, med: 1, high: 2 } } },
    );
    expect(result!.multisig!.requirements.every((r) => r.minSigners === 1)).toBe(true);
  });
});

describe('tryParseTransaction', () => {
  it('hashes for the network it is given', () => {
    const tx = new TransactionBuilder(new Account(A, '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
      .setTimeout(0)
      .build();
    const onTestnet = tryParseTransaction(tx.toXDR(), 'testnet')!;
    const onMainnet = tryParseTransaction(tx.toXDR(), 'mainnet')!;
    expect(Buffer.from(onTestnet.tx.hash())).toEqual(Buffer.from(tx.hash()));
    expect(Buffer.from(onMainnet.tx.hash())).not.toEqual(Buffer.from(tx.hash()));
    expect(passphraseFor('mainnet')).toBe(Networks.PUBLIC);
    expect(tryParseTransaction('not xdr', 'testnet')).toBeNull();
  });
});
