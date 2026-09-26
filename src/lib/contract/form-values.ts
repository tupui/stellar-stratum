import { contract, xdr, StrKey } from '@stellar/stellar-sdk';

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
  | 'json'; // Vec, Map, Tuple, Udt, Result, Val, Error

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
  /** For `json`, an example value in the format the field expects. */
  example?: string;
}

const kindFromType = (type: xdr.ScSpecTypeDef): InputKind => {
  const name = type.type;
  switch (name) {
    case 'scSpecTypeAddress':
    case 'scSpecTypeMuxedAddress':
      return 'address';
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
    case 'scSpecTypeTimepoint': // u64 seconds since the Unix epoch
    case 'scSpecTypeDuration': // u64 seconds
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
      // Vec, Map, Tuple, Udt, Result, Val, Error, …
      return 'json';
  }
};

export const describeType = (type: xdr.ScSpecTypeDef): string => {
  switch (type.type) {
    case 'scSpecTypeVec':
      return `Vec<${describeType(type.vec.elementType)}>`;
    case 'scSpecTypeMap': {
      const m = type.map;
      return `Map<${describeType(m.keyType)}, ${describeType(m.valueType)}>`;
    }
    case 'scSpecTypeOption':
      return `Option<${describeType(type.option.valueType)}>`;
    case 'scSpecTypeTuple':
      return `Tuple<${type.tuple.valueTypes.map(describeType).join(', ')}>`;
    case 'scSpecTypeUdt':
      return type.udt.name.toString();
    case 'scSpecTypeBytesN':
      return `BytesN<${type.bytesN.n}>`;
    default:
      // strip the ScSpecType prefix
      return type.type.replace(/^scSpecType/, '');
  }
};

const INTEGER = /^-?\d+$/;
const SYMBOL = /^[A-Za-z0-9_]{0,32}$/;
const isTupleStruct = (fields: xdr.ScSpecUdtStructFieldV0[]) => fields.every((f) => /^\d+$/.test(f.name.toString()));
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** An example value of `type` in the JSON format `jsonToNative` reads, used as a format hint. */
const exampleValue = (type: xdr.ScSpecTypeDef, spec: contract.Spec, depth = 0): unknown => {
  if (depth > 4) return null; // recursive types
  const example = (t: xdr.ScSpecTypeDef) => exampleValue(t, spec, depth + 1);
  switch (type.type) {
    case 'scSpecTypeBool':
      return false;
    case 'scSpecTypeU32':
    case 'scSpecTypeI32':
      return 0;
    case 'scSpecTypeU64':
    case 'scSpecTypeI64':
    case 'scSpecTypeU128':
    case 'scSpecTypeI128':
    case 'scSpecTypeU256':
    case 'scSpecTypeI256':
    case 'scSpecTypeTimepoint':
    case 'scSpecTypeDuration':
      return '0';
    case 'scSpecTypeString':
      return 'text';
    case 'scSpecTypeSymbol':
      return 'symbol';
    case 'scSpecTypeAddress':
    case 'scSpecTypeMuxedAddress':
      return 'G…';
    case 'scSpecTypeBytes':
      return 'deadbeef';
    case 'scSpecTypeBytesN':
      return '00'.repeat(type.bytesN.n);
    case 'scSpecTypeOption':
      return example(type.option.valueType);
    case 'scSpecTypeVec':
      return [example(type.vec.elementType)];
    case 'scSpecTypeTuple':
      return type.tuple.valueTypes.map(example);
    case 'scSpecTypeMap': {
      const key = example(type.map.keyType);
      const value = example(type.map.valueType);
      return typeof key === 'string' ? { [key]: value } : [[key, value]];
    }
    case 'scSpecTypeUdt': {
      const entry = spec.findEntry(type.udt.name.toString());
      switch (entry.type) {
        case 'scSpecEntryUdtStructV0': {
          const fields = entry.udtStructV0.fields;
          return isTupleStruct(fields)
            ? fields.map((f) => example(f.type))
            : Object.fromEntries(fields.map((f) => [f.name.toString(), example(f.type)]));
        }
        case 'scSpecEntryUdtUnionV0': {
          const first = entry.udtUnionV0.cases[0];
          if (!first) return null;
          return first.type === 'scSpecUdtUnionCaseVoidV0'
            ? first.voidCase.name.toString()
            : { tag: first.tupleCase.name.toString(), values: first.tupleCase.type.map(example) };
        }
        case 'scSpecEntryUdtEnumV0':
          return entry.udtEnumV0.cases[0]?.name.toString() ?? null;
        default:
          return null;
      }
    }
    default:
      return null;
  }
};

export const classifyParam = (name: string, type: xdr.ScSpecTypeDef, spec: contract.Spec): ParamShape => {
  const kind = kindFromType(type);
  const shape: ParamShape = { name, type, kind, typeLabel: describeType(type) };
  if (type.type === 'scSpecTypeOption') {
    const innerType = type.option.valueType;
    shape.inner = classifyParam(name, innerType, spec);
  }
  if (type.type === 'scSpecTypeBytesN') {
    shape.bytesLen = type.bytesN.n;
  }
  if (kind === 'json') {
    try {
      const example = exampleValue(type, spec);
      if (example !== null) shape.example = JSON.stringify(example);
    } catch {
      // A user type missing from the spec: no example
    }
  }
  return shape;
};

/** A form's raw values, keyed by parameter name. Everything is a string except JSON parses. */
export type FormValues = Record<string, unknown>;

/** Read hex (optionally 0x-prefixed) into bytes, checking the length of a BytesN. */
const hexToBytes = (value: unknown, path: string, length?: number): Uint8Array => {
  const s = typeof value === 'string' ? value.trim().replace(/^0x/i, '') : '';
  if (typeof value !== 'string' || s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) {
    throw new Error(`${path}: expected hex bytes`);
  }
  const bytes = new Uint8Array(s.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  if (length !== undefined && bytes.length !== length) {
    throw new Error(`${path}: expected ${length} bytes, got ${bytes.length}`);
  }
  return bytes;
};

/**
 * An exact integer from a string of digits or a JSON number. JSON numbers are doubles, so an
 * integer beyond ±2^53 has already lost digits and must be written as a string instead.
 */
const toBigInt = (value: unknown, path: string): bigint => {
  if (typeof value === 'string' && INTEGER.test(value.trim())) return BigInt(value.trim());
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${path}: integers beyond ±2^53 lose digits as JSON numbers, write them as strings ("123…")`);
    }
    return BigInt(value);
  }
  throw new Error(`${path}: expected an integer`);
};

// Soroban maps must be sorted by key. Keys of these kinds compare like their JS values (strings,
// numbers or bigints); the simulation reports any other disorder.
const SORTABLE_KEYS: InputKind[] = ['string', 'symbol', 'u32', 'i32', 'u64', 'i64', 'u128', 'i128', 'u256', 'i256'];
const compareKeys = (a: unknown, b: unknown): number => {
  const [x, y] = [a, b] as [string, string];
  return x < y ? -1 : x > y ? 1 : 0;
};

const udtToNative = (value: unknown, name: string, spec: contract.Spec, path: string): unknown => {
  const entry = spec.findEntry(name);
  switch (entry.type) {
    case 'scSpecEntryUdtStructV0': {
      const fields = entry.udtStructV0.fields;
      if (isTupleStruct(fields)) {
        if (!Array.isArray(value) || value.length !== fields.length) {
          throw new Error(`${path}: expected an array of ${fields.length} values`);
        }
        return fields.map((f, i) => jsonToNative(value[i], f.type, spec, `${path}[${i}]`));
      }
      const names = fields.map((f) => f.name.toString());
      if (!isPlainObject(value)) throw new Error(`${path}: expected an object with ${names.join(', ')}`);
      const unknownField = Object.keys(value).find((k) => !names.includes(k));
      if (unknownField) throw new Error(`${path}: unknown field "${unknownField}"`);
      return Object.fromEntries(fields.map((f, i) => {
        const field = names[i];
        if (!(field in value) && f.type.type !== 'scSpecTypeOption') throw new Error(`${path}: missing field "${field}"`);
        return [field, jsonToNative(value[field], f.type, spec, `${path}.${field}`)];
      }));
    }
    case 'scSpecEntryUdtUnionV0': {
      // {"tag": "Case", "values": [...]}, or the bare case name for a case without values
      const obj: Record<string, unknown> = typeof value === 'string' ? { tag: value } : isPlainObject(value) ? value : {};
      const cases = entry.udtUnionV0.cases;
      const found = cases.find((c) => c.value.name.toString() === obj.tag);
      if (!found) {
        throw new Error(`${path}: expected one of ${cases.map((c) => c.value.name.toString()).join(', ')}`);
      }
      const tag = found.value.name.toString();
      if (found.type === 'scSpecUdtUnionCaseVoidV0') return { tag };
      const types = found.tupleCase.type;
      const values = obj.values;
      if (!Array.isArray(values) || values.length !== types.length) {
        throw new Error(`${path}: ${tag} expects "values" with ${types.length} item(s)`);
      }
      return { tag, values: values.map((v, i) => jsonToNative(v, types[i], spec, `${path}.${tag}[${i}]`)) };
    }
    case 'scSpecEntryUdtEnumV0': {
      // The case name or its number
      const cases = entry.udtEnumV0.cases;
      const found = cases.find((c) => c.name.toString() === value || c.value === value);
      if (!found) throw new Error(`${path}: expected one of ${cases.map((c) => c.name.toString()).join(', ')}`);
      return found.value;
    }
    default:
      return value;
  }
};

/**
 * Convert a value typed by the user into the native JS value `spec.funcArgsToScVals` expects for
 * `type`, walking vectors, maps, tuples and user types. The SDK reads a string as base64 for bytes
 * and trusts JSON numbers, so bytes are read as hex and integers are checked to be exact here.
 * Scalars accept the text of a form input as well as JSON values.
 */
const jsonToNative = (value: unknown, type: xdr.ScSpecTypeDef, spec: contract.Spec, path: string): unknown => {
  switch (type.type) {
    case 'scSpecTypeBool':
      if (typeof value !== 'boolean') throw new Error(`${path}: expected true or false`);
      return value;
    case 'scSpecTypeU32':
    case 'scSpecTypeI32':
      return Number(toBigInt(value, path)); // range checked by the SDK
    case 'scSpecTypeU64':
    case 'scSpecTypeI64':
    case 'scSpecTypeU128':
    case 'scSpecTypeI128':
    case 'scSpecTypeU256':
    case 'scSpecTypeI256':
    case 'scSpecTypeTimepoint':
    case 'scSpecTypeDuration':
      return toBigInt(value, path);
    case 'scSpecTypeString':
      if (typeof value !== 'string') throw new Error(`${path}: expected a string`);
      return value;
    case 'scSpecTypeSymbol':
      if (typeof value !== 'string' || !SYMBOL.test(value)) {
        throw new Error(`${path}: expected a symbol, up to 32 letters, digits or underscores`);
      }
      return value;
    case 'scSpecTypeAddress':
    case 'scSpecTypeMuxedAddress': {
      const v = typeof value === 'string' ? value.trim() : '';
      if (!v) throw new Error(`${path}: address required`);
      const muxed = type.type === 'scSpecTypeMuxedAddress' && StrKey.isValidMed25519PublicKey(v);
      if (!muxed && !StrKey.isValidEd25519PublicKey(v) && !StrKey.isValidContract(v)) {
        throw new Error(`${path}: invalid address`);
      }
      return v;
    }
    case 'scSpecTypeBytes':
      return hexToBytes(value, path);
    case 'scSpecTypeBytesN':
      return hexToBytes(value, path, type.bytesN.n);
    case 'scSpecTypeOption':
      return value === null || value === undefined ? null : jsonToNative(value, type.option.valueType, spec, path);
    case 'scSpecTypeVec':
      if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
      return value.map((v, i) => jsonToNative(v, type.vec.elementType, spec, `${path}[${i}]`));
    case 'scSpecTypeTuple': {
      const types = type.tuple.valueTypes;
      if (!Array.isArray(value) || value.length !== types.length) {
        throw new Error(`${path}: expected an array of ${types.length} values`);
      }
      return value.map((v, i) => jsonToNative(v, types[i], spec, `${path}[${i}]`));
    }
    case 'scSpecTypeMap': {
      // An object, or [key, value] pairs for keys that are not strings
      const entries = isPlainObject(value) ? Object.entries(value) : value;
      if (!Array.isArray(entries) || !entries.every((e) => Array.isArray(e) && e.length === 2)) {
        throw new Error(`${path}: expected an object or a list of [key, value] pairs`);
      }
      const { keyType, valueType } = type.map;
      const converted = entries.map(([k, v]) => [
        jsonToNative(k, keyType, spec, `${path} key ${JSON.stringify(k)}`),
        jsonToNative(v, valueType, spec, `${path}.${String(k)}`),
      ]);
      return SORTABLE_KEYS.includes(kindFromType(keyType)) ? converted.sort(([a], [b]) => compareKeys(a, b)) : converted;
    }
    case 'scSpecTypeUdt':
      return udtToNative(value, type.udt.name.toString(), spec, path);
    default:
      // Val, Result, Error, Void: handed to the SDK as is
      return value;
  }
};

/**
 * Convert a single form value (as edited by the user) into the native JS value
 * that `spec.funcArgsToScVals` expects.
 */
export const coerceFormValue = (shape: ParamShape, raw: unknown, spec: contract.Spec): unknown => {
  switch (shape.kind) {
    case 'bool':
      return Boolean(raw);
    case 'void':
      return undefined;
    case 'option': {
      // raw is { provided: boolean, value: unknown }
      const wrapper = (raw ?? {}) as { provided?: boolean; value?: unknown };
      if (!wrapper.provided) return null;
      return coerceFormValue(shape.inner!, wrapper.value, spec);
    }
    case 'json': {
      // The textarea always gives us a string; parse to native JS.
      const s = String(raw ?? '').trim();
      if (!s) throw new Error(`${shape.name}: value required`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(s);
      } catch (e) {
        throw new Error(`${shape.name}: invalid JSON: ${(e as Error).message}`, { cause: e });
      }
      return jsonToNative(parsed, shape.type, spec, shape.name);
    }
    case 'string':
      return String(raw ?? '');
    default:
      // Text inputs follow the same rules as a string in JSON.
      return jsonToNative(String(raw ?? '').trim(), shape.type, spec, shape.name);
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
