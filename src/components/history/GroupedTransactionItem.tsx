import { useState } from 'react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  ArrowUpRight,
  ArrowDownLeft,
  ExternalLink,
  Sun,
  Replace,
  Code2,
  ChevronDown,
  ChevronRight,
  Copy,
  Check
} from 'lucide-react';
import { cn, openExternal } from '@/lib/utils';
import { format } from 'date-fns';
import { GroupedTransaction } from '@/hooks/useTransactionGrouping';
import { NormalizedTransaction } from '@/lib/horizon-utils';
import { formatAmount } from '@/lib/balance-utils';
import { krakenSymbolFor } from '@/lib/kraken';
import { Spinner } from '@/components/brand/Mark';
import { useToast } from '@/hooks/use-toast';
import { operationLabel } from '@/lib/labels';

interface GroupedTransactionItemProps {
  groupedTx: GroupedTransaction;
  fiatAmounts: Map<string, number>;
  rateInfo: Map<string, { assetRate: number; fxRate: number; asset: string }>;
  fiatLoading: boolean;
  formatFiatAmount: (amount: number) => string;
  truncateAddress: (address?: string | null) => string;
  /** Addresses this account has paid; other senders may be look-alike spam. */
  paidCounterparties: Set<string>;
  network: 'mainnet' | 'testnet';
  currencySymbol: string;
}

/** A row action without a frame: a 32 px glyph area inside a 44 px hit area. */
const inlineIcon =
  'box-content inline-grid size-8 shrink-0 place-items-center -m-1.5 p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4';

// Leading glyph, bare and muted: an arrow for transfers, the category's own icon otherwise.
const EntryIcon = ({ tx }: { tx: NormalizedTransaction }) => {
  const Icon = tx.category === 'swap' ? Replace
    : tx.category === 'contract' ? Code2
    : tx.category === 'config' ? Sun
    : tx.direction === 'out' ? ArrowUpRight : ArrowDownLeft;
  return (
    <span className="flex shrink-0 pt-0.5 text-muted-foreground md:self-center md:pt-0">
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
    </span>
  );
};

export const GroupedTransactionItem = ({
  groupedTx,
  fiatAmounts,
  rateInfo,
  fiatLoading,
  formatFiatAmount,
  truncateAddress,
  paidCounterparties,
  network,
  currencySymbol
}: GroupedTransactionItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const { toast } = useToast();

  // Asset code, plus a short issuer for credit assets we don't recognise, so a
  // look-alike "USDC" can't pass for the real one.
  const assetLabel = (assetType?: string, assetCode?: string, assetIssuer?: string) => {
    if (assetType === 'native') return 'XLM';
    if (!assetIssuer || krakenSymbolFor(network, assetType, assetCode, assetIssuer)) return assetCode || '';
    return `${assetCode || ''} (${assetIssuer.slice(0, 4)}…${assetIssuer.slice(-4)})`;
  };

  const transferText = (tx: NormalizedTransaction) =>
    `${tx.direction === 'out' ? 'Sent' : 'Received'} ${tx.amount !== undefined
      ? `${formatAmount(tx.amount)} ${assetLabel(tx.assetType, tx.assetCode, tx.assetIssuer)}`
      : 'account balance'}`;

  const swapText = (tx: NormalizedTransaction) =>
    `${formatAmount(tx.swapFromAmount ?? 0)} ${assetLabel(tx.swapFromAssetType, tx.swapFromAssetCode, tx.swapFromAssetIssuer)}` +
    ` → ${formatAmount(tx.swapToAmount ?? 0)} ${assetLabel(tx.swapToAssetType, tx.swapToAssetCode, tx.swapToAssetIssuer)}`;

  // Fiat value of one or more entries: '—' when they move no amount, N/A when
  // any of them has no price (unknown asset or no rate for that day).
  const renderFiat = (txs: NormalizedTransaction[]) => {
    if (!txs.some(tx => (tx.amount ?? 0) > 0)) return '—';
    if (fiatLoading || txs.some(tx => !fiatAmounts.has(tx.id))) return <Spinner size={12} />;
    if (txs.some(tx => !(fiatAmounts.get(tx.id)! > 0))) return <span className="text-muted-foreground">N/A</span>;
    return formatFiatAmount(txs.reduce((sum, tx) => sum + fiatAmounts.get(tx.id)!, 0));
  };

  const renderRate = (tx: NormalizedTransaction) => {
    const rate = rateInfo.get(tx.id);
    if (fiatLoading || !rate) return null;
    return (
      <span className="text-xs text-muted-foreground">
        ~{currencySymbol}{(rate.assetRate * rate.fxRate).toFixed(5)} per {rate.asset}
      </span>
    );
  };

  // What the row says: the transfer or swap, or the kind of change
  const titleOf = (tx: GroupedTransaction | NormalizedTransaction, isMain: boolean) => {
    const grouped = isMain && 'isGrouped' in tx && tx.isGrouped ? (tx as GroupedTransaction).count : 0;
    if (tx.category === 'transfer') {
      return <>{transferText(tx)}{grouped > 0 && <span className="ml-1 text-muted-foreground">({grouped}×)</span>}</>;
    }
    if (tx.category === 'swap') {
      return grouped > 0
        ? <>Swaps <span className="ml-1 text-muted-foreground">({grouped}×)</span></>
        : <span className="break-all">{swapText(tx)}</span>;
    }
    if (!isMain) return operationLabel(tx.type);
    return tx.category === 'contract' ? 'Contract call' : 'Config change';
  };

  // A sender this account never paid is shown but not offered for copying: it may be a
  // look-alike address planted with a spam payment, waiting to be pasted as a recipient.
  const renderCounterparty = (tx: NormalizedTransaction) => {
    const unfamiliar = tx.direction === 'in' && !paidCounterparties.has(tx.counterparty!);
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="font-address text-[13px] text-muted-foreground break-all">{truncateAddress(tx.counterparty)}</span>
        {unfamiliar ? (
          <span className="shrink-0 text-xs text-muted-foreground" title="Senders can use look-alike addresses. Check the full address before paying it.">
            (never paid)
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              copyAddress(tx.counterparty!);
            }}
            className={inlineIcon}
            aria-label="Copy address"
          >
            {copiedAddress === tx.counterparty ? <Check /> : <Copy />}
          </button>
        )}
      </span>
    );
  };

  /**
   * One entry. The phone stacks it in three lines (title, fiat and link; tag and rate;
   * counterparty and date); from md up the title and tag sit together, with the fiat, rate and
   * date in a column at the right.
   */
  const renderRow = (
    tx: GroupedTransaction | NormalizedTransaction,
    { isMain, fiatOf, date, action }: { isMain: boolean; fiatOf: NormalizedTransaction[]; date: string; action: ReactNode },
  ) => {
    const title = titleOf(tx, isMain);
    const tag = isMain ? <Badge className="shrink-0">{operationLabel(tx.type)}</Badge> : null;
    const fiat = <span className="font-amount text-[15px] tabular-nums">{renderFiat(fiatOf)}</span>;
    const rate = isMain && 'isGrouped' in tx && tx.isGrouped ? null : renderRate(tx);
    const when = <span className="text-xs text-muted-foreground">{date}</span>;
    const counterparty = tx.counterparty ? renderCounterparty(tx) : null;
    return (
      <>
        {/* phone */}
        <div className="flex min-w-0 flex-1 flex-col gap-1 md:hidden">
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 font-semibold">{title}</span>
            {fiat}
            {action}
          </div>
          {(tag || rate || !counterparty) && (
            <div className="flex items-center justify-between gap-2">
              {tag ?? <span />}
              {rate ?? (!counterparty && when)}
            </div>
          )}
          {counterparty && (
            <div className="flex flex-wrap items-center justify-between gap-x-2">
              {counterparty}
              <span className="ml-auto">{when}</span>
            </div>
          )}
        </div>
        {/* desktop */}
        <div className="hidden min-w-0 flex-1 flex-col gap-1 md:flex">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{title}</span>
            {tag}
          </div>
          {counterparty}
        </div>
        <div className="hidden shrink-0 flex-col items-end md:flex">
          {fiat}
          {rate}
          {when}
        </div>
        <span className="hidden md:inline-flex">{action}</span>
      </>
    );
  };

  const copyAddress = async (address: string) => {
    if (!address) return;

    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress(null), 2000);
      toast({
        description: "Address copied to clipboard",
      });
    } catch (err) {
      toast({
        description: "Failed to copy address",
        variant: "destructive",
      });
    }
  };

  const openTransactionExplorer = (hash: string) => {
    const expertUrl = network === 'testnet'
      ? `https://stellar.expert/explorer/testnet/tx/${hash}`
      : `https://stellar.expert/explorer/public/tx/${hash}`;
    openExternal(expertUrl);
  };


  const explorerLink = (hash: string) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openTransactionExplorer(hash);
      }}
      className={inlineIcon}
      aria-label="Open in explorer"
    >
      <ExternalLink />
    </button>
  );

  return (
    <li className="border-t border-line">
      {/* Main transaction row */}
      <div className="flex items-start gap-3 px-4 py-3 md:items-center">
        <EntryIcon tx={groupedTx} />
        {renderRow(groupedTx, {
          isMain: true,
          fiatOf: groupedTx.groupedTransactions ?? [groupedTx],
          date: format(groupedTx.createdAt, 'MMM dd, yyyy'),
          action: groupedTx.isGrouped ? (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className={inlineIcon}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Hide transactions' : 'Show transactions'}
            >
              {isExpanded ? <ChevronDown /> : <ChevronRight />}
            </button>
          ) : explorerLink(groupedTx.transactionHash),
        })}
      </div>

      {/* Expanded grouped transactions */}
      {groupedTx.isGrouped && isExpanded && groupedTx.groupedTransactions && (
        <div className="bg-ink-3">
          <p className="border-t border-line px-4 py-2 text-xs text-muted-foreground">
            Individual Transactions ({groupedTx.count})
          </p>
          <ul>
            {groupedTx.groupedTransactions.map((tx) => (
              <li key={tx.id} className="flex items-start gap-3 border-t border-line px-4 py-3 md:items-center">
                <EntryIcon tx={tx} />
                {renderRow(tx, {
                  isMain: false,
                  fiatOf: [tx],
                  date: format(tx.createdAt, 'MMM dd, yyyy HH:mm:ss'),
                  action: explorerLink(tx.transactionHash),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
};
