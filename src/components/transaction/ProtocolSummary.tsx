import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  Clock,
  Droplets,
  Layers,
  Route,
  Sparkles,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { getAssetColor } from '@/lib/assets';
import { formatTokenAmount, SHARE_DECIMALS, shortenAddress } from '@/lib/protocols/tokens';
import type { AnalyzedCall, TokenAmount } from '@/lib/protocols/detect';
import { PROTOCOL_LABELS, type NetworkId } from '@/lib/protocols/registry';
import { useProtocolMetadata, type ProtocolMetadata } from '@/hooks/useProtocolMetadata';
import { ProtocolBadge, UnknownContractBadge } from './ProtocolBadge';
import { PROTOCOL_STYLE } from './protocolStyle';

/** "exactly 10" / "at least 1.81" — the guarantee the contract actually gives. */
const BOUND_LABEL: Record<TokenAmount['bound'], string> = {
  exact: 'exactly',
  min: 'at least',
  max: 'at most',
};

const TokenChip = ({ contract, meta }: { contract: string; meta: ProtocolMetadata }) => {
  const info = meta.token(contract);
  const code = info?.code ?? shortenAddress(contract, 4, 4);
  const { hue, saturation, lightness } = getAssetColor(code, info?.issuer);
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <span className="inline-flex items-center gap-1.5">
      {info?.icon && !imageFailed ? (
        <img
          src={info.icon}
          alt=""
          width={18}
          height={18}
          loading="lazy"
          className="rounded-full shrink-0"
          onError={() => setImageFailed(true)}
        />
      ) : (
        // Offline (and before the token list loads) there is no logo to show —
        // a colour swatch still makes the two sides of a swap easy to tell apart.
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-inset ring-white/20"
          style={{ background: `hsl(${hue} ${saturation}% ${lightness}%)` }}
          aria-hidden
        />
      )}
      <span className={cn('font-semibold', !info && 'font-mono text-xs')}>{code}</span>
    </span>
  );
};

/** The headline number in a swap/deposit leg. */
const AmountLeg = ({
  label,
  amount,
  meta,
}: {
  label: string;
  amount: TokenAmount;
  meta: ProtocolMetadata;
}) => (
  <div className="min-w-0 space-y-1">
    <p className="text-xs text-muted-foreground">
      {label} <span className="opacity-70">({BOUND_LABEL[amount.bound]})</span>
    </p>
    <div className="flex items-baseline gap-2 flex-wrap">
      <span className="text-xl sm:text-2xl font-bold tabular-nums break-all">
        {meta.amount(amount.raw, amount.contract)}
      </span>
      <TokenChip contract={amount.contract} meta={meta} />
    </div>
    {meta.isAssumed(amount.contract) && (
      <p className="text-[11px] text-warning/90" title={amount.contract}>
        Decimals not confirmed — shown at 7 dp
      </p>
    )}
  </div>
);

const Fact = ({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Clock;
  label: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-start gap-2 text-sm min-w-0">
    <Icon className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
    <span className="text-muted-foreground shrink-0">{label}</span>
    <span className="min-w-0 break-words">{children}</span>
  </div>
);

const Address = ({ value }: { value: string }) => (
  <span className="font-mono text-xs break-all">{shortenAddress(value, 8, 8)}</span>
);

/**
 * Wall-clock time, sampled on a timer rather than during render. Collecting
 * multisig signatures takes minutes, so a deadline can lapse while the card is
 * on screen — this makes it flip without a reload.
 */
const useNow = (intervalMs = 30_000): number | null => {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const immediate = window.setTimeout(tick, 0);
    const interval = window.setInterval(tick, intervalMs);
    return () => {
      window.clearTimeout(immediate);
      window.clearInterval(interval);
    };
  }, [intervalMs]);

  return now;
};

const Deadline = ({ deadline }: { deadline: number }) => {
  const now = useNow();
  const at = new Date(deadline * 1000);
  const expired = now !== null && at.getTime() < now;
  return (
    <span className={expired ? 'text-destructive font-medium' : undefined}>
      {at.toLocaleString()}
      {expired && ' — already expired'}
    </span>
  );
};

/** Human-readable value for one decoded contract argument. */
const ArgValue = ({ value }: { value: unknown }) => {
  if (value === undefined) return <span className="text-muted-foreground italic">not decodable</span>;
  if (typeof value === 'boolean') return <span>{value ? 'yes' : 'no'}</span>;
  if (typeof value === 'number') return <span className="tabular-nums">{value}</span>;
  if (typeof value === 'string') {
    if (/^[GC][A-Z2-7]{55}$/.test(value)) return <Address value={value} />;
    if (/^-?\d+$/.test(value)) return <span className="tabular-nums">{value}</span>;
    return <span className="break-all">{value}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <span className="flex flex-col gap-0.5">
        {value.map((item, i) => (
          <ArgValue key={i} value={item} />
        ))}
      </span>
    );
  }
  return <span className="font-mono text-xs break-all">{JSON.stringify(value)}</span>;
};

const ArgumentList = ({ call }: { call: AnalyzedCall }) => (
  <dl className="grid gap-2 text-sm">
    {call.args.map((arg, i) => (
      <div key={i} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 items-start">
        <dt className="font-mono text-xs text-muted-foreground pt-0.5 break-all">{arg.name}</dt>
        <dd className="min-w-0">
          <ArgValue value={arg.value} />
        </dd>
      </div>
    ))}
    {!call.args.length && <p className="text-sm text-muted-foreground">No arguments.</p>}
  </dl>
);

const CallBody = ({ call, meta }: { call: AnalyzedCall; meta: ProtocolMetadata }) => {
  const { details } = call;

  if (!details) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Calls <code className="font-mono text-foreground">{call.functionName}</code> with{' '}
          {call.args.length} argument{call.args.length === 1 ? '' : 's'}.
        </p>
        <ArgumentList call={call} />
      </div>
    );
  }

  switch (details.kind) {
    case 'swap':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-4 sm:gap-3 items-center">
            <AmountLeg label="You send" amount={details.sell} meta={meta} />
            <ArrowRight className="w-5 h-5 text-muted-foreground justify-self-center rotate-90 sm:rotate-0" />
            <AmountLeg label="You receive" amount={details.buy} meta={meta} />
          </div>
          <div className="grid gap-2 pt-3 border-t border-border/60">
            <Fact icon={Route} label="Route">
              {details.path.map((hop, i) => (
                <span key={`${hop}-${i}`}>
                  {i > 0 && <span className="text-muted-foreground mx-1">→</span>}
                  {meta.symbol(hop)}
                </span>
              ))}
              {details.path.length === 2 && <span className="text-muted-foreground"> (direct)</span>}
            </Fact>
            {details.to && (
              <Fact icon={Wallet} label="Sent to">
                <Address value={details.to} />
              </Fact>
            )}
            {details.deadline !== undefined && (
              <Fact icon={Clock} label="Valid until">
                <Deadline deadline={details.deadline} />
              </Fact>
            )}
          </div>
        </div>
      );

    case 'add-liquidity':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <AmountLeg label="Deposit" amount={details.desiredA} meta={meta} />
            <AmountLeg label="Deposit" amount={details.desiredB} meta={meta} />
          </div>
          <div className="grid gap-2 pt-3 border-t border-border/60">
            <Fact icon={Droplets} label="Slippage floor">
              {meta.amount(details.minA.raw, details.minA.contract)} {meta.symbol(details.minA.contract)}
              {' + '}
              {meta.amount(details.minB.raw, details.minB.contract)} {meta.symbol(details.minB.contract)}
            </Fact>
            {details.to && (
              <Fact icon={Wallet} label="LP tokens to">
                <Address value={details.to} />
              </Fact>
            )}
            {details.deadline !== undefined && (
              <Fact icon={Clock} label="Valid until">
                <Deadline deadline={details.deadline} />
              </Fact>
            )}
          </div>
        </div>
      );

    case 'remove-liquidity':
      return (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Burn pool shares</p>
            <p className="text-xl sm:text-2xl font-bold tabular-nums break-all">
              {formatTokenAmount(details.liquidity, SHARE_DECIMALS)}{' '}
              <span className="text-base font-semibold text-muted-foreground">LP</span>
            </p>
          </div>
          <div className="grid gap-2 pt-3 border-t border-border/60">
            <Fact icon={Droplets} label="Receive at least">
              {meta.amount(details.minA.raw, details.minA.contract)} {meta.symbol(details.minA.contract)}
              {' + '}
              {meta.amount(details.minB.raw, details.minB.contract)} {meta.symbol(details.minB.contract)}
            </Fact>
            {details.to && (
              <Fact icon={Wallet} label="Sent to">
                <Address value={details.to} />
              </Fact>
            )}
            {details.deadline !== undefined && (
              <Fact icon={Clock} label="Valid until">
                <Deadline deadline={details.deadline} />
              </Fact>
            )}
          </div>
        </div>
      );

    case 'vault-deposit': {
      const vault = meta.vault(details.vault);
      // `amounts_desired` is a ceiling; `amounts_min` is the floor the vault must
      // accept. They match on single-asset vaults, and then it really is exact.
      const hasFloor = details.minAmounts.length === details.amounts.length;
      const isExact = hasFloor && details.minAmounts.every((min, i) => min === details.amounts[i]);
      return (
        <div className="space-y-4">
          <div className="space-y-3">
            {details.amounts.map((raw, i) => (
              <AmountLeg
                key={i}
                label="Deposit"
                amount={{
                  contract: vault?.assets[i] ?? details.vault,
                  raw,
                  bound: isExact ? 'exact' : 'max',
                }}
                meta={meta}
              />
            ))}
          </div>
          <div className="grid gap-2 pt-3 border-t border-border/60">
            {hasFloor && !isExact && (
              <Fact icon={ArrowDownToLine} label="At least">
                {details.minAmounts
                  .map((raw, i) => {
                    const asset = vault?.assets[i] ?? details.vault;
                    return `${meta.amount(raw, asset)} ${meta.symbol(asset)}`;
                  })
                  .join(' + ')}
              </Fact>
            )}
            <Fact icon={Layers} label="Into vault">
              {vault?.name ?? <Address value={details.vault} />}
            </Fact>
            <Fact icon={Sparkles} label="Auto-invest">
              {details.invest
                ? 'Yes — funds go straight into the vault strategies'
                : 'No — funds sit idle until the manager rebalances'}
            </Fact>
            {details.from && (
              <Fact icon={Wallet} label="From">
                <Address value={details.from} />
              </Fact>
            )}
          </div>
        </div>
      );
    }

    case 'vault-withdraw': {
      const vault = meta.vault(details.vault);
      return (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Redeem vault shares</p>
            <p className="text-xl sm:text-2xl font-bold tabular-nums break-all">
              {formatTokenAmount(details.shares, SHARE_DECIMALS)}{' '}
              <span className="text-base font-semibold text-muted-foreground">
                {vault?.symbol ?? 'shares'}
              </span>
            </p>
          </div>
          <div className="grid gap-2 pt-3 border-t border-border/60">
            <Fact icon={Layers} label="From vault">
              {vault?.name ?? <Address value={details.vault} />}
            </Fact>
            {details.minAmountsOut.length > 0 && (
              <Fact icon={ArrowUpFromLine} label="Receive at least">
                {details.minAmountsOut
                  .map((raw, i) => {
                    const asset = vault?.assets[i] ?? details.vault;
                    return `${meta.amount(raw, asset)} ${meta.symbol(asset)}`;
                  })
                  .join(' + ')}
              </Fact>
            )}
            {details.from && (
              <Fact icon={Wallet} label="To">
                <Address value={details.from} />
              </Fact>
            )}
          </div>
        </div>
      );
    }
  }
};

const INTENT_ICON = {
  swap: ArrowRight,
  'add-liquidity': ArrowDownToLine,
  'remove-liquidity': ArrowUpFromLine,
  'vault-deposit': ArrowDownToLine,
  'vault-withdraw': ArrowUpFromLine,
  admin: Sparkles,
} as const;

const CallCard = ({
  call,
  meta,
  network,
  showIndex,
}: {
  call: AnalyzedCall;
  meta: ProtocolMetadata;
  network: NetworkId;
  showIndex: boolean;
}) => {
  const { match } = call;
  const style = match ? PROTOCOL_STYLE[match.protocol] : null;
  const title = match?.signature?.action ?? (match ? call.functionName : 'Unknown contract call');
  const Icon = call.intent ? INTENT_ICON[call.intent] : TriangleAlert;

  return (
    <div
      className={cn(
        'rounded-xl border p-4 sm:p-5 space-y-4',
        match ? 'border-border/60 bg-secondary/20' : 'border-warning/40 bg-warning/5',
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ring-1',
              style ? `${style.tint} ${style.ring}` : 'bg-warning/10 ring-warning/30',
            )}
          >
            <Icon className={cn('w-4 h-4', style ? style.accent : 'text-warning')} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold leading-tight">{title}</p>
            <p className="font-mono text-[11px] text-muted-foreground break-all">
              {call.functionName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showIndex && (
            <Badge variant="outline" className="text-[11px]">
              Op #{call.opIndex + 1}
            </Badge>
          )}
          {match ? (
            <ProtocolBadge
              protocol={match.protocol}
              role={match.role}
              confidence={match.confidence}
              size="sm"
            />
          ) : (
            <UnknownContractBadge size="sm" />
          )}
        </div>
      </div>

      {match?.confidence === 'likely' && (
        <p className="text-xs text-warning flex items-start gap-2">
          <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" />
          {match.networkMismatch ? (
            <span>
              This is the <strong>{match.networkMismatch}</strong> {PROTOCOL_LABELS[match.protocol]}{' '}
              {match.role}, but the transaction is being read as {network}. Check you are on the
              right network before signing.
            </span>
          ) : (
            <span>
              This matches the {PROTOCOL_LABELS[match.protocol]} {match.role} interface, but the
              contract address is not one we recognise. Confirm the address before signing.
            </span>
          )}
        </p>
      )}

      {!match && (
        <p className="text-xs text-warning flex items-start gap-2">
          <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>
            Not Soroswap or DeFindex. This transaction invokes a contract we can&apos;t identify —
            verify what it does before adding a signature.
          </span>
        </p>
      )}

      <CallBody call={call} meta={meta} />

      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className="w-3.5 h-3.5 transition-transform group-data-[state=open]:rotate-180" />
          Contract &amp; arguments
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-3">
          <Fact icon={Layers} label="Contract">
            <span className="font-mono text-xs break-all">{call.contractId}</span>
          </Fact>
          {call.details && <ArgumentList call={call} />}
          <p className="text-xs text-muted-foreground">
            {call.authCount} authorization entr{call.authCount === 1 ? 'y' : 'ies'} attached.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

interface ProtocolSummaryProps {
  calls: AnalyzedCall[];
  network: NetworkId;
  /** Air-gapped signer: skip every network lookup. */
  offlineMode?: boolean;
}

/**
 * Turns the raw Soroban operations of an imported transaction into a plain
 * statement of what signing it would do, and which protocol it belongs to.
 */
export const ProtocolSummary = ({ calls, network, offlineMode = false }: ProtocolSummaryProps) => {
  const meta = useProtocolMetadata(calls, network, !offlineMode);
  if (!calls.length) return null;

  return (
    <div className="space-y-3">
      {calls.map((call) => (
        <CallCard
          key={call.opIndex}
          call={call}
          meta={meta}
          network={network}
          showIndex={calls.length > 1}
        />
      ))}
      {meta.resolving && (
        <p className="text-xs text-muted-foreground">Resolving token names…</p>
      )}
    </div>
  );
};
