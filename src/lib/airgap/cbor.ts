/**
 * The small part of CBOR (RFC 8949) the air-gap QR payloads use: unsigned integers, byte strings,
 * arrays and maps keyed by unsigned integers, all with definite lengths.
 *
 * Decoding is strict, since it reads what a camera saw: anything else (tags, text, negative or
 * floating-point numbers, indefinite lengths, duplicate keys, trailing bytes) is refused.
 */

export type CborValue = number | Uint8Array | CborValue[] | Map<number, CborValue>;

const UINT = 0;
const BYTES = 2;
const ARRAY = 4;
const MAP = 5;

const head = (major: number, n: number): number[] => {
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError(`CBOR length out of range: ${n}`);
  const m = major << 5;
  if (n < 24) return [m | n];
  if (n < 0x100) return [m | 24, n];
  if (n < 0x10000) return [m | 25, n >> 8, n & 0xff];
  return [m | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

const encodeInto = (value: CborValue, out: number[]) => {
  if (typeof value === 'number') {
    out.push(...head(UINT, value));
  } else if (value instanceof Uint8Array) {
    out.push(...head(BYTES, value.length));
    for (const byte of value) out.push(byte);
  } else if (Array.isArray(value)) {
    out.push(...head(ARRAY, value.length));
    value.forEach((item) => encodeInto(item, out));
  } else {
    // Canonical order: keys ascending, so equal maps encode to equal bytes.
    const keys = [...value.keys()].sort((a, b) => a - b);
    out.push(...head(MAP, keys.length));
    for (const key of keys) {
      out.push(...head(UINT, key));
      encodeInto(value.get(key)!, out);
    }
  }
};

export const encodeCbor = (value: CborValue): Uint8Array => {
  const out: number[] = [];
  encodeInto(value, out);
  return Uint8Array.from(out);
};

/** Nesting deeper than any payload of ours; bounds the recursion on hostile input. */
const MAX_DEPTH = 4;

export const decodeCbor = (bytes: Uint8Array): CborValue => {
  let at = 0;
  const need = (n: number) => {
    if (at + n > bytes.length) throw new Error('CBOR ends early');
  };
  const readHead = (): [number, number] => {
    need(1);
    const first = bytes[at++];
    const major = first >> 5;
    const info = first & 0x1f;
    if (info < 24) return [major, info];
    const size = { 24: 1, 25: 2, 26: 4 }[info];
    if (!size) throw new Error('CBOR length form not supported');
    need(size);
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + bytes[at++];
    if (n < (size === 1 ? 24 : size === 2 ? 0x100 : 0x10000)) throw new Error('CBOR length not in its shortest form');
    return [major, n];
  };
  const read = (depth: number): CborValue => {
    if (depth > MAX_DEPTH) throw new Error('CBOR nested too deeply');
    const [major, n] = readHead();
    switch (major) {
      case UINT:
        return n;
      case BYTES: {
        need(n);
        const value = bytes.slice(at, at + n);
        at += n;
        return value;
      }
      case ARRAY: {
        const items: CborValue[] = [];
        for (let i = 0; i < n; i++) items.push(read(depth + 1));
        return items;
      }
      case MAP: {
        const map = new Map<number, CborValue>();
        for (let i = 0; i < n; i++) {
          const key = read(depth + 1);
          if (typeof key !== 'number') throw new Error('CBOR map key is not an unsigned integer');
          if (map.has(key)) throw new Error('CBOR map key repeated');
          map.set(key, read(depth + 1));
        }
        return map;
      }
      default:
        throw new Error('CBOR type not supported');
    }
  };
  const value = read(0);
  if (at !== bytes.length) throw new Error('CBOR has trailing bytes');
  return value;
};
