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
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { GroupedTransaction } from '@/hooks/useTransactionGrouping';
import { LoadingPill } from '@/components/ui/loading-pill';

interface GroupedTransactionItemProps {
  groupedTx: GroupedTransaction;
  fiatAmounts: Map<string, number>;
  fiatLoading: boolean;
  formatFiatAmount: (amount: number) => string;
  truncateAddress: (address?: string | null) => string;
  network: 'mainnet' | 'testnet';
}

export const GroupedTransactionItem = ({
  groupedTx,
  fiatAmounts,
  fiatLoading,
  formatFiatAmount,
  truncateAddress,
  network
}: GroupedTransactionItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const mainFiatAmount = fiatAmounts.get(groupedTx.id) || 0;
  const showNA = (groupedTx.amount || 0) > 0 && mainFiatAmount === 0;

  // Calculate total fiat amount for grouped transactions
  const totalFiatAmount = groupedTx.isGrouped && groupedTx.groupedTransactions 
    ? groupedTx.groupedTransactions.reduce((sum, tx) => sum + (fiatAmounts.get(tx.id) || 0), 0)
    : mainFiatAmount;

  const renderTransactionContent = (tx: GroupedTransaction, isMain = true) => (
    <>
      <div className={cn(
        "p-2 rounded-full transition-colors shrink-0",
        tx.direction === 'out' 
          ? "bg-destructive/20 text-destructive"
          : "bg-success/20 text-success"
      )}>
        {tx.direction === 'out' ? 
          <ArrowUpRight className="w-4 h-4" /> : 
          <ArrowDownLeft className="w-4 h-4" />
        }
      </div>
      
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {tx.category === 'transfer' && (
              <span className="font-medium text-sm sm:text-base font-amount tabular-nums">
                {tx.direction === 'out' ? 'Sent' : 'Received'} {(tx.amount || 0).toFixed(2)} {tx.assetType === 'native' ? 'XLM' : (tx.assetCode || '')}
                {tx.isGrouped && isMain && (
                  <span className="text-muted-foreground ml-1">({tx.count}×)</span>
                )}
              </span>
            )}
            {tx.category === 'swap' && (
              <span className="font-medium text-sm sm:text-base flex items-center gap-1 flex-wrap">
                <Replace className="w-4 h-4 shrink-0" />
                <span className="font-amount tabular-nums break-all">
                  {`${(tx.swapFromAmount ?? 0).toFixed(2)} ${tx.swapFromAssetType === 'native' ? 'XLM' : (tx.swapFromAssetCode || '')}`} → {`${(tx.swapToAmount ?? 0).toFixed(2)} ${tx.swapToAssetType === 'native' ? 'XLM' : (tx.swapToAssetCode || '')}`}
                </span>
                {tx.isGrouped && isMain && (
                  <span className="text-muted-foreground ml-1">({tx.count}×)</span>
                )}
              </span>
            )}
            {tx.category === 'contract' && (
              <span className="font-medium text-sm sm:text-base flex items-center gap-1">
                <Code2 className="w-4 h-4 shrink-0" /> Contract call
                {tx.isGrouped && isMain && (
                  <span className="text-muted-foreground ml-1">({tx.count}×)</span>
                )}
              </span>
            )}
            {tx.category === 'config' && (
              <span className="font-medium text-sm sm:text-base flex items-center gap-1">
                <Settings className="w-4 h-4 shrink-0" /> Configuration change
                {tx.isGrouped && isMain && (
                  <span className="text-muted-foreground ml-1">({tx.count}×)</span>
                )}
              </span>
            )}
            <Badge variant="secondary" className="text-xs shrink-0">
              {tx.type}
            </Badge>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs sm:text-sm text-muted-foreground">
          <span className="font-amount break-all">
            {truncateAddress(tx.counterparty)}
          </span>
        </div>
      </div>
    </>
  );

  const openTransactionExplorer = (hash: string) => {
    const expertUrl = network === 'testnet' 
      ? `https://stellar.expert/explorer/testnet/tx/${hash}`
      : `https://stellar.expert/explorer/public/tx/${hash}`;
    window.open(expertUrl, '_blank');
  };

  return (
    <div className="rounded-lg border transition-colors hover:bg-secondary/50">
      {/* Main transaction row */}
      <div className="p-3 space-y-2 sm:space-y-0">
        <div className="flex items-start sm:items-center gap-3">
          {renderTransactionContent(groupedTx)}
          
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="font-medium text-sm sm:text-base font-amount tabular-nums">
                {fiatLoading ? (
                  <LoadingPill size="sm" />
                ) : showNA ? (
                  'N/A'
                ) : (
                  formatFiatAmount(groupedTx.isGrouped ? totalFiatAmount : mainFiatAmount)
                )}
              </div>
              <div className="text-xs text-muted-foreground whitespace-nowrap">
                {groupedTx.isGrouped && groupedTx.oldestTransaction && groupedTx.latestTransaction ? (
                  <>
                    {format(groupedTx.latestTransaction.createdAt, 'MMM dd, HH:mm')}
                    {groupedTx.oldestTransaction.id !== groupedTx.latestTransaction.id && (
                      <> - {format(groupedTx.oldestTransaction.createdAt, 'MMM dd, HH:mm')}</>
                    )}
                  </>
                ) : (
                  format(groupedTx.createdAt, 'MMM dd, HH:mm')
                )}
              </div>
            </div>
            
            <div className="flex gap-1">
              {groupedTx.isGrouped && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="shrink-0 self-start sm:self-center"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </Button>
              )}
              
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openTransactionExplorer(groupedTx.transactionHash);
                }}
                className="shrink-0 self-start sm:self-center"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
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
                <div key={tx.id} className="p-3 bg-secondary/10">
                  <div className="flex items-start sm:items-center gap-3">
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
                    
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">
                        {tx.category === 'transfer' && (
                          <span className="font-medium font-amount tabular-nums">
                            {(tx.amount || 0).toFixed(2)} {tx.assetType === 'native' ? 'XLM' : (tx.assetCode || '')}
                          </span>
                        )}
                        {tx.category !== 'transfer' && (
                          <span className="font-medium">
                            {tx.type}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(tx.createdAt, 'MMM dd, HH:mm:ss')}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div className="font-medium text-sm font-amount tabular-nums">
                          {fiatLoading ? (
                            <LoadingPill size="sm" />
                          ) : txShowNA ? (
                            'N/A'
                          ) : (
                            formatFiatAmount(txFiatAmount)
                          )}
                        </div>
                      </div>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openTransactionExplorer(tx.transactionHash);
                        }}
                        className="shrink-0"
                      >
                        <ExternalLink className="w-3 h-3" />
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