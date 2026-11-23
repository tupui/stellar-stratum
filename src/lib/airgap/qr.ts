/**
 * One static QR code when the data fits one that a phone reads off a screen, an animated one
 * otherwise. The limits were measured on testnet transactions (see docs/ARCHITECTURE.md).
 */
import QRCode from 'qrcode';
import { createFrameEncoder, encodeSinglePartUR, type URPayload } from './ur';

/** Largest static code: version 15 is 77 modules, about 3.3 px each at the 256 px the app shows. */
export const STATIC_MAX_VERSION = 15;
/** Bytes per animated frame: a version 12–13 code. */
export const FRAGMENT_BYTES = 200;
/** Four frames a second. */
export const FRAME_MS = 250;

/** QR version for this text at the app's error correction (M), or Infinity when none holds it. */
export const qrVersion = (text: string): number => {
  try {
    return QRCode.create(text, { errorCorrectionLevel: 'M' }).version;
  } catch {
    return Infinity;
  }
};

export type QrPlan = { kind: 'static'; text: string } | { kind: 'animated'; payload: URPayload; parts: number };

/**
 * Pick the QR to show for a payload. `preferred` is the text other wallets read (a SEP-7 URI)
 * and is used whenever it fits; then the single-part UR; then the animated UR.
 */
export const planQr = (payload: URPayload, preferred?: string): QrPlan => {
  for (const text of [preferred, encodeSinglePartUR(payload)]) {
    if (text && qrVersion(text) <= STATIC_MAX_VERSION) return { kind: 'static', text };
  }
  return { kind: 'animated', payload, parts: createFrameEncoder(payload, FRAGMENT_BYTES).parts };
};
