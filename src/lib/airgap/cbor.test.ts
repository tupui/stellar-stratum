import { describe, expect, it } from 'vitest';
import { decodeCbor, encodeCbor, type CborValue } from './cbor';

const hex = (s: string) => Uint8Array.from(Buffer.from(s.replace(/\s/g, ''), 'hex'));

describe('CBOR', () => {
  it('encodes in the shortest form, maps with keys ascending (RFC 8949 vectors)', () => {
    expect(encodeCbor(23)).toEqual(hex('17'));
    expect(encodeCbor(24)).toEqual(hex('1818'));
    expect(encodeCbor(1000)).toEqual(hex('1903e8'));
    expect(encodeCbor(1000000)).toEqual(hex('1a000f4240'));
    expect(encodeCbor(hex('01020304'))).toEqual(hex('4401020304'));
    expect(encodeCbor([1, [2, 3]])).toEqual(hex('8201820203'));
    expect(encodeCbor(new Map<number, CborValue>([[2, 3], [1, 2]]))).toEqual(hex('a201020203'));
  });

  it('round-trips nested values', () => {
    const value = new Map<number, CborValue>([
      [1, new Uint8Array(300).fill(7)],
      [2, [hex('aa'), hex('bbcc')]],
    ]);
    expect(decodeCbor(encodeCbor(value))).toEqual(value);
  });

  it.each([
    ['a tag', 'c11a514b67b0'],
    ['a text string', '6161'],
    ['a negative number', '20'],
    ['a float', 'f93c00'],
    ['an indefinite length', '5f4101ff'],
    ['a length not in its shortest form', '1817'],
    ['a text map key', 'a1616101'],
    ['a repeated map key', 'a201010102'],
    ['trailing bytes', '0101'],
    ['a byte string longer than the data', '4501'],
    ['an 8-byte length', '1b0000000000000001'],
    ['nesting too deep', '818181818181818101'],
  ])('refuses %s', (_, bytes) => {
    expect(() => decodeCbor(hex(bytes))).toThrow();
  });
});
