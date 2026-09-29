/**
 * Plain-language description of every operation and of the transaction-level settings that
 * decide when and how it can land (fee, validity, sequence number, memo).
 *
 * Co-signers never built the transaction they review, so nothing that changes the outcome
 * may hide in raw JSON: each operation gets a one-line summary with its counterparty and
 * amounts, and anything unusual gets a notice.
 */
import { Decimal } from 'decimal.js';
import { FeeBumpTransaction, SignerKey, type Transaction } from '@stellar/stellar-sdk';
import { appConfig } from '@/lib/appConfig';
import { baseAccountId } from '@/lib/signatures';
import { decodeUtf8, isAscii, revealUnsafeChars, toHex } from '@/lib/text';
import type { NetworkId } from './parse';

export type NoticeSeverity = 'critical' | 'warning' | 'info';

export interface Notice {
  severity: NoticeSeverity;
  text: string;
}

export interface Field {
  label: string;
  value: string;
  /** Addresses, hashes and other values that must be read character by character. */
  mono?: boolean;
}

export interface OperationView {
  summary: string;
  fields: Field[];
  notices: Notice[];
}

/** 8+8 characters: a look-alike address matching that much cannot be ground out. */
export const shortAddress = (address: string): string =>
  address.length > 20 ? `${address.slice(0, 8)}…${address.slice(-8)}` : address;

type AssetLike = {
  code?: string;
  issuer?: string;
  assetA?: AssetLike;
  assetB?: AssetLike;
};

const isNative = (asset: AssetLike) => !asset.assetA && !asset.issuer && (!asset.code || asset.code === 'XLM');

/**
 * Asset code plus issuer: anyone can issue a token called "USDC", so the code alone never
 * identifies an asset.
 */
export const assetLabel = (asset: AssetLike | undefined): string => {
  if (!asset) return 'an unknown asset';
  if (asset.assetA && asset.assetB) return `pool shares ${assetLabel(asset.assetA)} / ${assetLabel(asset.assetB)}`;
  if (isNative(asset)) return 'XLM';
  return asset.issuer ? `${asset.code} (${shortAddress(asset.issuer)})` : (asset.code ?? 'an unknown asset');
};

/** Well-known codes on someone else's issuer. */
const assetNotices = (asset: AssetLike | undefined, network: NetworkId): Notice[] => {
  if (!asset?.issuer || !asset.code) return [];
  if (asset.code === 'XLM') {
    return [{ severity: 'critical', text: `This "XLM" is a token issued by ${shortAddress(asset.issuer)}, not the native lumen.` }];
  }
  if (network === 'mainnet' && asset.code === 'USDC' && asset.issuer !== appConfig.USDC_ISSUER_MAINNET) {
    return [{ severity: 'critical', text: `This USDC is not Circle's: it is issued by ${shortAddress(asset.issuer)}.` }];
  }
  return [];
};

const issuerFields = (...assets: (AssetLike | undefined)[]): Field[] => {
  const seen = new Set<string>();
  const fields: Field[] = [];
  for (const asset of assets.flatMap((a) => (a?.assetA ? [a.assetA, a.assetB] : [a]))) {
    if (!asset?.issuer || seen.has(`${asset.code}:${asset.issuer}`)) continue;
    seen.add(`${asset.code}:${asset.issuer}`);
    fields.push({ label: `${asset.code} issuer`, value: asset.issuer, mono: true });
  }
  return fields;
};

/** "10.0000000" → "10", "1e-7" → "0.0000001". */
const amount = (value: unknown): string => {
  try {
    return new Decimal(String(value)).toFixed();
  } catch {
    return String(value);
  }
};

const product = (a: unknown, b: unknown): string => {
  try {
    return new Decimal(String(a)).mul(new Decimal(String(b))).toDecimalPlaces(7).toFixed();
  } catch {
    return '?';
  }
};

const MUXED_NOTE = (address: string): Notice => ({
  severity: 'info',
  text: `${shortAddress(address)} is a muxed address: it is the account ${shortAddress(baseAccountId(address))}.`,
});

const counterparty = (label: string, address: string | undefined): { field: Field; notices: Notice[] } => ({
  field: { label, value: address ?? 'not set', mono: true },
  notices: address?.startsWith('M') ? [MUXED_NOTE(address)] : [],
});

/** Data entry and similar raw bytes: text when they are text, hex otherwise. */
const readableBytes = (value: unknown): { text: string; unsafe: boolean } => {
  if (value === undefined || value === null) return { text: '', unsafe: false };
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  const decoded = decodeUtf8(bytes);
  if (decoded === null) return { text: `0x${toHex(bytes)}`, unsafe: false };
  return revealUnsafeChars(decoded);
};

const unsafeTextNotice = (what: string): Notice => ({
  severity: 'warning',
  text: `${what} contains invisible or direction-changing characters, shown as ⟨U+…⟩.`,
});

/** Sequence numbers this far ahead leave the account unable to send another transaction. */
const SEQUENCE_DANGER = 1n << 62n;

type Op = Record<string, unknown> & { type: string; source?: string };

export const describeOperation = (operation: unknown, network: NetworkId): OperationView => {
  const op = operation as Op;
  const fields: Field[] = [];
  const notices: Notice[] = [];
  const addParty = (label: string, address: unknown) => {
    const party = counterparty(label, address as string | undefined);
    fields.push(party.field);
    notices.push(...party.notices);
  };
  const a = (key: string) => op[key] as AssetLike | undefined;
  let summary: string;

  switch (op.type) {
    case 'createAccount':
      summary = `Create account ${shortAddress(String(op.destination))} with ${amount(op.startingBalance)} XLM`;
      addParty('New account', op.destination);
      fields.push({ label: 'Starting balance', value: `${amount(op.startingBalance)} XLM` });
      break;
    case 'payment':
      summary = `Pay ${amount(op.amount)} ${assetLabel(a('asset'))} to ${shortAddress(String(op.destination))}`;
      addParty('To', op.destination);
      fields.push({ label: 'Amount', value: `${amount(op.amount)} ${assetLabel(a('asset'))}` }, ...issuerFields(a('asset')));
      notices.push(...assetNotices(a('asset'), network));
      break;
    case 'pathPaymentStrictSend':
    case 'pathPaymentStrictReceive': {
      const strictSend = op.type === 'pathPaymentStrictSend';
      const send = `${amount(strictSend ? op.sendAmount : op.sendMax)} ${assetLabel(a('sendAsset'))}`;
      const receive = `${amount(strictSend ? op.destMin : op.destAmount)} ${assetLabel(a('destAsset'))}`;
      summary = strictSend
        ? `Send ${send}; ${shortAddress(String(op.destination))} receives at least ${receive}`
        : `Send at most ${send}; ${shortAddress(String(op.destination))} receives ${receive}`;
      addParty('To', op.destination);
      fields.push(
        { label: strictSend ? 'Send' : 'Send at most', value: send },
        { label: strictSend ? 'Receive at least' : 'Receive', value: receive },
      );
      const path = (op.path as AssetLike[] | undefined) ?? [];
      if (path.length) fields.push({ label: 'Through', value: path.map(assetLabel).join(' → ') });
      fields.push(...issuerFields(a('sendAsset'), a('destAsset'), ...path));
      notices.push(...assetNotices(a('sendAsset'), network), ...assetNotices(a('destAsset'), network));
      break;
    }
    case 'manageSellOffer':
    case 'createPassiveSellOffer':
    case 'manageBuyOffer': {
      const buy = op.type === 'manageBuyOffer';
      const offered = buy ? op.buyAmount : op.amount;
      const selling = assetLabel(a('selling'));
      const buying = assetLabel(a('buying'));
      const offerId = String(op.offerId ?? '0');
      if (amount(offered) === '0') {
        summary = `Cancel offer ${offerId}`;
      } else if (buy) {
        summary = `Offer to buy ${amount(offered)} ${buying} for up to ${product(offered, op.price)} ${selling}`;
      } else {
        summary = `Offer to sell ${amount(offered)} ${selling} for ${product(offered, op.price)} ${buying}`;
      }
      fields.push(
        { label: 'Selling', value: selling },
        { label: 'Buying', value: buying },
        { label: buy ? 'Buy amount' : 'Sell amount', value: amount(offered) },
        { label: 'Price', value: buy ? `${amount(op.price)} ${selling} per ${buying}` : `${amount(op.price)} ${buying} per ${selling}` },
        { label: 'Offer', value: offerId === '0' ? 'new' : offerId },
        ...issuerFields(a('selling'), a('buying')),
      );
      notices.push(...assetNotices(a('selling'), network), ...assetNotices(a('buying'), network));
      break;
    }
    case 'changeTrust': {
      const line = a('line');
      const removes = amount(op.limit) === '0';
      summary = removes ? `Remove the trustline to ${assetLabel(line)}` : `Trust ${assetLabel(line)}`;
      fields.push({ label: 'Asset', value: assetLabel(line) }, { label: 'Limit', value: removes ? '0' : amount(op.limit) }, ...issuerFields(line));
      notices.push(...assetNotices(line, network));
      break;
    }
    case 'allowTrust': {
      const level = Number(op.authorize);
      const verb = level === 1 ? 'Authorise' : level === 2 ? 'Authorise (liabilities only)' : 'Revoke authorisation of';
      summary = `${verb} ${shortAddress(String(op.trustor))} for ${String(op.assetCode)}`;
      addParty('Trustor', op.trustor);
      break;
    }
    case 'setTrustLineFlags': {
      const flags = (op.flags ?? {}) as Record<string, boolean | undefined>;
      const names: Record<string, string> = {
        authorized: 'authorised',
        authorizedToMaintainLiabilities: 'authorised to keep liabilities',
        clawbackEnabled: 'clawback enabled',
      };
      const changes = Object.entries(flags)
        .filter(([, value]) => value !== undefined)
        .map(([flag, value]) => `${value ? 'set' : 'clear'} ${names[flag] ?? flag}`);
      summary = `Change the trustline of ${shortAddress(String(op.trustor))} to ${assetLabel(a('asset'))}: ${changes.join(', ') || 'no change'}`;
      addParty('Trustor', op.trustor);
      fields.push(...issuerFields(a('asset')));
      break;
    }
    case 'accountMerge':
      summary = `Close this account and send all its XLM to ${shortAddress(String(op.destination))}`;
      addParty('Into', op.destination);
      notices.push({ severity: 'critical', text: 'The account is closed and all its XLM goes to the destination.' });
      break;
    case 'manageData': {
      const name = revealUnsafeChars(String(op.name ?? ''));
      const value = readableBytes(op.value);
      summary = op.value === undefined || op.value === null ? `Delete data entry "${name.text}"` : `Set data entry "${name.text}"`;
      fields.push({ label: 'Name', value: name.text });
      if (value.text) fields.push({ label: 'Value', value: value.text, mono: true });
      if (name.unsafe || value.unsafe) notices.push(unsafeTextNotice('The data entry'));
      if (String(op.name) === 'config.memo_required') {
        notices.push({ severity: 'info', text: 'Payments to this account will require a memo.' });
      }
      break;
    }
    case 'bumpSequence': {
      const bumpTo = BigInt(String(op.bumpTo));
      summary = `Move the sequence number to ${bumpTo}`;
      notices.push({ severity: 'warning', text: 'Transactions already signed for this account with a lower sequence number stop being valid.' });
      if (bumpTo >= SEQUENCE_DANGER) {
        notices.push({ severity: 'critical', text: 'This is close to the maximum: afterwards the account may never be able to send a transaction again.' });
      }
      break;
    }
    case 'createClaimableBalance': {
      const claimants = (op.claimants as { destination: string; predicate?: { type?: string } }[] | undefined) ?? [];
      summary = `Lock ${amount(op.amount)} ${assetLabel(a('asset'))} for ${claimants.map((c) => shortAddress(c.destination)).join(', ')} to claim`;
      fields.push({ label: 'Amount', value: `${amount(op.amount)} ${assetLabel(a('asset'))}` }, ...issuerFields(a('asset')));
      for (const claimant of claimants) {
        const unconditional = claimant.predicate?.type === 'claimPredicateUnconditional';
        fields.push({ label: unconditional ? 'Claimable by' : 'Claimable (with conditions) by', value: claimant.destination, mono: true });
      }
      notices.push(...assetNotices(a('asset'), network));
      break;
    }
    case 'claimClaimableBalance':
      summary = 'Claim a claimable balance';
      fields.push({ label: 'Balance', value: String(op.balanceId), mono: true });
      break;
    case 'clawback':
      summary = `Claw back ${amount(op.amount)} ${assetLabel(a('asset'))} from ${shortAddress(String(op.from))}`;
      addParty('From', op.from);
      fields.push(...issuerFields(a('asset')));
      break;
    case 'clawbackClaimableBalance':
      summary = 'Claw back a claimable balance';
      fields.push({ label: 'Balance', value: String(op.balanceId), mono: true });
      break;
    case 'beginSponsoringFutureReserves':
      summary = `Pay the reserves of ${shortAddress(String(op.sponsoredId))} until it ends the sponsorship`;
      addParty('Sponsored account', op.sponsoredId);
      notices.push({ severity: 'info', text: 'Your account pays the minimum balance for what the sponsored account creates.' });
      break;
    case 'endSponsoringFutureReserves':
      summary = 'End the reserve sponsorship started earlier in this transaction';
      break;
    case 'revokeAccountSponsorship':
    case 'revokeTrustlineSponsorship':
    case 'revokeOfferSponsorship':
    case 'revokeDataSponsorship':
    case 'revokeClaimableBalanceSponsorship':
    case 'revokeLiquidityPoolSponsorship':
    case 'revokeSignerSponsorship': {
      const what = op.type.replace(/^revoke|Sponsorship$/g, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
      summary = `Stop sponsoring the reserve of a ${what}`;
      const account = (op.account ?? op.seller) as string | undefined;
      if (account) addParty('Account', account);
      if (op.asset) fields.push({ label: 'Asset', value: assetLabel(a('asset')) });
      if (op.name) fields.push({ label: 'Data entry', value: revealUnsafeChars(String(op.name)).text });
      if (op.balanceId) fields.push({ label: 'Balance', value: String(op.balanceId), mono: true });
      if (op.liquidityPoolId) fields.push({ label: 'Pool', value: String(op.liquidityPoolId), mono: true });
      break;
    }
    case 'liquidityPoolDeposit':
      summary = `Deposit up to ${amount(op.maxAmountA)} and ${amount(op.maxAmountB)} into a liquidity pool`;
      fields.push(
        { label: 'Pool', value: String(op.liquidityPoolId), mono: true },
        { label: 'Price range', value: `${amount(op.minPrice)} to ${amount(op.maxPrice)}` },
      );
      break;
    case 'liquidityPoolWithdraw':
      summary = `Withdraw ${amount(op.amount)} pool shares for at least ${amount(op.minAmountA)} and ${amount(op.minAmountB)}`;
      fields.push({ label: 'Pool', value: String(op.liquidityPoolId), mono: true });
      break;
    case 'invokeHostFunction':
      summary = 'Smart contract call, decoded in Smart Contract Activity';
      break;
    case 'extendFootprintTtl':
      summary = `Keep contract data alive for ${String(op.extendTo)} more ledgers`;
      break;
    case 'restoreFootprint':
      summary = 'Restore archived contract data';
      break;
    case 'setOptions':
      summary = 'Change account settings';
      if (op.homeDomain !== undefined && op.homeDomain !== null) {
        const domain = revealUnsafeChars(String(op.homeDomain));
        fields.push({ label: 'Home domain', value: domain.text || '(cleared)' });
        if (domain.unsafe) notices.push(unsafeTextNotice('The home domain'));
      }
      if (op.inflationDest) addParty('Inflation destination', op.inflationDest);
      break;
    default:
      summary = op.type;
      notices.push({ severity: 'warning', text: 'This app does not decode this operation. Check the raw data before signing.' });
  }

  if (op.source?.startsWith('M')) notices.push(MUXED_NOTE(op.source));
  return { summary, fields, notices };
};

export interface MemoView {
  type: string;
  text: string;
  /** Raw bytes, shown whenever the text is not plain ASCII. */
  hex?: string;
}

export interface TransactionView {
  fee: { total: string; resource?: string; inclusion?: string };
  validity: Field[];
  memo?: MemoView;
  notices: Notice[];
}

interface Bounds {
  minTime: bigint;
  maxTime: bigint;
}

/**
 * The preconditions as encoded. SDK getters drop some of them (a minimum sequence number of
 * 0 reads as "none"), so read the envelope itself.
 */
interface RawPreconditions {
  timeBounds: Bounds | null;
  ledgerBounds: { minLedger: number; maxLedger: number } | null;
  minSeqNum: bigint | null;
  minSeqAge: bigint;
  minSeqLedgerGap: number;
  extraSigners: unknown[];
}

const readPreconditions = (inner: Transaction): RawPreconditions => {
  const envelope = inner.toEnvelope() as unknown as {
    v1?: { tx: { cond: { type: string; timeBounds?: Bounds; v2?: RawPreconditions } } };
  };
  const cond = envelope.v1?.tx.cond;
  if (cond?.type === 'precondV2' && cond.v2) return cond.v2;
  const timeBounds =
    cond?.type === 'precondTime' && cond.timeBounds
      ? cond.timeBounds
      : inner.timeBounds
        ? { minTime: BigInt(inner.timeBounds.minTime), maxTime: BigInt(inner.timeBounds.maxTime) }
        : null;
  return { timeBounds, ledgerBounds: null, minSeqNum: null, minSeqAge: 0n, minSeqLedgerGap: 0, extraSigners: [] };
};

const resourceFeeOf = (inner: Transaction): bigint | null => {
  const envelope = inner.toEnvelope() as unknown as { v1?: { tx: { ext?: { sorobanData?: { resourceFee: bigint } } } } };
  const fee = envelope.v1?.tx.ext?.sorobanData?.resourceFee;
  return fee === undefined ? null : BigInt(fee);
};

const xlm = (stroops: bigint): string => new Decimal(stroops.toString()).div(1e7).toFixed();

/** Same ceiling verify.ts applies to API-built transactions. */
const HIGH_FEE_STROOPS = 100_000_000n;

const time = (seconds: bigint): string => new Date(Number(seconds) * 1000).toLocaleString();

const memoView = (memo: Transaction['memo'], notices: Notice[]): MemoView | undefined => {
  if (!memo || memo.type === 'none') return undefined;
  const { value } = memo as { value: unknown };
  if (memo.type === 'text') {
    const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value ?? ''));
    const decoded = decodeUtf8(bytes);
    if (decoded === null) {
      notices.push({ severity: 'warning', text: 'The memo is not valid text. Its bytes are shown instead.' });
      return { type: 'text', text: '', hex: toHex(bytes) };
    }
    const shown = revealUnsafeChars(decoded);
    if (shown.unsafe) notices.push(unsafeTextNotice('The memo'));
    return { type: 'text', text: shown.text, hex: isAscii(decoded) ? undefined : toHex(bytes) };
  }
  if (value instanceof Uint8Array) return { type: memo.type, text: toHex(value) };
  return { type: memo.type, text: String(value ?? '') };
};

export const describeTransaction = (
  tx: Transaction | FeeBumpTransaction,
  context: {
    /** The source account's current state, when known (not on an air-gapped device). */
    account?: { publicKey: string; sequence?: string } | null;
    now?: number;
  } = {},
): TransactionView => {
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  const notices: Notice[] = [];
  const now = BigInt(Math.floor((context.now ?? Date.now()) / 1000));

  // Fee: the whole amount the source (or the fee-bump payer) can be charged.
  const total = BigInt(tx.fee);
  const resourceFee = resourceFeeOf(inner);
  const fee = {
    total: xlm(total),
    ...(resourceFee !== null ? { resource: xlm(resourceFee), inclusion: xlm(BigInt(inner.fee) - resourceFee) } : {}),
  };
  if (total > HIGH_FEE_STROOPS) {
    notices.push({ severity: 'warning', text: `The fee can be up to ${xlm(total)} XLM. Ordinary transactions cost a small fraction of one XLM.` });
  }

  // When it can land.
  const pre = readPreconditions(inner);
  const validity: Field[] = [];
  const bounds = pre.timeBounds;
  validity.push({ label: 'Valid from', value: bounds && bounds.minTime > 0n ? time(bounds.minTime) : 'now' });
  validity.push({ label: 'Valid until', value: bounds && bounds.maxTime > 0n ? time(bounds.maxTime) : 'no expiry' });
  if (!bounds || bounds.maxTime === 0n) {
    notices.push({ severity: 'warning', text: 'This transaction never expires: it can be submitted at any time until its sequence number is used.' });
  } else if (bounds.maxTime < now) {
    notices.push({ severity: 'warning', text: 'Expired: the network will reject it. Build it again.' });
  }
  if (bounds && bounds.minTime > now) {
    notices.push({ severity: 'info', text: `It cannot be submitted before ${time(bounds.minTime)}.` });
  }
  if (pre.ledgerBounds) {
    const { minLedger, maxLedger } = pre.ledgerBounds;
    validity.push({ label: 'Ledgers', value: `${minLedger || 'any'} to ${maxLedger || 'any'}` });
  }
  if (pre.minSeqNum !== null) {
    validity.push({ label: 'Minimum account sequence', value: pre.minSeqNum.toString() });
    notices.push({
      severity: 'critical',
      text:
        `It can land whenever the account's sequence number is between ${pre.minSeqNum} and ${BigInt(inner.sequence) - 1n}, ` +
        'and then moves it to this transaction\'s number. It stays valid after the account sends other transactions.',
    });
  }
  if (pre.minSeqAge > 0n) validity.push({ label: 'Minimum sequence age', value: `${pre.minSeqAge} s` });
  if (pre.minSeqLedgerGap > 0) validity.push({ label: 'Minimum ledger gap', value: String(pre.minSeqLedgerGap) });
  for (const signer of pre.extraSigners) {
    let key: string;
    try {
      key = SignerKey.encodeSignerKey(signer as Parameters<typeof SignerKey.encodeSignerKey>[0]);
    } catch {
      key = 'unreadable';
    }
    validity.push({ label: 'Also requires a signature from', value: key, mono: true });
    notices.push({ severity: 'warning', text: `It also needs a signature from ${shortAddress(key)}, whatever the account's signers are.` });
  }

  // The sequence number decides whether it is valid now, later, or never.
  const sequence = BigInt(inner.sequence);
  validity.push({ label: 'Sequence', value: sequence.toString() });
  if (sequence >= SEQUENCE_DANGER) {
    notices.push({
      severity: 'critical',
      text: 'The sequence number is close to the maximum: once this lands, the account may never be able to send a transaction again.',
    });
  }
  const source = baseAccountId(inner.source);
  if (context.account?.sequence && context.account.publicKey === source) {
    const current = BigInt(context.account.sequence);
    if (sequence <= current) {
      notices.push({ severity: 'warning', text: `The account has already used sequence ${sequence} (it is at ${current}). The network will reject this transaction.` });
    } else if (sequence > current + 1n && (pre.minSeqNum === null || pre.minSeqNum > current)) {
      notices.push({
        severity: 'warning',
        text: `It cannot land yet: the account (at ${current}) must first send ${sequence - current - 1n} other transaction(s).`,
      });
    }
  }
  if (inner.source.startsWith('M')) notices.push(MUXED_NOTE(inner.source));

  return { fee, validity, memo: memoView(inner.memo, notices), notices };
};

/** Critical first, so the worst news is read first. */
export const bySeverity = (a: Notice, b: Notice): number => {
  const rank: Record<NoticeSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return rank[a.severity] - rank[b.severity];
};

