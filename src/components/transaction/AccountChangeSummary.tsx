import { AlertTriangle, ArrowRight, ExternalLink, Info, Minus, Plus, Shield, TrendingDown, TrendingUp, Users } from 'lucide-react';
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

const CHANGE_STYLE: Record<
  SignerChangeKind,
  { icon: typeof Plus; label: string; tint: string; accent: string; rail: string }
> = {
  added: { icon: Plus, label: 'New signer', tint: 'bg-success/10 ring-success/30', accent: 'text-success', rail: 'bg-success' },
  removed: { icon: Minus, label: 'Removed', tint: 'bg-destructive/10 ring-destructive/30', accent: 'text-destructive', rail: 'bg-destructive' },
  'weight-raised': { icon: TrendingUp, label: 'More weight', tint: 'bg-warning/10 ring-warning/30', accent: 'text-warning', rail: 'bg-warning' },
  'weight-lowered': { icon: TrendingDown, label: 'Less weight', tint: 'bg-warning/10 ring-warning/30', accent: 'text-warning', rail: 'bg-warning' },
  'weight-set': { icon: Users, label: 'Weight set', tint: 'bg-secondary ring-border', accent: 'text-muted-foreground', rail: 'bg-border' },
};

const WARNING_STYLE: Record<
  InterpretationWarning['severity'],
  { wrap: string; accent: string; icon: typeof AlertTriangle }
> = {
  critical: { wrap: 'border-destructive/40 bg-destructive/10', accent: 'text-destructive', icon: AlertTriangle },
  warning: { wrap: 'border-warning/40 bg-warning/5', accent: 'text-warning', icon: AlertTriangle },
  info: { wrap: 'border-border/60 bg-secondary/30', accent: 'text-muted-foreground', icon: Info },
};

/** Hash-based signers are not addresses, so they get a label rather than a truncated key. */
const KEY_KINDS: Record<string, string> = {
  preauth: 'Pre-authorised tx',
  hashx: 'Hash(x) signer',
  payload: 'Signed payload',
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
  const [prefix, hashValue] = signerKey.split(':');
  const isAddress = hashValue === undefined;
  const text = isAddress
    ? shortenAddress(signerKey, 8, 8)
    : `${KEY_KINDS[prefix] ?? prefix}: ${shortenAddress(hashValue, 6, 6)}`;

  const body = (
    <>
      <span className="font-mono text-xs break-all">{text}</span>
      {isMasterKey && <span className="text-[11px] text-muted-foreground">master key</span>}
    </>
  );

  if (!isAddress || !linkable) {
    return <span className="inline-flex items-center gap-1.5 min-w-0">{body}</span>;
  }

  return (
    <a
      href={`https://stellar.expert/explorer/${network === 'testnet' ? 'testnet' : 'public'}/account/${signerKey}`}
      target="_blank"
      rel="noopener noreferrer"
      title={signerKey}
      className="group inline-flex items-center gap-1.5 min-w-0 hover:text-primary transition-colors"
    >
      {body}
      <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
    </a>
  );
};

/** `1 → 2` — the shape that makes a weight change readable at a glance. */
const WeightDelta = ({ before, after }: { before?: number; after: number }) => (
  <span className="inline-flex items-center gap-1.5 tabular-nums text-sm shrink-0">
    {before !== undefined && (
      <>
        <span className="text-muted-foreground">{before}</span>
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
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
    <li className="relative flex items-center gap-3 py-2.5 pl-3 pr-1">
      <span className={cn('absolute left-0 top-2 bottom-2 w-0.5 rounded-full', style.rail)} aria-hidden />
      <span className={cn('w-6 h-6 rounded-md flex items-center justify-center shrink-0 ring-1', style.tint)}>
        <Icon className={cn('w-3.5 h-3.5', style.accent)} />
      </span>
      <span className="min-w-0 flex-1">
        <SignerName signerKey={change.key} isMasterKey={change.isMasterKey} network={network} linkable={linkable} />
      </span>
      <WeightDelta before={change.before} after={change.after} />
      <Badge variant="outline" className={cn('text-[11px] shrink-0 ml-1 hidden sm:inline-flex', style.accent)}>
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
  const hasChanges = signerChanges.length > 0 || thresholdChanges.length > 0;
  const linkable = !offlineMode;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 space-y-5">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-lg bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-primary" />
        </span>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">What this transaction does</p>
          <p className="font-semibold leading-snug">{headline}</p>
        </div>
      </div>

      {warnings.map((warning, i) => {
        const style = WARNING_STYLE[warning.severity];
        const Icon = style.icon;
        return (
          <div key={i} className={cn('rounded-lg border p-3 flex items-start gap-2', style.wrap)}>
            <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', style.accent)} />
            <div className="min-w-0 text-sm">
              <p className={cn('font-medium', style.accent)}>{warning.title}</p>
              <p className="text-muted-foreground mt-0.5">{warning.detail}</p>
            </div>
          </div>
        );
      })}

      {signerChanges.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Signers</p>
            <p className="text-[11px] text-muted-foreground">weight before → after</p>
          </div>
          <ul className="divide-y divide-border/50">
            {signerChanges.map((change) => (
              <SignerRow key={change.key} change={change} network={network} linkable={linkable} />
            ))}
          </ul>
        </div>
      )}

      {thresholdChanges.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Signatures required</p>
          <dl className="text-sm">
            {thresholdChanges.map((change) => (
              <div
                key={change.level}
                className="flex items-baseline justify-between gap-3 py-2 border-b border-border/50 last:border-0"
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
          <p className="text-[11px] text-muted-foreground pt-1">
            These are combined signer weights, not signer counts.
          </p>
        </div>
      )}

      {otherChanges.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {otherChanges.map((line, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-muted-foreground mt-2 w-1 h-1 rounded-full bg-current shrink-0" aria-hidden />
              <span className="min-w-0">{line}</span>
            </li>
          ))}
        </ul>
      )}

      {hasChanges && resultingSigners && resultingThresholds && resultingTotalWeight !== null && (
        <div className="rounded-lg bg-secondary/40 p-3 space-y-2.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Afterwards</p>
          <p className="text-sm">
            {resultingSigners.length} signer{resultingSigners.length === 1 ? '' : 's'} with a combined weight of{' '}
            <span className="font-semibold tabular-nums">{resultingTotalWeight}</span>.
          </p>
          <ul className="space-y-1">
            {resultingSigners.map((signer) => (
              <li key={signer.key} className="flex items-center justify-between gap-3 text-sm">
                <SignerName signerKey={signer.key} network={network} linkable={linkable} />
                <span className="tabular-nums text-muted-foreground shrink-0">weight {signer.weight}</span>
              </li>
            ))}
          </ul>
          <ul className="space-y-1 text-sm pt-1 border-t border-border/50">
            {requirements.map((req) => (
              <li key={req.level} className="flex items-start gap-2 pt-1">
                <span className="text-muted-foreground shrink-0">{THRESHOLD_LABELS[req.level].name}:</span>
                <span className="min-w-0">
                  {req.minSigners === null ? (
                    <span className="text-destructive font-medium">
                      impossible — no combination of signers reaches {req.threshold}
                    </span>
                  ) : req.minSigners === 0 ? (
                    <>no signature required</>
                  ) : req.anyCombination ? (
                    <>
                      any <span className="font-medium">{req.minSigners}</span> of these {resultingSigners.length}
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
