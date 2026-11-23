import { describe, expect, it } from 'vitest';
import { URAssembler, createFrameEncoder, decodeSinglePartUR, encodeSinglePartUR, isMultipartUR, type URPayload } from './ur';

const payload = (length: number, seed = 1): URPayload => ({
  type: 'stellar-envelope',
  // A plain Uint8Array, as stellar-sdk returns: bc-ur would mis-encode it without Buffer.from
  cbor: Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff),
});

const shuffle = <T,>(items: T[]) =>
  items
    .map((item, i) => ({ item, key: (i * 7919) % 101 }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);

describe('Uniform Resources', () => {
  it('round-trips a single-part UR, in upper case for the alphanumeric mode', () => {
    const p = payload(120);
    const text = encodeSinglePartUR(p);
    expect(text).toMatch(/^UR:STELLAR-ENVELOPE\/[A-Z]+$/);
    // Two bytewords letters per byte plus a few bytes of CBOR header and CRC-32
    expect(text.length).toBeLessThan('UR:STELLAR-ENVELOPE/'.length + 2 * 120 + 20);
    expect(decodeSinglePartUR(text)).toEqual(p);
    expect(decodeSinglePartUR(text.toLowerCase())).toEqual(p);
  });

  it('refuses a damaged single-part UR and a part of a multipart one', () => {
    const text = encodeSinglePartUR(payload(40));
    const damaged = text.slice(0, 30) + (text[30] === 'A' ? 'B' : 'A') + text.slice(31);
    expect(decodeSinglePartUR(damaged)).toBeNull();
    const part = createFrameEncoder(payload(800), 200).next();
    expect(isMultipartUR(part)).toBe(true);
    expect(decodeSinglePartUR(part)).toBeNull();
  });

  it('assembles frames read in any order, with repeats and gaps', () => {
    const p = payload(1724);
    const encoder = createFrameEncoder(p, 200);
    expect(encoder.parts).toBe(9);
    const frames = Array.from({ length: 40 }, () => encoder.next());
    const assembler = new URAssembler();
    let state;
    // Drop every third frame, read the rest out of order and twice
    for (const frame of shuffle(frames.filter((_, i) => i % 3 !== 0)).flatMap((f) => [f, f])) {
      state = assembler.receive(frame);
      if (state.status !== 'collecting') break;
      expect(state.type).toBe('stellar-envelope');
      expect(state.percent).toBeLessThan(100);
    }
    expect(state).toEqual({ status: 'complete', payload: p });
  });

  it('starts over when the frames of another message arrive', () => {
    const first = createFrameEncoder(payload(800, 1), 200);
    const second = payload(800, 2);
    const next = createFrameEncoder(second, 200);
    const assembler = new URAssembler();
    assembler.receive(first.next());
    assembler.receive(first.next());
    let state;
    for (let i = 0; i < 30; i++) {
      state = assembler.receive(next.next());
      if (state.status === 'complete') break;
    }
    expect(state).toEqual({ status: 'complete', payload: second });
  });

  it('says when a frame is not part of an animated QR', () => {
    expect(new URAssembler().receive('hello')).toMatchObject({ status: 'failed' });
  });
});
