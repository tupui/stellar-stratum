import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  Clock,
  Coins,
  Droplets,
  FileCode,
  Hash,
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
import { accountMovements, sameAccount, type DeployInfo } from '@/lib/protocols/auth';
import type { ActivityDetails, AnalyzedCall, DecodedArg, TokenAmount } from '@/lib/protocols/detect';
import { PROTOCOL_LABELS, type NetworkId } from '@/lib/protocols/registry';
import { useProtocolMetadata, type ProtocolMetadata } from '@/hooks/useProtocolMetadata';
import { Address, ArgValue, AuthorizationTree, AuthorizationWarning } from './AuthorizationTree';
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

/** A from/to row, flagged when it is not the account signing. */
const AccountFact = ({ label, value, source }: { label: string; value: string; source?: string }) => (
  <Fact icon={Wallet} label={label}>
    <Address value={value} />
    {source && !sameAccount(value, source) && (
      <span className="text-destructive font-medium"> — not the signing account</span>
    )}
  </Fact>
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

const ArgumentList = ({ args }: { args: DecodedArg[] }) => (
  <dl className="grid gap-2 text-sm">
    {args.map((arg, i) => (
      <div key={i} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 items-start">
        <dt className="font-mono text-xs text-muted-foreground pt-0.5 break-all">{arg.name}</dt>
        <dd className="min-w-0">
          <ArgValue value={arg.value} />
        </dd>
      </div>
    ))}
    {!args.length && <p className="text-sm text-muted-foreground">No arguments.</p>}
  </dl>
);

const TokenPath = ({ path, meta }: { path: string[]; meta: ProtocolMetadata }) => (
  <>
    {path.map((hop, i) => (
      <span key={`${hop}-${i}`}>
        {i > 0 && <span className="text-muted-foreground mx-1">→</span>}
        {meta.symbol(hop)}
      </span>
    ))}
  </>
);

/** Router path, or the aggregator's split across venues when the call spells it out. */
const RouteFact = ({ details, meta }: { details: Extract<ActivityDetails, { kind: 'swap' }>; meta: ProtocolMetadata }) => {
  const total = details.hops.reduce((sum, hop) => sum + (hop.parts ?? 0), 0);
  return (
    <Fact icon={Route} label="Route">
      {details.hops.length > 0 ? (
        <span className="flex flex-col gap-0.5">
          {details.hops.map((hop, i) => {
            // A hop that does not run from the sold token to the bought one is not part of this swap.
            const offRoute =
              hop.path[0] !== details.sell.contract || hop.path[hop.path.length - 1] !== details.buy.contract;
            return (
              <span key={i} className={offRoute ? 'text-destructive' : undefined}>
                <span className="text-muted-foreground">{hop.protocol || 'Unnamed venue'}:</span>{' '}
                {hop.path.length ? <TokenPath path={hop.path} meta={meta} /> : 'unreadable path'}
                {hop.parts !== null && total > 0 && (
                  <span className="text-muted-foreground"> ({Math.round((hop.parts / total) * 100)}%)</span>
                )}
                {offRoute && hop.path.length > 0 && ' — does not match the swap'}
              </span>
            );
          })}
        </span>
      ) : (
        <>
          <TokenPath path={details.path} meta={meta} />
          {!details.routeKnown && <span className="text-muted-foreground"> (route chosen by the aggregator)</span>}
          {details.routeKnown && details.path.length === 2 && <span className="text-muted-foreground"> (direct)</span>}
        </>
      )}
    </Fact>
  );
};

/** Contract deployments and WASM uploads: code the app cannot read. */
const DeployBody = ({ deploy }: { deploy: DeployInfo }) => {
  if (deploy.kind === 'upload-wasm') {
    return (
      <div className="grid gap-2">
        <Fact icon={FileCode} label="WASM hash">
          <span className="font-mono text-xs break-all">{deploy.wasmHash}</span>
        </Fact>
        <Fact icon={Layers} label="Size">
          {deploy.size.toLocaleString()} bytes
        </Fact>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Fact icon={Layers} label="New contract">
          <span className="font-mono text-xs break-all">{deploy.contractId || 'cannot be computed'}</span>
        </Fact>
        {deploy.wasmHash && (
          <Fact icon={FileCode} label="WASM hash">
            <span className="font-mono text-xs break-all">{deploy.wasmHash}</span>
          </Fact>
        )}
        {deploy.asset !== undefined && (
          <Fact icon={Coins} label="Wraps asset">
            <span className="break-all">{deploy.asset || 'unreadable'}</span>
          </Fact>
        )}
        {deploy.externalRef && (
          <Fact icon={FileCode} label="Code from">
            <Address value={deploy.externalRef.owner} /> as &quot;{deploy.externalRef.tag}&quot;
          </Fact>
        )}
        {deploy.deployer !== undefined && (
          <Fact icon={Wallet} label="Deployer">
            {deploy.deployer ? <Address value={deploy.deployer} /> : 'unreadable'}
          </Fact>
        )}
        {deploy.salt && (
          <Fact icon={Hash} label="Salt">
            <span className="font-mono text-xs break-all">{deploy.salt}</span>
          </Fact>
        )}
      </div>
      {deploy.constructorArgs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Constructor arguments</p>
          <ArgumentList args={deploy.constructorArgs} />
        </div>
      )}
    </div>
  );
};

const CallBody = ({ call, meta }: { call: AnalyzedCall; meta: ProtocolMetadata }) => {
  const { details } = call;

  if (call.deploy) return <DeployBody deploy={call.deploy} />;

  if (!details) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Calls <code className="font-mono text-foreground">{call.functionName}</code> with{' '}
          {call.args.length} argument{call.args.length === 1 ? '' : 's'}.
        </p>
        <ArgumentList args={call.args} />
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
            <RouteFact details={details} meta={meta} />
            {details.from && <AccountFact label="From" value={details.from} source={call.source} />}
            {details.to && <AccountFact label="Sent to" value={details.to} source={call.source} />}
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
            {details.to && <AccountFact label="LP tokens to" value={details.to} source={call.source} />}
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
            {details.to && <AccountFact label="Sent to" value={details.to} source={call.source} />}
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
            {details.from && <AccountFact label="From" value={details.from} source={call.source} />}
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
            {details.from && <AccountFact label="To" value={details.from} source={call.source} />}
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
  const { match, deploy } = call;
  const style = match ? PROTOCOL_STYLE[match.protocol] : null;
  const title = deploy
    ? deploy.kind === 'upload-wasm'
      ? 'Upload contract code'
      : 'Deploy contract'
    : (match?.signature?.action ?? (match ? call.functionName : 'Unknown contract call'));
  const Icon = call.intent ? INTENT_ICON[call.intent] : TriangleAlert;

  // A pinned address is not enough: the attached authorization must stay within the summary.
  const overreach = Boolean(match && call.authIssues.length);
  const unknownMoves = !match && accountMovements(call.auth, call.source).length > 0;
  const critical = overreach || unknownMoves;
  const needsLook =
    critical || Boolean(deploy) || call.auth.some((entry) => entry.credential !== 'source' || !entry.rootIsCall);

  return (
    <div
      className={cn(
        'rounded-xl border p-4 sm:p-5 space-y-4',
        critical
          ? 'border-destructive/50 bg-destructive/5'
          : match
            ? 'border-border/60 bg-secondary/20'
            : 'border-warning/40 bg-warning/5',
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
              confidence={overreach ? 'unsafe' : match.confidence}
              size="sm"
            />
          ) : (
            <UnknownContractBadge size="sm" />
          )}
        </div>
      </div>

      <AuthorizationWarning call={call} meta={meta} />

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
          {deploy?.kind === 'create-contract' ? (
            <span>
              Deploys a new contract. The app cannot read what its code does, and its constructor runs
              with the authorizations below. Sign only if you know this code.
            </span>
          ) : deploy ? (
            <span>
              Uploads contract code to the network. The app cannot read what it does; sign only if you
              know this code.
            </span>
          ) : (
            <span>
              Not Soroswap or DeFindex. This transaction invokes a contract we can&apos;t identify —
              verify what it does before adding a signature.
            </span>
          )}
        </p>
      )}

      <CallBody call={call} meta={meta} />

      <AuthorizationTree call={call} meta={meta} network={network} defaultOpen={needsLook} />

      {!deploy && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className="w-3.5 h-3.5 transition-transform group-data-[state=open]:rotate-180" />
            Contract &amp; arguments
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-3">
            <Fact icon={Layers} label="Contract">
              <span className="font-mono text-xs break-all">{call.contractId}</span>
            </Fact>
            {call.details && <ArgumentList args={call.args} />}
          </CollapsibleContent>
        </Collapsible>
      )}
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
