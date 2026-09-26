import { Decimal } from 'decimal.js';
import type { NetworkId } from './registry';

export interface TokenMeta {
  code: string;
  decimals: number;
  icon?: string;
  /** Classic issuer, when the token is a Stellar Asset Contract. */
  issuer?: string;
  /** False when decimals were assumed rather than resolved. */
  known: boolean;
}

/** Stellar Asset Contracts are always 7-decimal; it's the right guess for an unknown token. */
export const ASSUMED_DECIMALS = 7;

/**
 * Precision of pool LP tokens and DeFindex vault shares. Both contracts report
 * `decimals() == 7`; verified against the deployed mainnet router pair and vault.
 */
export const SHARE_DECIMALS = 7;

const BUILTIN: Record<NetworkId, Record<string, Omit<TokenMeta, 'known'>>> = {
  mainnet: {
    CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA: { code: 'XLM', decimals: 7 },
    CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75: {
      code: 'USDC',
      decimals: 7,
      issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    },
  },
  testnet: {
    CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC: { code: 'XLM', decimals: 7 },
  },
};

/** Synchronous lookup — works offline. Returns undefined for tokens we don't ship. */
export const getBuiltinToken = (contract: string, network: NetworkId): TokenMeta | undefined => {
  const hit = BUILTIN[network][contract];
  return hit ? { ...hit, known: true } : undefined;
};

/** `CAG5LRYQ…CFAJDDH` — enough to eyeball against a block explorer. */
export const shortenAddress = (address: string, lead = 6, tail = 6): string =>
  address.length <= lead + tail + 1 ? address : `${address.slice(0, lead)}…${address.slice(-tail)}`;

/**
 * A typed decimal ("12.5") as a contract integer, without going through floats.
 * Null when it is not a plain decimal or has more places than the token has.
 */
export const parseUnits = (value: string, decimals: number): bigint | null => {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || !(match[1] || match[2])) return null;
  const [, whole, fraction = ''] = match;
  if (fraction.length > decimals) return null;
  return BigInt(`${whole || '0'}${fraction.padEnd(decimals, '0')}`);
};

/** A contract integer as a plain decimal string ("12.5"): exact, ungrouped, fit for an input field. */
export const formatUnits = (raw: bigint, decimals: number): string => {
  const digits = (raw < 0n ? -raw : raw).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${raw < 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
};

const grouping = new Intl.NumberFormat('en-US');

/**
 * Render a raw contract integer as a decimal string.
 *
 * Never rounds: on a signing screen a displayed "at least" that reads higher
 * than the guarantee in the XDR is a lie, so every significant digit stays and
 * only trailing zeros are dropped. Thousands are grouped for legibility.
 */
export const formatTokenAmount = (raw: bigint | string, decimals: number): string => {
  const value = new Decimal(raw.toString()).div(new Decimal(10).pow(decimals));
  // Dividing an integer by a power of ten is exact, so toFixed cannot round here.
  const [whole, fraction = ''] = value.abs().toFixed(decimals).split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const grouped = grouping.format(BigInt(whole));
  return `${value.isNegative() ? '-' : ''}${grouped}${trimmed ? `.${trimmed}` : ''}`;
};
