import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowUpRight,
  ArrowDownLeft,
  ExternalLink,
  Settings,
  Replace,
  Code2,
  ChevronDown,
  ChevronRight,
  Copy,
  Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { GroupedTransaction } from '@/hooks/useTransactionGrouping';
import { NormalizedTransaction } from '@/lib/horizon-utils';
import { formatAmount } from '@/lib/balance-utils';
import { krakenSymbolFor } from '@/lib/kraken';
import { LoadingPill } from '@/components/ui/loading-pill';
import { useToast } from '@/hooks/use-toast';

interface GroupedTransactionItemProps {
  groupedTx: GroupedTransaction;
  fiatAmounts: Map<string, number>;
  rateInfo: Map<string, { assetRate: number; fxRate: number; asset: string }>;
  fiatLoading: boolean;
  formatFiatAmount: (amount: number) => string;
  truncateAddress: (address?: string | null) => string;
  network: 'mainnet' | 'testnet';
  currencySymbol: string;
}

// Leading icon: an arrow for transfers, the category's own icon otherwise.
const EntryIcon = ({ tx, compact = false }: { tx: NormalizedTransaction; compact?: boolean }) => {
  const Icon = tx.category === 'swap' ? Replace
    : tx.category === 'contract' ? Code2
    : tx.category === 'config' ? Settings
    : tx.direction === 'out' ? ArrowUpRight : ArrowDownLeft;
  return (
    <div className={cn(
      "rounded-full transition-colors shrink-0",
      compact ? "p-1.5" : "p-1.5 sm:p-2",
      tx.category !== 'transfer'
        ? "bg-secondary text-muted-foreground"
        : tx.direction === 'out'
          ? "bg-destructive/20 text-destructive"
          : "bg-success/20 text-success"
    )}>
      <Icon className={compact ? "w-3 h-3" : "w-3 h-3 sm:w-4 sm:h-4"} />
    </div>
  );
};

export const GroupedTransactionItem = ({
  groupedTx,
  fiatAmounts,
  rateInfo,
  fiatLoading,
  formatFiatAmount,
  truncateAddress,
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
    if (!txs.some(tx => (tx.amount ?? 0) > 0)) return <span className="text-muted-foreground">—</span>;
    if (fiatLoading || txs.some(tx => !fiatAmounts.has(tx.id))) return <LoadingPill size="sm" />;
    if (txs.some(tx => !(fiatAmounts.get(tx.id)! > 0))) return <span className="text-muted-foreground">N/A</span>;
    return formatFiatAmount(txs.reduce((sum, tx) => sum + fiatAmounts.get(tx.id)!, 0));
  };

  const renderRate = (tx: NormalizedTransaction) => {
    const rate = rateInfo.get(tx.id);
    if (fiatLoading || !rate) return null;
    return (
      <div className="text-xs text-muted-foreground">
        ~{currencySymbol}{(rate.assetRate * rate.fxRate).toFixed(5)} per {rate.asset}
      </div>
    );
  };

  const renderTransactionContent = (tx: GroupedTransaction, isMain = true) => (
    <>
      <EntryIcon tx={tx} />

      <div className="min-w-0 flex-1 space-y-0.5 sm:space-y-1">
        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
            {tx.category === 'transfer' && (
              <span className="font-medium text-sm font-amount tabular-nums">
                {transferText(tx)}
                {tx.isGrouped && isMain && (
                  <span className="text-muted-foreground ml-1">({tx.count}×)</span>
                )}
              </span>
            )}
            {tx.category === 'swap' && (
              <span className="font-medium text-sm flex items-center gap-1 flex-wrap">
                {tx.isGrouped && isMain ? (
                  <>
                    <span>Swaps</span>
                    <span className="text-muted-foreground ml-1">({tx.count}×)</span>
                  </>
                ) : (
                  <span className="font-amount tabular-nums break-all">{swapText(tx)}</span>
                )}
              </span>
            )}
            {tx.category === 'contract' && (
              <span className="font-medium text-sm">Contract call</span>
            )}
            {tx.category === 'config' && (
              <span className="font-medium text-sm">Config change</span>
            )}
            <Badge variant="secondary" className="text-xs shrink-0 hidden sm:inline-flex">
              {tx.type}
            </Badge>
          </div>
        </div>

        {tx.counterparty && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="font-mono break-all">
              {truncateAddress(tx.counterparty)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                copyAddress(tx.counterparty!);
              }}
              className="h-4 w-4 p-0 hover:bg-secondary shrink-0"
            >
              {copiedAddress === tx.counterparty ? (
                <Check className="w-2.5 h-2.5 text-success" />
              ) : (
                <Copy className="w-2.5 h-2.5" />
              )}
            </Button>
          </div>
        )}
      </div>
    </>
  );

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
    window.open(expertUrl, '_blank');
  };


  return (
    <div className="rounded-lg border transition-colors hover:bg-secondary/50">
      {/* Main transaction row */}
      <div className="p-2 sm:p-4">
        <div className="flex items-center gap-2 sm:gap-3">
          {renderTransactionContent(groupedTx)}

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="text-right">
              <div className="font-medium text-sm sm:text-lg font-amount tabular-nums">
                {renderFiat(groupedTx.groupedTransactions ?? [groupedTx])}
              </div>
              {!groupedTx.isGrouped && renderRate(groupedTx)}
              <div className="text-xs text-muted-foreground">
                {format(groupedTx.createdAt, 'MMM dd, yyyy')}
              </div>
            </div>

            {groupedTx.isGrouped ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-7 px-2 shrink-0"
              >
                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openTransactionExplorer(groupedTx.transactionHash);
                }}
                className="h-7 px-2 shrink-0"
              >
                <ExternalLink className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded grouped transactions */}
      {groupedTx.isGrouped && isExpanded && groupedTx.groupedTransactions && (
        <div className="border-t border-border/50">
          <div className="px-3 py-2 bg-secondary/30">
            <div className="text-xs text-muted-foreground font-medium">
              Individual Transactions ({groupedTx.count})
            </div>
          </div>
          <div className="divide-y divide-border/30">
            {groupedTx.groupedTransactions.map((tx) => (
              <div key={tx.id} className="p-3 sm:p-4 bg-secondary/10">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex items-start gap-3 flex-1">
                    <EntryIcon tx={tx} compact />

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-sm">
                        {tx.category === 'transfer' && (
                          <span className="font-medium font-amount tabular-nums">{transferText(tx)}</span>
                        )}
                        {tx.category === 'swap' && (
                          <span className="font-medium font-amount tabular-nums">{swapText(tx)}</span>
                        )}
                        {tx.category !== 'transfer' && tx.category !== 'swap' && (
                          <span className="font-medium">
                            {tx.type}
                          </span>
                        )}
                      </div>
                      {tx.counterparty && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono break-all">
                            {truncateAddress(tx.counterparty)}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyAddress(tx.counterparty!);
                            }}
                            className="h-5 w-5 p-0 hover:bg-secondary shrink-0"
                          >
                            {copiedAddress === tx.counterparty ? (
                              <Check className="w-2.5 h-2.5 text-success" />
                            ) : (
                              <Copy className="w-2.5 h-2.5" />
                            )}
                          </Button>
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {format(tx.createdAt, 'MMM dd, yyyy HH:mm:ss')}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 sm:gap-1">
                    <div className="font-medium text-sm font-amount tabular-nums">
                      {renderFiat([tx])}
                    </div>
                    {renderRate(tx)}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openTransactionExplorer(tx.transactionHash);
                      }}
                      className="h-7 px-2 shrink-0"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span className="ml-1 sm:hidden text-xs">View</span>
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
