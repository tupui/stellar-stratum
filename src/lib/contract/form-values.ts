import { xdr, StrKey } from '@stellar/stellar-sdk';

/**
 * Classification of a Soroban parameter for form rendering.
 * Anything the UI does not know how to render specifically falls back to `json`.
 */
export type InputKind =
  | 'address'
  | 'bool'
  | 'string'
  | 'symbol'
  | 'u32'
  | 'i32'
  | 'u64'
  | 'i64'
  | 'u128'
  | 'i128'
  | 'u256'
  | 'i256'
  | 'bytes'
  | 'bytesN'
  | 'void'
  | 'option'
  | 'json'; // Vec, Map, Tuple, Udt, Result, Val, Timepoint, Duration, MuxedAddress, Error

export interface ParamShape {
  name: string;
  /** The raw XDR type — retained for `funcArgsToScVals`. */
  type: xdr.ScSpecTypeDef;
  kind: InputKind;
  /** For `option`, the inner shape. For `bytesN`, undefined; length lives on `bytesLen`. */
  inner?: ParamShape;
  /** For `bytesN`, the required byte length. */
  bytesLen?: number;
  /** Human-readable label used for placeholders and JSON hints. */
  typeLabel: string;
}

const kindFromType = (type: xdr.ScSpecTypeDef): InputKind => {
  const name = type.switch().name;
  switch (name) {
    case 'scSpecTypeAddress':
    case 'scSpecTypeMuxedAddress':
      return name === 'scSpecTypeMuxedAddress' ? 'json' : 'address';
    case 'scSpecTypeBool':
      return 'bool';
    case 'scSpecTypeString':
      return 'string';
    case 'scSpecTypeSymbol':
      return 'symbol';
    case 'scSpecTypeU32':
      return 'u32';
    case 'scSpecTypeI32':
      return 'i32';
    case 'scSpecTypeU64':
      return 'u64';
    case 'scSpecTypeI64':
      return 'i64';
    case 'scSpecTypeU128':
      return 'u128';
    case 'scSpecTypeI128':
      return 'i128';
    case 'scSpecTypeU256':
      return 'u256';
    case 'scSpecTypeI256':
      return 'i256';
    case 'scSpecTypeBytes':
      return 'bytes';
    case 'scSpecTypeBytesN':
      return 'bytesN';
    case 'scSpecTypeVoid':
      return 'void';
    case 'scSpecTypeOption':
      return 'option';
    default:
      // Vec, Map, Tuple, Udt, Result, Val, Timepoint, Duration, Error, …
      return 'json';
  }
};

export const describeType = (type: xdr.ScSpecTypeDef): string => {
  const name = type.switch().name;
  switch (name) {
    case 'scSpecTypeVec':
      return `Vec<${describeType(type.vec().elementType())}>`;
    case 'scSpecTypeMap': {
      const m = type.map();
      return `Map<${describeType(m.keyType())}, ${describeType(m.valueType())}>`;
    }
    case 'scSpecTypeOption':
      return `Option<${describeType(type.option().valueType())}>`;
    case 'scSpecTypeTuple':
      return `Tuple<${type.tuple().valueTypes().map(describeType).join(', ')}>`;
    case 'scSpecTypeUdt':
      return type.udt().name().toString();
    case 'scSpecTypeBytesN':
      return `BytesN<${type.bytesN().n()}>`;
    default:
      // strip the ScSpecType prefix
      return name.replace(/^scSpecType/, '');
  }
};

export const classifyParam = (name: string, type: xdr.ScSpecTypeDef): ParamShape => {
  const kind = kindFromType(type);
  const shape: ParamShape = { name, type, kind, typeLabel: describeType(type) };
  if (kind === 'option') {
    const innerType = type.option().valueType();
    shape.inner = classifyParam(name, innerType);
  }
  if (kind === 'bytesN') {
    shape.bytesLen = type.bytesN().n();
  }
  return shape;
};

/** A form's raw values, keyed by parameter name. Everything is a string except JSON parses. */
export type FormValues = Record<string, unknown>;

/**
 * Convert a single form value (as edited by the user) into the native JS value
 * that `spec.funcArgsToScVals` expects.
 */
export const coerceFormValue = (shape: ParamShape, raw: unknown): unknown => {
  switch (shape.kind) {
    case 'address': {
      const v = String(raw ?? '').trim();
      if (!v) throw new Error(`${shape.name}: address required`);
      if (!StrKey.isValidEd25519PublicKey(v) && !StrKey.isValidContract(v)) {
        throw new Error(`${shape.name}: invalid address`);
      }
      return v;
    }
    case 'bool':
      return Boolean(raw);
    case 'string':
    case 'symbol':
      return String(raw ?? '');
    case 'u32':
    case 'i32': {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new Error(`${shape.name}: expected integer`);
      return n;
    }
    case 'u64':
    case 'i64':
    case 'u128':
    case 'i128':
    case 'u256':
    case 'i256': {
      const s = String(raw ?? '').trim();
      if (!/^-?\d+$/.test(s)) throw new Error(`${shape.name}: expected integer`);
      return BigInt(s);
    }
    case 'bytes':
    case 'bytesN': {
      const s = String(raw ?? '').trim().replace(/^0x/i, '');
      if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) {
        throw new Error(`${shape.name}: expected hex bytes`);
      }
      const bytes = new Uint8Array(s.length / 2);
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
      }
      if (shape.kind === 'bytesN' && shape.bytesLen !== undefined && bytes.length !== shape.bytesLen) {
        throw new Error(`${shape.name}: expected ${shape.bytesLen} bytes, got ${bytes.length}`);
      }
      return bytes;
    }
    case 'void':
      return undefined;
    case 'option': {
      // raw is { provided: boolean, value: unknown }
      const wrapper = (raw ?? {}) as { provided?: boolean; value?: unknown };
      if (!wrapper.provided) return null;
      return coerceFormValue(shape.inner!, wrapper.value);
    }
    case 'json': {
      // The textarea always gives us a string; parse to native JS.
      const s = String(raw ?? '').trim();
      if (!s) throw new Error(`${shape.name}: value required`);
      try {
        return JSON.parse(s);
      } catch (e) {
        throw new Error(`${shape.name}: invalid JSON — ${(e as Error).message}`);
      }
    }
    default:
      return raw;
  }
};

export const defaultFormValue = (shape: ParamShape): unknown => {
  switch (shape.kind) {
    case 'bool':
      return false;
    case 'option':
      return { provided: false, value: defaultFormValue(shape.inner!) };
    case 'json':
      return '';
    default:
      return '';
  }
};

/**
 * Best-effort stringify for showing a simulated return value.
 * Handles BigInt and typed arrays that JSON.stringify chokes on.
 */
export const formatResult = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const replacer = (_k: string, v: unknown): unknown => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Uint8Array) return `0x${Array.from(v).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    if (v && typeof v === 'object') {
      if (seen.has(v as object)) return '[Circular]';
      seen.add(v as object);
    }
    return v;
  };
  try {
    if (value === undefined) return 'void';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, replacer, 2);
  } catch {
    return String(value);
  }
};
