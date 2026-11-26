import { ArrowRight, ExternalLink, Minus, Plus, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { Notice } from '@/components/brand/Shell';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { shortenAddress } from '@/lib/protocols/tokens';
import {
  THRESHOLD_LABELS,
  type InterpretationWarning,
  type SignerChange,
  type SignerChangeKind,
  type TransactionInterpretation,
} from '@/lib/xdr/interpret';

const CHANGE_STYLE: Record<SignerChangeKind, { icon: typeof Plus; label: string; accent: string; tag?: 'destructive' | 'warning' }> = {
  added: { icon: Plus, label: 'New signer', accent: 'text-foreground' },
  removed: { icon: Minus, label: 'Removed', accent: 'text-destructive', tag: 'destructive' },
  'weight-raised': { icon: TrendingUp, label: 'More weight', accent: 'text-warning', tag: 'warning' },
  'weight-lowered': { icon: TrendingDown, label: 'Less weight', accent: 'text-warning', tag: 'warning' },
  'weight-set': { icon: Users, label: 'Weight set', accent: 'text-muted-foreground' },
};

const WARNING_LEVEL: Record<InterpretationWarning['severity'], 'error' | 'warning' | 'info'> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
};

/** Hash-based signers are not addresses, so they get a label (by strkey prefix) rather than a truncated key. */
const KEY_KINDS: Record<string, string> = {
  T: 'Pre-authorized transaction',
  X: 'Hash(x) signer',
  P: 'Signed payload',
};

interface SignerNameProps {
  signerKey: string;
  isMasterKey?: boolean;
  network: 'mainnet' | 'testnet';
  /** Air-gapped signing has no network, so explorer links are pointless there. */
  linkable: boolean;
}

/** The signer's key, linked to its Stellar Expert page when there is a network to reach. */
const SignerName = ({ signerKey, isMasterKey = false, network, linkable }: SignerNameProps) => {
  const kind = KEY_KINDS[signerKey[0]];
  const isAddress = kind === undefined;
  const text = isAddress ? shortenAddress(signerKey, 8, 8) : `${kind}: ${shortenAddress(signerKey, 6, 6)}`;

  const body = (
    <>
      <span className="break-all font-address text-[13px]">{text}</span>
      {isMasterKey && <span className="text-xs text-muted-foreground">master key</span>}
    </>
  );

  if (!isAddress || !linkable) {
    return <span className="inline-flex min-w-0 items-center gap-2">{body}</span>;
  }

  return (
    <a
      href={`https://stellar.expert/explorer/${network === 'testnet' ? 'testnet' : 'public'}/account/${signerKey}`}
      target="_blank"
      rel="noopener noreferrer"
      title={signerKey}
      className="group inline-flex min-w-0 items-center gap-2 hover:underline"
    >
      {body}
      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden />
    </a>
  );
};

/** `1 → 2` — the shape that makes a weight change readable at a glance. */
const WeightDelta = ({ before, after }: { before?: number; after: number }) => (
  <span className="inline-flex shrink-0 items-center gap-2 text-sm tabular-nums">
    {before !== undefined && (
      <>
        <span className="text-muted-foreground">{before}</span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
      </>
    )}
    <span className={cn('font-semibold', after === 0 && 'text-destructive')}>{after}</span>
  </span>
);

const SignerRow = ({
  change,
  network,
  linkable,
}: {
  change: SignerChange;
  network: 'mainnet' | 'testnet';
  linkable: boolean;
}) => {
  const style = CHANGE_STYLE[change.kind];
  const Icon = style.icon;
  return (
    <li className="flex items-center gap-3 py-3">
      <Icon className={cn('h-[18px] w-[18px] shrink-0', style.accent)} aria-hidden />
      <span className="min-w-0 flex-1">
        <SignerName signerKey={change.key} isMasterKey={change.isMasterKey} network={network} linkable={linkable} />
      </span>
      <WeightDelta before={change.before} after={change.after} />
      <Badge variant={style.tag ?? 'default'} className="ml-1 hidden shrink-0 sm:inline-flex">
        {style.label}
      </Badge>
    </li>
  );
};

interface AccountChangeSummaryProps {
  interpretation: TransactionInterpretation;
  network: 'mainnet' | 'testnet';
  offlineMode?: boolean;
}

/**
 * Says, in words, what signing a `setOptions` transaction would do to the account.
 *
 * The raw operation list is accurate but unreadable: five `setOptions` entries with a weight
 * each never tell you that you are about to need two specific signatures for every payment.
 * This section replays them against the current account and states the outcome.
 */
export const AccountChangeSummary = ({ interpretation, network, offlineMode = false }: AccountChangeSummaryProps) => {
  const { headline, otherChanges, multisig, warnings } = interpretation;
  if (!multisig) return null;

  const { signerChanges, thresholdChanges, resultingSigners, resultingThresholds, resultingTotalWeight, requirements } =
    multisig;
  const heldKeys = (resultingSigners ?? []).filter((s) => s.key.startsWith('G') || s.key.startsWith('P'));
  const hasChanges = signerChanges.length > 0 || thresholdChanges.length > 0;
  const linkable = !offlineMode;

  return (
    <div className="well space-y-4">
      <div className="min-w-0">
        <p className="field-label">What this transaction does</p>
        <p className="mt-1 font-semibold leading-snug">{headline}</p>
      </div>

      {warnings.map((warning, i) => (
        <Notice key={i} level={WARNING_LEVEL[warning.severity]} title={warning.title}>
          <span className="text-muted-foreground">{warning.detail}</span>
        </Notice>
      ))}

      {signerChanges.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="field-label">Signers</p>
            <p className="text-xs text-muted-foreground">weight before → after</p>
          </div>
          <ul className="divide-y divide-line">
            {signerChanges.map((change) => (
              <SignerRow key={change.key} change={change} network={network} linkable={linkable} />
            ))}
          </ul>
        </div>
      )}

      {thresholdChanges.length > 0 && (
        <div className="space-y-1">
          <p className="field-label">Signatures required</p>
          <dl className="text-sm">
            {thresholdChanges.map((change) => (
              <div
                key={change.level}
                className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0"
              >
                <dt className="min-w-0">
                  {THRESHOLD_LABELS[change.level].name}
                  <span className="block text-xs text-muted-foreground">{THRESHOLD_LABELS[change.level].hint}</span>
                </dt>
                <dd className="shrink-0">
                  <WeightDelta before={change.before} after={change.after} />
                </dd>
              </div>
            ))}
          </dl>
          <p className="pt-1 text-xs text-muted-foreground">
            These are combined signer weights, not signer counts.
          </p>
        </div>
      )}

      {otherChanges.length > 0 && (
        <ul className="space-y-2 text-sm">
          {otherChanges.map((line, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 bg-muted-foreground" aria-hidden />
              <span className="min-w-0">{line}</span>
            </li>
          ))}
        </ul>
      )}

      {hasChanges && resultingSigners && resultingThresholds && resultingTotalWeight !== null && (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="field-label">Afterwards</p>
          <p className="text-sm">
            {heldKeys.length} key{heldKeys.length === 1 ? '' : 's'} with a combined weight of{' '}
            <span className="font-semibold tabular-nums">{resultingTotalWeight}</span>.
            {heldKeys.length < resultingSigners.length && (
              <span className="text-muted-foreground">
                {' '}Pre-authorized and hash(x) signers are listed but not counted: each works once, or for anyone.
              </span>
            )}
          </p>
          <ul className="space-y-1">
            {resultingSigners.map((signer) => (
              <li key={signer.key} className="flex items-center justify-between gap-3 text-sm">
                <SignerName signerKey={signer.key} network={network} linkable={linkable} />
                <span className="tabular-nums text-muted-foreground shrink-0">weight {signer.weight}</span>
              </li>
            ))}
          </ul>
          <ul className="space-y-1 border-t border-line pt-1 text-sm">
            {requirements.map((req) => (
              <li key={req.level} className="flex items-start gap-2 pt-1">
                <span className="text-muted-foreground shrink-0">{THRESHOLD_LABELS[req.level].name}:</span>
                <span className="min-w-0">
                  {req.minSigners === null ? (
                    <span className="text-destructive font-medium">
                      impossible — no combination of signers reaches {req.threshold}
                    </span>
                  ) : req.anyCombination ? (
                    <>
                      any <span className="font-medium">{req.minSigners}</span> of these {heldKeys.length}
                    </>
                  ) : (
                    <>
                      at least <span className="font-medium">{req.minSigners}</span>, and only certain combinations
                      reach weight {req.threshold}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
