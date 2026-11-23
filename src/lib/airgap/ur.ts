/**
 * Uniform Resources (BCR-2020-005) and their multipart, fountain-coded form (BCR-2024-001), the
 * animated QR format of Keystone, xBull and other air-gapped signers.
 *
 * This module is the only one that touches @ngraveio/bc-ur. The library works on Node Buffers:
 * handed a plain Uint8Array (what stellar-sdk returns), it silently encodes the wrong CBOR, so
 * every byte array crosses this boundary through Buffer.from.
 */
import { UR, UREncoder, URDecoder } from '@ngraveio/bc-ur';

export interface URPayload {
  /** Lower-case UR type, such as `stellar-envelope`. */
  type: string;
  /** The CBOR the UR carries. */
  cbor: Uint8Array;
}

const toUR = ({ type, cbor }: URPayload) => new UR(Buffer.from(cbor), type);

/**
 * A single-part UR (`UR:TYPE/BYTEWORDS`), upper case: QR codes store it in alphanumeric mode,
 * which packs it denser than mixed case.
 */
export const encodeSinglePartUR = (payload: URPayload): string => UREncoder.encodeSinglePart(toUR(payload)).toUpperCase();

/** One part of a multipart UR: `ur:type/seqNum-seqLen/…`, in either case. */
export const isMultipartUR = (text: string): boolean => /^ur:[a-z0-9-]+\/\d+-\d+\//i.test(text.trim());

/** Read a single-part UR. Null for anything else, including a part of a multipart UR. */
export const decodeSinglePartUR = (text: string): URPayload | null => {
  const trimmed = text.trim();
  if (!/^ur:[a-z0-9-]+\/[a-z]+$/i.test(trimmed)) return null;
  try {
    const ur = URDecoder.decode(trimmed.toLowerCase());
    return { type: ur.type, cbor: Uint8Array.from(ur.cbor) };
  } catch {
    return null; // Bad bytewords or checksum
  }
};

export interface FrameEncoder {
  /** Fragments the message is cut into; a decoder needs about this many parts. */
  parts: number;
  /** The next frame, upper case. The first `parts` frames are the fragments, then fountain mixes. */
  next: () => string;
}

export const createFrameEncoder = (payload: URPayload, maxFragmentLength: number): FrameEncoder => {
  const encoder = new UREncoder(toUR(payload), maxFragmentLength, 0, 10);
  return { parts: encoder.fragmentsLength, next: () => encoder.nextPart().toUpperCase() };
};

export type AssemblyState =
  | { status: 'collecting'; type: string; percent: number }
  | { status: 'complete'; payload: URPayload }
  | { status: 'failed'; reason: string };

/**
 * Collect the parts of an animated QR, in any order, with repeats. A part of another message
 * (the sender switched to another transaction) starts over with that message.
 */
// The library throws on text that is not a UR part, and returns false for a part of another message.
const accepts = (decoder: URDecoder, text: string) => {
  try {
    return decoder.receivePart(text);
  } catch {
    return false;
  }
};

export class URAssembler {
  private decoder = new URDecoder();

  receive(part: string): AssemblyState {
    const text = part.trim().toLowerCase();
    if (!accepts(this.decoder, text)) {
      const fresh = new URDecoder();
      if (!isMultipartUR(text) || !accepts(fresh, text)) return { status: 'failed', reason: 'This is not part of an animated QR code.' };
      this.decoder = fresh;
    }
    if (this.decoder.isComplete()) {
      if (!this.decoder.isSuccess()) {
        this.decoder = new URDecoder();
        return { status: 'failed', reason: 'The animated QR code did not decode. Scan it again.' };
      }
      const ur = this.decoder.resultUR();
      this.decoder = new URDecoder();
      return { status: 'complete', payload: { type: ur.type, cbor: Uint8Array.from(ur.cbor) } };
    }
    return {
      status: 'collecting',
      type: text.slice(3, text.indexOf('/')),
      percent: Math.min(99, Math.floor(this.decoder.estimatedPercentComplete() * 100)),
    };
  }
}
