/**
 * What the Soroswap and DeFindex SDKs actually hand back. Their types promise
 * bigints and Errors, but their HTTP clients return parsed JSON and reject with
 * the API's error body, so both go through these helpers.
 */

/** Readable message from a rejected SDK call: an Error, or the API's JSON error body. */
export const apiErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === 'string') return err || fallback;
  if (err && typeof err === 'object') {
    const { message, detail, error } = err as Record<string, unknown>;
    for (const value of [message, detail, error]) {
      if (typeof value === 'string' && value) return value;
      if (Array.isArray(value) && value.length) return value.join('; ');
    }
  }
  return fallback;
};

/** A contract integer from an API response (decimal string or number); throws on anything else. */
export const apiAmount = (value: unknown): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new Error(`Unexpected amount in the API response: ${String(value)}`);
};
