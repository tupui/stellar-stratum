/**
 * Who has signed a transaction, and whether that is enough for the network to accept it.
 *
 * Stellar checks every account a transaction touches: the transaction source (low threshold,
 * for the fee and sequence number) and each operation's source account at that operation's
 * threshold level. Signatures are verified against the transaction hash, so a signature only
 * counts here if it actually verifies, not just because its 4-byte hint matches a signer.
 */
import {
  FeeBumpTransaction,
  Keypair,
  StrKey,
  Transaction,
  hash as sha256,
  type xdr,
} from '@stellar/stellar-sdk';
import type { ThresholdLevel } from '@/lib/xdr/interpret';

export interface SignerInfo {
  key: string;
  weight: number;
  type?: string;
}

/** The part of an account the signature check needs (same shape as AccountData). */
export interface AccountAuth {
  publicKey: string;
  signers: SignerInfo[];
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
}

export interface SignatureRequirement {
  account: string;
  level: ThresholdLevel;
  /** Effective weight needed: the network always wants at least one valid signature. */
  threshold: number;
  weight: number;
  /** Signer keys of this account with a verified signature on the transaction. */
  signedBy: string[];
  /** False when the account's signers could not be loaded; the check cannot pass then. */
  known: boolean;
}

export interface SignatureStatus {
  requirements: SignatureRequirement[];
  ready: boolean;
}

const LEVEL_RANK: Record<ThresholdLevel, number> = { low: 0, med: 1, high: 2 };
const maxLevel = (a: ThresholdLevel, b: ThresholdLevel) => (LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b);

const LOW_OPS = new Set([
  'allowTrust',
  'setTrustLineFlags',
  'bumpSequence',
  'claimClaimableBalance',
  'extendFootprintTtl',
  'restoreFootprint',
]);

type OperationLike = { type: string; source?: string } & Record<string, unknown>;

const isSet = (value: unknown) => value !== undefined && value !== null;

/** Threshold level stellar-core applies to an operation. */
export const operationThresholdLevel = (op: OperationLike): ThresholdLevel => {
  if (op.type === 'accountMerge') return 'high';
  if (op.type === 'setOptions') {
    const touchesAuth = ['signer', 'masterWeight', 'lowThreshold', 'medThreshold', 'highThreshold'].some((field) =>
      isSet(op[field]),
    );
    return touchesAuth ? 'high' : 'med';
  }
  return LOW_OPS.has(op.type) ? 'low' : 'med';
};

/** Muxed (M…) addresses sign as their underlying G… account. */
export const baseAccountId = (address: string): string => {
  if (!address.startsWith('M')) return address;
  const raw = StrKey.decodeMed25519PublicKey(address);
  return StrKey.encodeEd25519PublicKey(raw.subarray(0, 32));
};

interface SignedPart {
  hash: Uint8Array;
  signatures: xdr.DecoratedSignature[];
  /** Account -> threshold level it must meet with these signatures. */
  levels: Map<string, ThresholdLevel>;
}

const signedParts = (tx: Transaction | FeeBumpTransaction): SignedPart[] => {
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  const levels = new Map<string, ThresholdLevel>();
  const txSource = baseAccountId(inner.source);
  levels.set(txSource, 'low');
  for (const op of inner.operations as unknown as OperationLike[]) {
    const account = op.source ? baseAccountId(op.source) : txSource;
    levels.set(account, maxLevel(levels.get(account) ?? 'low', operationThresholdLevel(op)));
  }
  const parts: SignedPart[] = [{ hash: inner.hash(), signatures: inner.signatures, levels }];
  if (tx instanceof FeeBumpTransaction) {
    parts.push({
      hash: tx.hash(),
      signatures: tx.signatures,
      levels: new Map([[baseAccountId(tx.feeSource), 'low' as ThresholdLevel]]),
    });
  }
  return parts;
};

/** Every account whose signers must be known to judge the transaction. */
export const involvedAccounts = (tx: Transaction | FeeBumpTransaction): string[] => [
  ...new Set(signedParts(tx).flatMap((part) => [...part.levels.keys()])),
];

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Signer keys that have a valid signature (or pre-authorisation) for this hash. */
export const verifiedSignerKeys = (
  hash: Uint8Array,
  signatures: xdr.DecoratedSignature[],
  signers: SignerInfo[],
): string[] => {
  const signed: string[] = [];
  for (const signer of signers) {
    if (signer.weight <= 0) continue;
    try {
      if (signer.key.startsWith('G')) {
        const keypair = Keypair.fromPublicKey(signer.key);
        const hint = keypair.signatureHint();
        if (signatures.some((sig) => sameBytes(sig.hint.value, hint) && keypair.verify(hash, sig.signature.value))) {
          signed.push(signer.key);
        }
      } else if (signer.key.startsWith('T')) {
        // A pre-authorised transaction needs no signature: its hash is the signer.
        if (sameBytes(StrKey.decodePreAuthTx(signer.key), hash)) signed.push(signer.key);
      } else if (signer.key.startsWith('X')) {
        // Hash(x) signers are satisfied by revealing x as the "signature".
        const expected = StrKey.decodeSha256Hash(signer.key);
        if (signatures.some((sig) => sameBytes(sha256(sig.signature.value), expected))) signed.push(signer.key);
      }
      // Signed-payload (P…) signers are not counted: we cannot tell which payload was signed.
    } catch {
      // Malformed key or signature: it cannot count towards the threshold.
    }
  }
  return signed;
};

const thresholdFor = (account: AccountAuth, level: ThresholdLevel) =>
  ({ low: account.thresholds.low_threshold, med: account.thresholds.med_threshold, high: account.thresholds.high_threshold })[
    level
  ];

/**
 * Check a transaction against the signers and thresholds of every account it involves.
 * Accounts missing from `accounts` are reported as unknown and keep the transaction not ready.
 */
export const computeSignatureStatus = (
  tx: Transaction | FeeBumpTransaction,
  accounts: ReadonlyMap<string, AccountAuth>,
): SignatureStatus => {
  const requirements: SignatureRequirement[] = [];
  for (const part of signedParts(tx)) {
    for (const [accountId, level] of part.levels) {
      const account = accounts.get(accountId);
      if (!account) {
        requirements.push({ account: accountId, level, threshold: 1, weight: 0, signedBy: [], known: false });
        continue;
      }
      const signedBy = verifiedSignerKeys(part.hash, part.signatures, account.signers);
      const weight = signedBy.reduce(
        (sum, key) => sum + (account.signers.find((s) => s.key === key)?.weight ?? 0),
        0,
      );
      const threshold = Math.max(thresholdFor(account, level), 1);
      requirements.push({ account: accountId, level, threshold, weight, signedBy, known: true });
    }
  }
  return { requirements, ready: requirements.every((r) => r.known && r.weight >= r.threshold) };
};
