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
  quoteCurrency: string;
}

export const GroupedTransactionItem = ({
  groupedTx,
  fiatAmounts,
  rateInfo,
  fiatLoading,
  formatFiatAmount,
  truncateAddress,
  network,
  quoteCurrency
}: GroupedTransactionItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const { toast } = useToast();

  const mainFiatAmount = fiatAmounts.get(groupedTx.id) || 0;
  const showNA = (groupedTx.amount || 0) > 0 && mainFiatAmount === 0;

  // Calculate total fiat amount for grouped transactions
  const totalFiatAmount = groupedTx.isGrouped && groupedTx.groupedTransactions 
    ? groupedTx.groupedTransactions.reduce((sum, tx) => sum + (fiatAmounts.get(tx.id) || 0), 0)
    : mainFiatAmount;

  const renderTransactionContent = (tx: GroupedTransaction, isMain = true) => (
    <>
      <div className={cn(
        "p-1.5 sm:p-2 rounded-full transition-colors shrink-0",
        tx.direction === 'out' 
          ? "bg-destructive/20 text-destructive"
          : "bg-success/20 text-success"
      )}>
        {tx.direction === 'out' ? 
          <ArrowUpRight className="w-3 h-3 sm:w-4 sm:h-4" /> : 
          <ArrowDownLeft className="w-3 h-3 sm:w-4 sm:h-4" />
        }
      </div>
      
      <div className="min-w-0 flex-1 space-y-0.5 sm:space-y-1">
        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
            {tx.category === 'transfer' && (
              <span className="font-medium text-sm font-amount tabular-nums">
                {tx.isGrouped && isMain ? (
                  <>
                    {tx.direction === 'out' ? 'Sent' : 'Received'} {(tx.amount || 0).toFixed(2)}{' '}
                    {tx.assetType === 'native' ? 'XLM' : (tx.assetCode || '')}
                    <span className="text-muted-foreground ml-1">({tx.count}×)</span>
                  </>
                ) : (
                  <>
                    {tx.direction === 'out' ? 'Sent' : 'Received'} {(tx.amount || 0).toFixed(2)}{' '}
                    {tx.assetType === 'native' ? 'XLM' : (tx.assetCode || '')}
                  </>
                )}
              </span>
            )}
            {tx.category === 'swap' && (
              <span className="font-medium text-sm flex items-center gap-1 flex-wrap">
                <Replace className="w-3 h-3 shrink-0" />
                {tx.isGrouped && isMain ? (
                  <>
                    <span>Swaps</span>
                    <span className="text-muted-foreground ml-1">({tx.count}×)</span>
                  </>
                ) : (
                  <span className="font-amount tabular-nums break-all">
                    {(tx.swapFromAmount ?? 0).toFixed(2)}{' '}
                    {tx.swapFromAssetType === 'native' ? 'XLM' : (tx.swapFromAssetCode || '')}
                    {' → '}
                    {(tx.swapToAmount ?? 0).toFixed(2)}{' '}
                    {tx.swapToAssetType === 'native' ? 'XLM' : (tx.swapToAssetCode || '')}
                  </span>
                )}
              </span>
            )}
            {tx.category === 'contract' && (
              <span className="font-medium text-sm flex items-center gap-1">
                <Code2 className="w-3 h-3 shrink-0" />
                {tx.isGrouped && isMain ? 'Contract calls' : 'Contract call'}
                {tx.isGrouped && isMain && (
                  <span className="text-muted-foreground ml-1">({tx.count}×)</span>
                )}
              </span>
            )}
            {tx.category === 'config' && (
              <span className="font-medium text-sm flex items-center gap-1">
                <Settings className="w-3 h-3 shrink-0" />
                {tx.isGrouped && isMain ? 'Config changes' : 'Config change'}
                {tx.isGrouped && isMain && (
                  <span className="text-muted-foreground ml-1">({tx.count}×)</span>
                )}
              </span>
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
                {fiatLoading ? (
                  <LoadingPill size="sm" />
                ) : showNA ? (
                  <span className="text-muted-foreground">N/A</span>
                ) : (
                  formatFiatAmount(groupedTx.isGrouped ? totalFiatAmount : mainFiatAmount)
                )}
              </div>
              {!fiatLoading && !showNA && (groupedTx.amount || 0) > 0 && rateInfo.has(groupedTx.id) && (
                <div className="text-xs text-muted-foreground">
                  {(() => {
                    const rate = rateInfo.get(groupedTx.id)!;
                    const finalRate = rate.assetRate * rate.fxRate;
                    const currencySymbol = quoteCurrency === 'USD' ? '$' : 
                      quoteCurrency === 'EUR' ? '€' : 
                      quoteCurrency === 'GBP' ? '£' : 
                      quoteCurrency;
                    return `~${currencySymbol}${finalRate.toFixed(5)} per ${rate.asset}`;
                  })()}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {groupedTx.isGrouped && groupedTx.oldestTransaction && groupedTx.latestTransaction ? (
                  <>
                    <div>{format(groupedTx.latestTransaction.createdAt, 'MMM dd')}</div>
                    {format(groupedTx.oldestTransaction.createdAt, 'MMM dd') !== format(groupedTx.latestTransaction.createdAt, 'MMM dd') && (
                      <div className="opacity-75">to {format(groupedTx.oldestTransaction.createdAt, 'MMM dd')}</div>
                    )}
                  </>
                ) : (
                  format(groupedTx.createdAt, 'MMM dd')
                )}
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
            {groupedTx.groupedTransactions.map((tx) => {
              const txFiatAmount = fiatAmounts.get(tx.id) || 0;
              const txShowNA = (tx.amount || 0) > 0 && txFiatAmount === 0;
              
              return (
                <div key={tx.id} className="p-3 sm:p-4 bg-secondary/10">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={cn(
                        "p-1.5 rounded-full transition-colors shrink-0",
                        tx.direction === 'out' 
                          ? "bg-destructive/20 text-destructive"
                          : "bg-success/20 text-success"
                      )}>
                        {tx.direction === 'out' ? 
                          <ArrowUpRight className="w-3 h-3" /> : 
                          <ArrowDownLeft className="w-3 h-3" />
                        }
                      </div>
                      
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-sm">
                          {tx.category === 'transfer' && (
                            <span className="font-medium font-amount tabular-nums">
                              {(tx.amount || 0).toFixed(2)}{' '}
                              {tx.assetType === 'native' ? 'XLM' : (tx.assetCode || '')}
                            </span>
                          )}
                          {tx.category === 'swap' && (
                            <span className="font-medium font-amount tabular-nums">
                              {(tx.swapFromAmount ?? 0).toFixed(2)}{' '}
                              {tx.swapFromAssetType === 'native' ? 'XLM' : (tx.swapFromAssetCode || '')}
                              {' → '}
                              {(tx.swapToAmount ?? 0).toFixed(2)}{' '}
                              {tx.swapToAssetType === 'native' ? 'XLM' : (tx.swapToAssetCode || '')}
                            </span>
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
                          {format(tx.createdAt, 'MMM dd, HH:mm:ss')}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 sm:gap-1">
                      <div className="font-medium text-sm font-amount tabular-nums">
                        {fiatLoading ? (
                          <LoadingPill size="sm" />
                        ) : txShowNA ? (
                          <span className="text-muted-foreground">N/A</span>
                        ) : (
                          formatFiatAmount(txFiatAmount)
                        )}
                      </div>
                      {!fiatLoading && !txShowNA && (tx.amount || 0) > 0 && rateInfo.has(tx.id) && (
                        <div className="text-xs text-muted-foreground">
                          {(() => {
                            const rate = rateInfo.get(tx.id)!;
                            const finalRate = rate.assetRate * rate.fxRate;
                            const currencySymbol = quoteCurrency === 'USD' ? '$' : 
                              quoteCurrency === 'EUR' ? '€' : 
                              quoteCurrency === 'GBP' ? '£' : 
                              quoteCurrency;
                            return `~${currencySymbol}${finalRate.toFixed(5)} per ${rate.asset}`;
                          })()}
                        </div>
                      )}
                      
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};