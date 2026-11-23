/**
 * What crosses the air gap, as Uniform Resources:
 *
 * - `stellar-envelope`, out to the signing device: CBOR {1: network ID, 2: transaction envelope XDR}.
 *   The network ID (SHA-256 of the passphrase) is the prefix of what Stellar signs, so the
 *   payload names the network its signatures will be valid on.
 * - `stellar-signature-set`, back from it: CBOR {1: transaction hash, 2: [DecoratedSignature XDR]}.
 *   The hash also depends on the network. The online device adds each signature that verifies for
 *   a signer of the open transaction.
 *
 * Keystone's `stellar-sign-request` cannot serve here: it carries no envelope and needs the
 * device's key path. Unknown keys are refused rather than ignored; a new version is a new type.
 */
import { hash as sha256, Networks, xdr } from '@stellar/stellar-sdk';
import type { NetworkId } from '@/lib/xdr/parse';
import { decodeCbor, encodeCbor, type CborValue } from './cbor';
import type { URPayload } from './ur';

export const ENVELOPE_UR_TYPE = 'stellar-envelope';
export const SIGNATURE_SET_UR_TYPE = 'stellar-signature-set';

/** More signatures than any signer list allows (20 signers plus the master key). */
const MAX_SIGNATURES = 21;

export class AirgapPayloadError extends Error {}

const networkIds: Record<NetworkId, Uint8Array> = {
  mainnet: Uint8Array.from(sha256(Buffer.from(Networks.PUBLIC))),
  testnet: Uint8Array.from(sha256(Buffer.from(Networks.TESTNET))),
};

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

const asMap = (value: CborValue, keys: number[]): Map<number, CborValue> => {
  if (!(value instanceof Map) || value.size !== keys.length || !keys.every((k) => value.has(k))) {
    throw new AirgapPayloadError('The QR code does not have the fields Stratum expects.');
  }
  return value;
};

const asBytes = (value: CborValue | undefined, length?: number): Uint8Array => {
  if (!(value instanceof Uint8Array) || (length !== undefined && value.length !== length)) {
    throw new AirgapPayloadError('The QR code does not have the fields Stratum expects.');
  }
  return value;
};

const decode = (cbor: Uint8Array): CborValue => {
  try {
    return decodeCbor(cbor);
  } catch {
    throw new AirgapPayloadError('The QR code is damaged or in another format.');
  }
};

export const encodeEnvelope = (envelopeXdr: string, network: NetworkId): URPayload => ({
  type: ENVELOPE_UR_TYPE,
  cbor: encodeCbor(
    new Map<number, CborValue>([
      [1, networkIds[network]],
      [2, Uint8Array.from(Buffer.from(envelopeXdr, 'base64'))],
    ]),
  ),
});

/** The envelope as base64 XDR and its network. Throws AirgapPayloadError with the reason to show. */
export const decodeEnvelope = (cbor: Uint8Array): { xdr: string; network: NetworkId } => {
  const fields = asMap(decode(cbor), [1, 2]);
  const id = asBytes(fields.get(1), 32);
  const network = (Object.keys(networkIds) as NetworkId[]).find((n) => sameBytes(networkIds[n], id));
  if (!network) throw new AirgapPayloadError('This request is for a network Stratum does not support.');
  const envelope = asBytes(fields.get(2));
  try {
    xdr.TransactionEnvelope.fromXDR(Buffer.from(envelope));
  } catch {
    throw new AirgapPayloadError('The QR code does not hold a Stellar transaction.');
  }
  return { xdr: Buffer.from(envelope).toString('base64'), network };
};

export interface SignatureSet {
  /** Hash of the signed transaction: the outer one for a fee bump. */
  hash: Uint8Array;
  signatures: xdr.DecoratedSignature[];
}

export const encodeSignatureSet = ({ hash, signatures }: SignatureSet): URPayload => ({
  type: SIGNATURE_SET_UR_TYPE,
  cbor: encodeCbor(
    new Map<number, CborValue>([
      [1, Uint8Array.from(hash)],
      [2, signatures.map((sig) => Uint8Array.from(sig.toXDR()))],
    ]),
  ),
});

export const decodeSignatureSet = (cbor: Uint8Array): SignatureSet => {
  const fields = asMap(decode(cbor), [1, 2]);
  const hash = asBytes(fields.get(1), 32);
  const list = fields.get(2);
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SIGNATURES) {
    throw new AirgapPayloadError('The QR code does not have the fields Stratum expects.');
  }
  const signatures = list.map((item) => {
    const bytes = asBytes(item);
    try {
      const sig = xdr.DecoratedSignature.fromXDR(Buffer.from(bytes));
      // Reject padding or trailing bytes the XDR reader would let through.
      if (!sameBytes(Uint8Array.from(sig.toXDR()), bytes)) throw new Error('not canonical');
      return sig;
    } catch {
      throw new AirgapPayloadError('The QR code holds a signature Stratum cannot read.');
    }
  });
  return { hash, signatures };
};
