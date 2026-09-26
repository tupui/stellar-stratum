/**
 * Plan and check a change to an account's signers and thresholds.
 *
 * The account's own key (the master key) is part of the signer list Horizon returns but can
 * only be changed through `masterWeight`; a `signer` entry for it is rejected by the network.
 * Every other signer is added, re-weighted or removed (weight 0) one `setOptions` at a time.
 */
import { Operation, StrKey, type xdr } from '@stellar/stellar-sdk';
import { isValidPublicKey } from './validation';

export interface SignerConfig {
  key: string;
  weight: number;
}

export interface ThresholdConfig {
  low_threshold: number;
  med_threshold: number;
  high_threshold: number;
}

export interface MultisigConfig {
  signers: SignerConfig[];
  thresholds: ThresholdConfig;
}

export const MAX_EXTRA_SIGNERS = 20;

const isByte = (n: number) => Number.isInteger(n) && n >= 0 && n <= 255;

const decodes = (fn: () => unknown) => {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
};

/** Valid for the signer kind its strkey prefix names (G… key, T… pre-auth, X… hash(x), P… payload). */
export const isValidSignerKey = (key: string): boolean => {
  switch (key[0]) {
    case 'G':
      return isValidPublicKey(key);
    case 'T':
      return decodes(() => StrKey.decodePreAuthTx(key));
    case 'X':
      return decodes(() => StrKey.decodeSha256Hash(key));
    case 'P':
      return decodes(() => StrKey.decodeSignedPayload(key));
    default:
      return false;
  }
};

type SignerOption = NonNullable<Parameters<typeof Operation.setOptions>[0]['signer']>;

const signerOption = (key: string, weight: number): SignerOption => {
  switch (key[0]) {
    case 'T':
      return { preAuthTx: StrKey.decodePreAuthTx(key), weight };
    case 'X':
      return { sha256Hash: StrKey.decodeSha256Hash(key), weight };
    case 'P':
      return { ed25519SignedPayload: key, weight };
    default:
      return { ed25519PublicKey: key, weight };
  }
};

/** The setOptions operations that turn `current` into `next`. */
export const planConfigChange = (account: string, current: MultisigConfig, next: MultisigConfig): xdr.Operation[] => {
  const ops: xdr.Operation[] = [];
  const weightIn = (config: MultisigConfig, key: string) => config.signers.find((s) => s.key === key)?.weight ?? 0;

  const keys = new Set([...current.signers, ...next.signers].map((s) => s.key));
  let masterWeight: number | undefined;
  for (const key of keys) {
    const before = weightIn(current, key);
    const after = weightIn(next, key);
    if (before === after) continue;
    if (key === account) masterWeight = after;
    else ops.push(Operation.setOptions({ signer: signerOption(key, after) }));
  }

  const t = next.thresholds;
  const c = current.thresholds;
  const thresholdsChanged =
    t.low_threshold !== c.low_threshold || t.med_threshold !== c.med_threshold || t.high_threshold !== c.high_threshold;
  if (masterWeight !== undefined || thresholdsChanged) {
    ops.push(Operation.setOptions({
      ...(masterWeight !== undefined ? { masterWeight } : {}),
      ...(thresholdsChanged
        ? { lowThreshold: t.low_threshold, medThreshold: t.med_threshold, highThreshold: t.high_threshold }
        : {}),
    }));
  }
  return ops;
};

/** Errors block the change; warnings are shown for review. */
export const validateConfig = (account: string, next: MultisigConfig): { errors: string[]; warnings: string[] } => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { thresholds } = next;
  const weighted = next.signers.filter((s) => s.weight > 0);

  for (const signer of next.signers) {
    if (!isValidSignerKey(signer.key)) errors.push(`${signer.key.slice(0, 8)}… is not a valid signer key.`);
    if (!isByte(signer.weight)) errors.push(`Signer weights must be whole numbers from 0 to 255.`);
  }
  const keys = next.signers.map((s) => s.key);
  if (new Set(keys).size !== keys.length) errors.push('Each signer can only be listed once.');
  if (weighted.filter((s) => s.key !== account).length > MAX_EXTRA_SIGNERS) {
    errors.push(`An account can have at most ${MAX_EXTRA_SIGNERS} signers besides its own key.`);
  }
  for (const [label, value] of [
    ['Low', thresholds.low_threshold],
    ['Medium', thresholds.med_threshold],
    ['High', thresholds.high_threshold],
  ] as const) {
    if (!isByte(value)) errors.push(`${label} threshold must be a whole number from 0 to 255.`);
  }

  // Lockout: every threshold must stay reachable by the signers left. The network always wants
  // at least one valid signature, even when a threshold is 0.
  const totalWeight = weighted.reduce((sum, s) => sum + s.weight, 0);
  if (weighted.length === 0) {
    errors.push('At least one signer must keep a weight above 0, or the account is locked forever.');
  } else {
    for (const [label, value] of [
      ['low', thresholds.low_threshold],
      ['medium', thresholds.med_threshold],
      ['high', thresholds.high_threshold],
    ] as const) {
      if (Math.max(value, 1) > totalWeight) {
        errors.push(
          `The ${label} threshold (${value}) is above the combined weight of all signers (${totalWeight}): ` +
            'the account would be locked for those operations forever.',
        );
      }
    }
  }

  if (thresholds.low_threshold > thresholds.med_threshold || thresholds.med_threshold > thresholds.high_threshold) {
    warnings.push('Thresholds are usually ordered low ≤ medium ≤ high.');
  }
  if ((next.signers.find((s) => s.key === account)?.weight ?? 0) === 0) {
    warnings.push("The account's own key will not be able to sign any more: only the other signers can.");
  }
  if (weighted.length > 1 && weighted.some((s) => s.weight >= Math.max(thresholds.high_threshold, 1))) {
    warnings.push('A single signer will be able to change the account (signers, thresholds, merge) alone.');
  }
  return { errors, warnings };
};

/** Same signers (keys and weights) and thresholds, whatever the order. */
export const sameConfig = (a: MultisigConfig, b: MultisigConfig): boolean => {
  const norm = (c: MultisigConfig) =>
    JSON.stringify({
      s: c.signers.filter((s) => s.weight > 0).map((s) => `${s.key}:${s.weight}`).sort(),
      t: [c.thresholds.low_threshold, c.thresholds.med_threshold, c.thresholds.high_threshold],
    });
  return norm(a) === norm(b);
};
