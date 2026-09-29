import { StrKey } from '@stellar/stellar-sdk';
import { baseAccountId } from '@/lib/signatures';
import { revealUnsafeChars } from '@/lib/text';

/**
 * Plain-language interpretation of what a transaction actually does to an account.
 *
 * `setOptions` is the operation people most often misread: a signer set to weight 0 is a
 * removal, a threshold is a weight total rather than a signer count, and a multisig change
 * is usually split across several operations that only make sense read together. This module
 * replays those operations against the account's current state and reports the net effect.
 *
 * Account state is optional — without it (offline/air-gapped signing) the result still
 * describes the target state, just with no "before" side to compare against.
 */
/**
 * The SDK's `Operation` union has members that do not all carry a `type` discriminant, so
 * this module states the structural shape it actually reads instead of importing the union.
 */
export interface ReadableOperation {
  type: string;
  /** Set only when the operation targets an account other than the transaction source. */
  source?: string;
}

export interface SignerState {
  key: string;
  weight: number;
}

export interface AccountSnapshot {
  publicKey: string;
  signers: SignerState[];
  thresholds: { low: number; med: number; high: number };
}

export type ThresholdLevel = 'low' | 'med' | 'high';

export const THRESHOLD_LABELS: Record<ThresholdLevel, { name: string; hint: string }> = {
  low: { name: 'Basic operations', hint: 'sequence bumps, claiming balances, trustline authorization' },
  med: { name: 'Payments', hint: 'payments, swaps, trustlines, contract calls' },
  high: { name: 'Account changes', hint: 'signers, thresholds, account merge' },
};

/** `weight-set` is the honest label when the account's current state is unknown. */
export type SignerChangeKind = 'added' | 'removed' | 'weight-raised' | 'weight-lowered' | 'weight-set';

export interface SignerChange {
  key: string;
  kind: SignerChangeKind;
  /** Weight before the transaction; undefined when the key was not a signer yet. */
  before?: number;
  after: number;
  /** The account's own master key rather than an added signer. */
  isMasterKey: boolean;
}

export interface ThresholdChange {
  level: ThresholdLevel;
  /** Undefined when the current account state is unknown. */
  before?: number;
  after: number;
}

/** How many signers it takes to clear a threshold, given the weights available. */
export interface SigningRequirement {
  level: ThresholdLevel;
  threshold: number;
  /** Fewest signers that can reach the threshold; null when no combination can. */
  minSigners: number | null;
  /** True when *any* group of `minSigners` works, i.e. all weights are interchangeable. */
  anyCombination: boolean;
}

export type WarningSeverity = 'critical' | 'warning' | 'info';

export interface InterpretationWarning {
  severity: WarningSeverity;
  title: string;
  detail: string;
}

export interface MultisigInterpretation {
  signerChanges: SignerChange[];
  thresholdChanges: ThresholdChange[];
  /** Signers after the transaction, weight 0 entries dropped. Null when state is unknown. */
  resultingSigners: SignerState[] | null;
  resultingThresholds: { low: number; med: number; high: number } | null;
  resultingTotalWeight: number | null;
  requirements: SigningRequirement[];
  homeDomain?: string;
  flagChanges: string[];
  inflationDest?: string;
}

export interface TransactionInterpretation {
  headline: string;
  /** Prose for settings with no structured row of their own: flags, home domain, inflation. */
  otherChanges: string[];
  multisig?: MultisigInterpretation;
  warnings: InterpretationWarning[];
}

type SetOptionsOp = ReadableOperation & {
  signer?: Record<string, unknown> & { weight?: number };
  masterWeight?: number;
  lowThreshold?: number;
  medThreshold?: number;
  highThreshold?: number;
  homeDomain?: string;
  inflationDest?: string;
  setFlags?: number;
  clearFlags?: number;
};

/**
 * Unset `setOptions` fields arrive as `null` from a freshly built operation and are absent
 * after an XDR round-trip. Both mean "leave this alone", so neither may count as a change.
 */
const isSet = <T,>(value: T | null | undefined): value is T => value !== null && value !== undefined;

const AUTH_FLAGS: ReadonlyArray<[number, string]> = [
  [1, 'Authorization required'],
  [2, 'Authorization revocable'],
  [4, 'Authorization immutable'],
  [8, 'Clawback enabled'],
];

/** Shorten a key the way the UI does elsewhere, so warnings read like the rest of the app. */
export const shortKey = (key: string): string =>
  key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key;

/**
 * A setOptions signer is one of four kinds. The SDK decodes pre-auth and hash(x) signers as
 * raw bytes, so encode them to the same strkeys Horizon uses (T…, X…, P…): that way a change
 * lines up with the account's current signer list instead of looking like a new entry.
 */
const readSignerKey = (signer: Record<string, unknown>): string | null => {
  const asBytes = (value: unknown) => (value instanceof Uint8Array ? Buffer.from(value) : null);
  if (typeof signer.ed25519PublicKey === 'string') return signer.ed25519PublicKey;
  if (typeof signer.ed25519SignedPayload === 'string') return signer.ed25519SignedPayload;
  const preAuth = asBytes(signer.preAuthTx);
  if (preAuth) return StrKey.encodePreAuthTx(preAuth);
  const hashX = asBytes(signer.sha256Hash);
  if (hashX) return StrKey.encodeSha256Hash(hashX);
  if (typeof signer.preAuthTx === 'string') return signer.preAuthTx;
  if (typeof signer.sha256Hash === 'string') return signer.sha256Hash;
  return null;
};

/**
 * Fewest signers that can reach `threshold`, and whether every group of that size works.
 * Taking the heaviest weights first maximises the sum for a given count, so the greedy
 * walk gives the exact minimum; the lightest-first walk decides if the choice is free.
 */
const signersNeeded = (
  threshold: number,
  weights: number[],
): { minSigners: number | null; anyCombination: boolean } => {
  // The network always wants at least one valid signature, even when a threshold is 0.
  threshold = Math.max(threshold, 1);

  const heaviestFirst = [...weights].sort((a, b) => b - a);
  let sum = 0;
  let minSigners: number | null = null;
  for (let i = 0; i < heaviestFirst.length; i++) {
    sum += heaviestFirst[i];
    if (sum >= threshold) {
      minSigners = i + 1;
      break;
    }
  }
  if (minSigners === null) return { minSigners: null, anyCombination: false };

  const lightestFirst = [...weights].sort((a, b) => a - b);
  const worstCase = lightestFirst.slice(0, minSigners).reduce((total, w) => total + w, 0);
  return { minSigners, anyCombination: worstCase >= threshold };
};

/** Ed25519 keys (G…) and signed payloads (P…, signed by a G key) are held by someone. */
const isHeldKey = (key: string): boolean => key.startsWith('G') || key.startsWith('P');

const keylessSignerRisk = (key: string, weight: number): InterpretationWarning | null => {
  if (key.startsWith('T')) {
    return {
      severity: 'critical',
      title: 'A transaction you cannot see here could act on this account',
      detail:
        `Signer ${shortKey(key)} is the hash of another transaction. After this change anyone can submit that ` +
        `transaction with no other signature (weight ${weight}). Its content is not part of what you are signing: ` +
        `do not sign unless you have checked that transaction yourself.`,
    };
  }
  if (key.startsWith('X')) {
    return {
      severity: 'critical',
      title: 'Anyone who knows a secret could sign for this account',
      detail:
        `Signer ${shortKey(key)} is a hash(x) signer with weight ${weight}: whoever knows the secret x can sign, ` +
        `and x becomes public the first time it is used.`,
    };
  }
  if (key.startsWith('P')) {
    let signerKey = 'a key';
    try {
      signerKey = shortKey(StrKey.encodeEd25519PublicKey(StrKey.decodeSignedPayload(key).subarray(0, 32)));
    } catch {
      // Keep the generic wording; the key itself is shown in the signer list.
    }
    return {
      severity: 'warning',
      title: 'A signed-payload signer',
      detail:
        `A signature by ${signerKey} over a fixed payload counts as weight ${weight} for any transaction, ` +
        `not just one it has seen.`,
    };
  }
  return null;
};

const describeFlags = (mask: number, verb: 'Enables' | 'Disables'): string[] =>
  AUTH_FLAGS.filter(([bit]) => (mask & bit) !== 0).map(([, label]) => `${verb} ${label.toLowerCase()}`);

const interpretMultisig = (
  ops: SetOptionsOp[],
  sourceAccount: string,
  account: AccountSnapshot | null,
): { multisig: MultisigInterpretation; warnings: InterpretationWarning[] } => {
  const warnings: InterpretationWarning[] = [];
  const knowsState = account !== null;

  const before = new Map<string, number>();
  if (account) for (const s of account.signers) before.set(s.key, s.weight);
  const after = new Map<string, number>(before);

  const thresholdsAfter = account
    ? { ...account.thresholds }
    : ({} as Partial<AccountSnapshot['thresholds']>);
  const thresholdTouched: Record<ThresholdLevel, boolean> = { low: false, med: false, high: false };

  let homeDomain: string | undefined;
  let inflationDest: string | undefined;
  const flagChanges: string[] = [];

  // Operations apply in order, so replaying them yields the net effect of the whole batch.
  for (const op of ops) {
    // The master key is the source account itself, known even without its current state.
    if (isSet(op.masterWeight)) after.set(sourceAccount, op.masterWeight);
    if (isSet(op.signer)) {
      const key = readSignerKey(op.signer);
      if (key !== null) {
        after.set(key, op.signer.weight ?? 0);
      } else {
        warnings.push({
          severity: 'critical',
          title: 'Unreadable signer change',
          detail: 'A setOptions operation changes a signer this app cannot decode. Do not sign unless you can verify it elsewhere.',
        });
      }
    }
    if (isSet(op.lowThreshold)) {
      thresholdsAfter.low = op.lowThreshold;
      thresholdTouched.low = true;
    }
    if (isSet(op.medThreshold)) {
      thresholdsAfter.med = op.medThreshold;
      thresholdTouched.med = true;
    }
    if (isSet(op.highThreshold)) {
      thresholdsAfter.high = op.highThreshold;
      thresholdTouched.high = true;
    }
    if (isSet(op.homeDomain)) homeDomain = op.homeDomain;
    if (isSet(op.inflationDest)) inflationDest = op.inflationDest;
    if (op.setFlags) flagChanges.push(...describeFlags(op.setFlags, 'Enables'));
    if (op.clearFlags) flagChanges.push(...describeFlags(op.clearFlags, 'Disables'));
  }

  const signerChanges: SignerChange[] = [];
  for (const [key, afterWeight] of after) {
    const beforeWeight = before.get(key);
    if (beforeWeight === afterWeight) continue;
    const isMasterKey = key === sourceAccount;
    let kind: SignerChangeKind;
    if (afterWeight === 0) kind = 'removed';
    else if (!knowsState) kind = 'weight-set';
    else if (beforeWeight === undefined || beforeWeight === 0) kind = 'added';
    else kind = afterWeight > beforeWeight ? 'weight-raised' : 'weight-lowered';
    signerChanges.push({ key, kind, before: knowsState ? beforeWeight ?? 0 : undefined, after: afterWeight, isMasterKey });
  }
  // Additions first, then removals, then weight tweaks — the order people scan for.
  const kindOrder: Record<SignerChangeKind, number> = { added: 0, 'weight-set': 1, removed: 2, 'weight-raised': 3, 'weight-lowered': 4 };
  signerChanges.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.key.localeCompare(b.key));

  const thresholdChanges: ThresholdChange[] = (['low', 'med', 'high'] as const)
    .filter((level) => thresholdTouched[level])
    .map((level) => ({
      level,
      before: account ? account.thresholds[level] : undefined,
      after: thresholdsAfter[level] as number,
    }));

  const resultingSigners = [...after.entries()]
    .filter(([, weight]) => weight > 0)
    .map(([key, weight]) => ({ key, weight }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));

  const canProject =
    knowsState &&
    thresholdsAfter.low !== undefined &&
    thresholdsAfter.med !== undefined &&
    thresholdsAfter.high !== undefined;

  // Weight that only counts once, or for anyone, is not a key someone holds: a pre-auth
  // signer is consumed by the one transaction it names, and a hash(x) signer works for whoever
  // knows x, which becomes public the first time it is used. Lockout checks use held keys only.
  const keySigners = resultingSigners.filter((s) => isHeldKey(s.key));
  const totalWeight = keySigners.reduce((sum, s) => sum + s.weight, 0);
  const requirements: SigningRequirement[] = [];

  if (canProject) {
    const weights = keySigners.map((s) => s.weight);
    for (const level of ['low', 'med', 'high'] as const) {
      const threshold = thresholdsAfter[level] as number;
      const { minSigners, anyCombination } = signersNeeded(threshold, weights);
      requirements.push({ level, threshold, minSigners, anyCombination });

      if (minSigners === null && keySigners.length > 0) {
        warnings.push({
          severity: 'critical',
          title: `${THRESHOLD_LABELS[level].name} would become impossible`,
          detail:
            `The ${THRESHOLD_LABELS[level].name.toLowerCase()} threshold is set to ${threshold}, but the ` +
            `combined weight of every remaining key is only ${totalWeight}. No set of signatures could ever ` +
            `authorise these operations again.`,
        });
      }
    }

    // Dropping from "several signatures" to "one" quietly undoes the point of multisig, and
    // it is easy to miss when it is the by-product of a weight bump rather than an explicit
    // threshold edit.
    const highAfter = requirements.find((r) => r.level === 'high');
    const beforeWeights = account.signers.filter((s) => s.weight > 0 && isHeldKey(s.key)).map((s) => s.weight);
    const highBefore = signersNeeded(account.thresholds.high, beforeWeights);
    if (highAfter?.minSigners === 1 && highBefore.minSigners !== null && highBefore.minSigners > 1) {
      warnings.push({
        severity: 'warning',
        title: 'One signature alone could change this account',
        detail:
          `Account changes currently take ${highBefore.minSigners} signers. Afterwards a single signer would carry ` +
          `enough weight to reconfigure the account on their own.`,
      });
    }

    if (resultingSigners.length === 0) {
      warnings.push({
        severity: 'critical',
        title: 'Every signer would be removed',
        detail: 'The account would be left with no keys able to sign for it, permanently locking the funds.',
      });
    } else if (keySigners.length === 0) {
      warnings.push({
        severity: 'critical',
        title: 'No key could sign for this account',
        detail:
          'Only pre-authorised transaction or hash(x) signers would remain. Once they are used, nobody could sign ' +
          'for the account again.',
      });
    }
  }

  // Signers that are not keys hand the account to something this transaction does not show.
  for (const change of signerChanges) {
    if (change.after === 0 || change.kind === 'weight-lowered') continue;
    const risk = keylessSignerRisk(change.key, change.after);
    if (risk) warnings.push(risk);
  }

  if (flagChanges.some((f) => f.toLowerCase().includes('authorization immutable'))) {
    warnings.push({
      severity: 'critical',
      title: 'Authorization immutable is irreversible',
      detail: 'Once set, this flag can never be cleared and the account can no longer be merged or reconfigured.',
    });
  }

  return {
    multisig: {
      signerChanges,
      thresholdChanges,
      resultingSigners: canProject ? resultingSigners : null,
      resultingThresholds: canProject
        ? {
            low: thresholdsAfter.low as number,
            med: thresholdsAfter.med as number,
            high: thresholdsAfter.high as number,
          }
        : null,
      resultingTotalWeight: canProject ? totalWeight : null,
      requirements,
      homeDomain,
      inflationDest,
      flagChanges,
    },
    warnings,
  };
};

const headlineFor = (multisig: MultisigInterpretation | undefined, opTypes: string[]): string => {
  if (multisig) {
    const { signerChanges, thresholdChanges } = multisig;
    const touchesSigners = signerChanges.length > 0;
    const touchesThresholds = thresholdChanges.length > 0;
    if (touchesSigners && touchesThresholds) return 'Changes who can sign for this account, and how many signatures it takes';
    if (touchesSigners) return 'Changes who can sign for this account';
    if (touchesThresholds) return 'Changes how many signatures this account requires';
    return 'Updates this account’s settings';
  }
  const unique = [...new Set(opTypes)];
  if (unique.length === 1) return `Runs ${opTypes.length} ${unique[0]} operation${opTypes.length > 1 ? 's' : ''}`;
  return `Runs ${opTypes.length} operations across ${unique.length} types`;
};

export const interpretTransaction = (
  operations: readonly ReadableOperation[],
  context: { sourceAccount: string; account?: AccountSnapshot | null },
): TransactionInterpretation | null => {
  const account = context.account ?? null;
  // A muxed (M…) source is the same account as its G… base: compare accounts, not spellings.
  const sourceAccount = baseAccountId(context.sourceAccount);

  // An operation with its own source targets a different account, so it must not be folded
  // into this account's before/after picture.
  const foreign = operations.filter((op) => op.source && baseAccountId(op.source) !== sourceAccount);
  const setOptionsOps = operations.filter(
    (op) => op.type === 'setOptions' && !foreign.includes(op),
  ) as SetOptionsOp[];

  const foreignSetOptions = foreign.filter((op) => op.type === 'setOptions');
  if (setOptionsOps.length === 0 && foreignSetOptions.length === 0) return null;

  const { multisig, warnings } = interpretMultisig(setOptionsOps, sourceAccount, account);

  const otherChanges = multisig.flagChanges.map((f) => `${f}.`);
  if (isSet(multisig.homeDomain)) {
    const domain = revealUnsafeChars(multisig.homeDomain);
    otherChanges.push(
      multisig.homeDomain === '' ? 'Clears the account’s home domain.' : `Sets the account’s home domain to ${domain.text}.`,
    );
    if (domain.unsafe) {
      warnings.push({
        severity: 'warning',
        title: 'Hidden characters in the home domain',
        detail: 'The new home domain contains invisible or direction-changing characters, shown as ⟨U+…⟩.',
      });
    }
  }
  if (isSet(multisig.inflationDest)) {
    otherChanges.push(`Sets the inflation destination to ${shortKey(multisig.inflationDest)}.`);
  }

  if (foreignSetOptions.length > 0) {
    warnings.push({
      severity: 'warning',
      title: 'Some settings changes target a different account',
      detail:
        `${foreignSetOptions.length} setOptions operation${foreignSetOptions.length > 1 ? 's' : ''} in this ` +
        `transaction set an explicit source account, so ${foreignSetOptions.length > 1 ? 'they change accounts' : 'it changes an account'} ` +
        `other than ${shortKey(sourceAccount)} and ${foreignSetOptions.length > 1 ? 'are' : 'is'} not reflected below.`,
    });
  }

  const hasStructuredChanges = multisig.signerChanges.length > 0 || multisig.thresholdChanges.length > 0;
  if (!hasStructuredChanges && otherChanges.length === 0 && warnings.length === 0) return null;

  return {
    headline: headlineFor(multisig, operations.map((op) => op.type)),
    otherChanges,
    multisig,
    warnings,
  };
};
