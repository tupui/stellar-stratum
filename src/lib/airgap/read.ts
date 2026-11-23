/** Read the air-gap payloads from scanned or pasted text. */
import type { NetworkId } from '@/lib/xdr/parse';
import type { Refusal } from '@/lib/sep7';
import { AirgapPayloadError, decodeEnvelope, decodeSignatureSet, ENVELOPE_UR_TYPE, SIGNATURE_SET_UR_TYPE, type SignatureSet } from './payloads';
import { decodeSinglePartUR, isMultipartUR } from './ur';

export type AirgapRead = { kind: 'transaction'; xdr: string; network: NetworkId } | ({ kind: 'signatures' } & SignatureSet);

/**
 * A UR (`ur:type/…`) as one of our payloads. Null when the text is not a UR at all, a refusal
 * with the reason to show when it is one Stratum does not read.
 */
export const readUR = (text: string): AirgapRead | Refusal | null => {
  const trimmed = text.trim();
  if (!/^ur:/i.test(trimmed)) return null;
  if (isMultipartUR(trimmed)) return { refused: 'This is one part of an animated QR code. Scan the whole code with the camera.' };
  const ur = decodeSinglePartUR(trimmed);
  if (!ur) return { refused: 'The QR code is damaged or incomplete. Scan it again.' };
  try {
    if (ur.type === ENVELOPE_UR_TYPE) return { kind: 'transaction', ...decodeEnvelope(ur.cbor) };
    if (ur.type === SIGNATURE_SET_UR_TYPE) return { kind: 'signatures', ...decodeSignatureSet(ur.cbor) };
  } catch (error) {
    if (error instanceof AirgapPayloadError) return { refused: error.message };
    throw error;
  }
  return { refused: `This QR code holds a ${ur.type} record, which Stratum does not read.` };
};
