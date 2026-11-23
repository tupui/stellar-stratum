import { describe, expect, it } from 'vitest';
import { Account, Asset, hash, Keypair, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { buildSEP7TxUri, parseTransactionPayload } from '@/lib/sep7';
import { encodeCbor, type CborValue } from './cbor';
import { decodeEnvelope, decodeSignatureSet, encodeEnvelope, encodeSignatureSet } from './payloads';
import { readUR } from './read';
import { planQr, qrVersion, STATIC_MAX_VERSION } from './qr';
import { createFrameEncoder, encodeSinglePartUR, URAssembler } from './ur';

const A = Keypair.random();
const B = Keypair.random();

const payments = (count: number, signers: Keypair[] = []) => {
  const builder = new TransactionBuilder(new Account(A.publicKey(), '1'), { fee: String(100 * count), networkPassphrase: Networks.TESTNET });
  for (let i = 0; i < count; i++) builder.addOperation(Operation.payment({ destination: B.publicKey(), asset: Asset.native(), amount: '1' }));
  const tx = builder.addMemo(Memo.text('invoice 42')).setTimeout(0).build();
  signers.forEach((kp) => tx.sign(kp));
  return tx;
};

describe('stellar-envelope', () => {
  it('carries the envelope and its network', () => {
    const tx = payments(2, [A]);
    for (const network of ['testnet', 'mainnet'] as const) {
      expect(decodeEnvelope(encodeEnvelope(tx.toXDR(), network).cbor)).toEqual({ xdr: tx.toXDR(), network });
    }
  });

  it('refuses another network, missing or extra fields, and bytes that are not a transaction', () => {
    const envelope = Uint8Array.from(Buffer.from(payments(1).toXDR(), 'base64'));
    const otherNetwork = new Uint8Array(32).fill(1);
    const cbor = (entries: [number, CborValue][]) => encodeCbor(new Map(entries));
    expect(() => decodeEnvelope(cbor([[1, otherNetwork], [2, envelope]]))).toThrow('network Stratum does not support');
    expect(() => decodeEnvelope(cbor([[2, envelope]]))).toThrow('fields');
    const testnetId = Uint8Array.from(hash(Buffer.from(Networks.TESTNET)));
    expect(() => decodeEnvelope(cbor([[1, testnetId], [2, envelope], [3, 0]]))).toThrow('fields');
    expect(() => decodeEnvelope(cbor([[1, testnetId.slice(0, 31)], [2, envelope]]))).toThrow('fields');
    expect(() => decodeEnvelope(encodeEnvelope(Buffer.from('not a transaction').toString('base64'), 'testnet').cbor)).toThrow('Stellar transaction');
  });

  it('is read from a single-part UR by the transaction parser, which the scanner makes of an animated QR', () => {
    const tx = payments(10, [A, B]);
    const payload = encodeEnvelope(tx.toXDR(), 'testnet');
    const encoder = createFrameEncoder(payload, 200);
    const assembler = new URAssembler();
    let state = assembler.receive(encoder.next());
    while (state.status === 'collecting') state = assembler.receive(encoder.next());
    expect(state.status).toBe('complete');
    if (state.status !== 'complete') return;
    expect(parseTransactionPayload(encodeSinglePartUR(state.payload))).toEqual({ xdr: tx.toXDR(), network: 'testnet' });
  });
});

describe('stellar-signature-set', () => {
  const tx = payments(1);
  tx.sign(A);
  const set = { hash: Uint8Array.from(tx.hash()), signatures: tx.signatures };

  it('round-trips the hash and the signatures', () => {
    const decoded = decodeSignatureSet(encodeSignatureSet(set).cbor);
    expect(Buffer.from(decoded.hash).toString('hex')).toBe(Buffer.from(tx.hash()).toString('hex'));
    expect(decoded.signatures.map((s) => s.toXDR('base64'))).toEqual(tx.signatures.map((s) => s.toXDR('base64')));
  });

  it('fits a small static QR', () => {
    expect(qrVersion(encodeSinglePartUR(encodeSignatureSet(set)))).toBeLessThanOrEqual(10);
  });

  it('refuses a short hash, no signatures and a signature that is not XDR', () => {
    const cbor = (entries: [number, CborValue][]) => encodeCbor(new Map(entries));
    const sig = Uint8Array.from(tx.signatures[0].toXDR());
    expect(() => decodeSignatureSet(cbor([[1, set.hash.slice(1)], [2, [sig]]]))).toThrow();
    expect(() => decodeSignatureSet(cbor([[1, set.hash], [2, []]]))).toThrow();
    expect(() => decodeSignatureSet(cbor([[1, set.hash], [2, [sig.slice(0, 10)]]]))).toThrow();
    expect(() => decodeSignatureSet(cbor([[1, set.hash], [2, [Uint8Array.from([...sig, 0, 0, 0, 0])]]]))).toThrow();
  });

  it('is read as signatures, and refused where a transaction is expected', () => {
    const text = encodeSinglePartUR(encodeSignatureSet(set));
    expect(readUR(text)).toMatchObject({ kind: 'signatures' });
    expect(parseTransactionPayload(text)).toHaveProperty('refused', expect.stringMatching(/signatures, not a transaction/));
  });
});

describe('reading URs', () => {
  it('names a UR type Stratum does not read, and refuses a single frame or a damaged code', () => {
    expect(readUR(encodeSinglePartUR({ type: 'crypto-psbt', cbor: encodeCbor(new Uint8Array(4)) }))).toEqual({
      refused: 'This QR code holds a crypto-psbt record, which Stratum does not read.',
    });
    const frame = createFrameEncoder(encodeEnvelope(payments(10).toXDR(), 'testnet'), 200).next();
    expect(readUR(frame)).toHaveProperty('refused', expect.stringMatching(/one part of an animated QR/));
    expect(readUR('ur:stellar-envelope/aeadaolazmjendeoti')).toHaveProperty('refused', expect.stringMatching(/damaged/));
    expect(readUR('web+stellar:tx?xdr=AAAA')).toBeNull();
  });
});

describe('static or animated', () => {
  it('keeps the SEP-7 URI other wallets read when it fits one code', () => {
    const tx = payments(1, [A]);
    const uri = buildSEP7TxUri(tx.toXDR(), 'testnet');
    expect(qrVersion(uri)).toBeLessThanOrEqual(STATIC_MAX_VERSION);
    expect(planQr(encodeEnvelope(tx.toXDR(), 'testnet'), uri)).toEqual({ kind: 'static', text: uri });
  });

  it('animates what would need a denser code, in frames of version 13 at most', () => {
    const tx = payments(10, [A, B]);
    const payload = encodeEnvelope(tx.toXDR(), 'testnet');
    const plan = planQr(payload, buildSEP7TxUri(tx.toXDR(), 'testnet'));
    expect(plan).toMatchObject({ kind: 'animated', parts: 5 });
    const encoder = createFrameEncoder(payload, 200);
    for (let i = 0; i < encoder.parts + 3; i++) expect(qrVersion(encoder.next())).toBeLessThanOrEqual(13);
  });
});
