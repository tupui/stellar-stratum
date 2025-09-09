import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { 
  RefreshCw, 
  ArrowUpRight, 
  ArrowDownLeft, 
  ExternalLink, 
  Calendar,
  Filter,
  TrendingUp,
  DollarSign,
  Hash,
  Eye,
  EyeOff
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { useAccountHistory } from '@/hooks/useAccountHistory';
import { useFiatConversion } from '@/hooks/useFiatConversion';
import { getHorizonTransactionUrl } from '@/lib/horizon-utils';
import { useNetwork } from '@/contexts/NetworkContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { TransactionChart } from './TransactionChart';

interface TransactionHistoryPanelProps {
  accountPublicKey: string;
}

interface Filters {
  direction: 'all' | 'in' | 'out';
  type: 'all' | 'payment' | 'create_account';
  minAmount: string;
  maxAmount: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  addressFilter: string;
}

interface AggregatedStats {
  count: number;
  totalXLM: number;
  totalFiat: number;
  avgXLM: number;
  avgFiat: number;
}

export const TransactionHistoryPanel = ({ accountPublicKey }: TransactionHistoryPanelProps) => {
  const { network } = useNetwork();
  const isMobile = useIsMobile();
  const { 
    transactions, 
    isLoading, 
    error, 
    hasMore, 
    lastSync, 
    loadMore, 
    loadProgressively,
    refresh,
    getTransactionsByDateRange
  } = useAccountHistory(accountPublicKey);
  
  const { convertXLMToFiat, formatFiatAmount } = useFiatConversion();

  // Filter and selection state
  const [filters, setFilters] = useState<Filters>({
    direction: 'all',
    type: 'all',
    minAmount: '',
    maxAmount: '',
    dateFrom: undefined,
    dateTo: undefined,
    addressFilter: '',
  });

  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [fiatAmounts, setFiatAmounts] = useState<Map<string, number>>(new Map());

  // Convert XLM amounts to fiat asynchronously - memoized to prevent infinite loops
  useEffect(() => {
    const convertAmounts = async () => {
      const newFiatAmounts = new Map<string, number>();
      
      // Process in smaller batches to avoid performance issues
      const batchSize = 10;
      for (let i = 0; i < transactions.length; i += batchSize) {
        const batch = transactions.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (tx) => {
            try {
              const fiatAmount = await convertXLMToFiat(tx.amount);
              newFiatAmounts.set(tx.id, fiatAmount);
            } catch (error) {
              // Fallback to 0 if conversion fails
              newFiatAmounts.set(tx.id, 0);
            }
          })
        );
      }
      
      setFiatAmounts(newFiatAmounts);
    };

    if (transactions.length > 0) {
      convertAmounts();
    }
  }, [transactions.length, convertXLMToFiat]);

  // Filter transactions based on current filters
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      // Direction filter
      if (filters.direction !== 'all' && tx.direction !== filters.direction) {
        return false;
      }

      // Type filter
      if (filters.type !== 'all' && tx.type !== filters.type) {
        return false;
      }

      // Amount filters
      if (filters.minAmount && tx.amount < parseFloat(filters.minAmount)) {
        return false;
      }
      if (filters.maxAmount && tx.amount > parseFloat(filters.maxAmount)) {
        return false;
      }

      // Date filters
      if (filters.dateFrom && tx.createdAt < filters.dateFrom) {
        return false;
      }
      if (filters.dateTo) {
        const endOfDay = new Date(filters.dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        if (tx.createdAt > endOfDay) {
          return false;
        }
      }

      // Address filter
      if (filters.addressFilter) {
        const query = filters.addressFilter.toLowerCase();
        if (!tx.counterparty.toLowerCase().includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [transactions, filters]);

  // Calculate aggregated stats for selected or filtered transactions (removed avg amount)
  const aggregatedStats = useMemo((): AggregatedStats => {
    const targetTransactions = selectedTransactions.size > 0 
      ? filteredTransactions.filter(tx => selectedTransactions.has(tx.id))
      : filteredTransactions;

    const count = targetTransactions.length;
    const totalXLM = targetTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    
    let totalFiat = 0;
    targetTransactions.forEach(tx => {
      const fiatAmount = fiatAmounts.get(tx.id) || 0;
      totalFiat += fiatAmount;
    });

    return {
      count,
      totalXLM,
      totalFiat,
      avgXLM: 0, // Remove avg calculation
      avgFiat: 0, // Remove avg calculation
    };
  }, [filteredTransactions, selectedTransactions, fiatAmounts]);

  // Auto-load more data progressively for better UX
  const handleRequestMoreData = async () => {
    await loadProgressively();
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  const handleTransactionSelect = (txId: string, selected: boolean) => {
    setSelectedTransactions(prev => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(txId);
      } else {
        newSet.delete(txId);
      }
      return newSet;
    });
  };

  const clearSelection = () => {
    setSelectedTransactions(new Set());
  };

  const clearFilters = () => {
    setFilters({
      direction: 'all',
      type: 'all',
      minAmount: '',
      maxAmount: '',
      dateFrom: undefined,
      dateTo: undefined,
      addressFilter: '',
    });
  };

  if (error) {
    return (
      <Card className="shadow-card">
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <p>Failed to load transaction history</p>
            <p className="text-sm mt-1">{error}</p>
            <Button onClick={refresh} variant="outline" size="sm" className="mt-2">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <TrendingUp className="w-5 h-5" />
              Activity History
            </CardTitle>
            <CardDescription>
              Filtered: Native XLM ≥ 1 • {filteredTransactions.length} transactions
              {lastSync && (
                <> • Last updated {formatDistanceToNow(lastSync, { addSuffix: true })}</>
              )}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={cn(showFilters && "bg-secondary")}
            >
              <Filter className="w-4 h-4" />
              {!isMobile && <span className="ml-2">Filters</span>}
            </Button>
            <Button
              onClick={refresh}
              variant="ghost"
              size="sm"
              disabled={isLoading}
              className="shrink-0"
            >
              <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
              {!isMobile && <span className="ml-2">Refresh</span>}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Filters Panel */}
        {showFilters && (
          <div className="p-4 bg-secondary/50 rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">Filters</h3>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear All
              </Button>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Direction</Label>
                <Select 
                  value={filters.direction} 
                  onValueChange={(value: any) => setFilters(prev => ({ ...prev, direction: value }))}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="in">Received</SelectItem>
                    <SelectItem value="out">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Type</Label>
                <Select 
                  value={filters.type} 
                  onValueChange={(value: any) => setFilters(prev => ({ ...prev, type: value }))}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="payment">Payment</SelectItem>
                    <SelectItem value="create_account">Account Creation</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Amount (XLM)</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Min"
                    type="number"
                    step="0.01"
                    value={filters.minAmount}
                    onChange={(e) => setFilters(prev => ({ ...prev, minAmount: e.target.value }))}
                    className="h-8"
                  />
                  <Input
                    placeholder="Max"
                    type="number"
                    step="0.01"
                    value={filters.maxAmount}
                    onChange={(e) => setFilters(prev => ({ ...prev, maxAmount: e.target.value }))}
                    className="h-8"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Date From</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-8 justify-start text-left font-normal",
                        !filters.dateFrom && "text-muted-foreground"
                      )}
                    >
                      <Calendar className="mr-2 h-3 w-3" />
                      {filters.dateFrom ? format(filters.dateFrom, "PPP") : "Pick date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={filters.dateFrom}
                      onSelect={(date) => setFilters(prev => ({ ...prev, dateFrom: date }))}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Date To</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-8 justify-start text-left font-normal",
                        !filters.dateTo && "text-muted-foreground"
                      )}
                    >
                      <Calendar className="mr-2 h-3 w-3" />
                      {filters.dateTo ? format(filters.dateTo, "PPP") : "Pick date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={filters.dateTo}
                      onSelect={(date) => setFilters(prev => ({ ...prev, dateTo: date }))}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Address</Label>
                <Input
                  placeholder="Search address..."
                  value={filters.addressFilter}
                  onChange={(e) => setFilters(prev => ({ ...prev, addressFilter: e.target.value }))}
                  className="h-8"
                />
              </div>
            </div>
          </div>
        )}

        {/* Aggregated Stats - removed avg amount */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="text-center p-4 bg-secondary/50 rounded-lg">
            <div className="text-2xl font-bold text-primary">{aggregatedStats.count}</div>
            <div className="text-xs text-muted-foreground">
              {selectedTransactions.size > 0 ? 'Selected' : 'Total'} Transactions
            </div>
          </div>
          <div className="text-center p-4 bg-secondary/50 rounded-lg">
            <div className="text-lg font-bold">{aggregatedStats.totalXLM.toFixed(2)} XLM</div>
            <div className="text-xs text-muted-foreground">Total Amount</div>
          </div>
          <div className="text-center p-4 bg-secondary/50 rounded-lg">
            <div className="text-lg font-bold">{formatFiatAmount(aggregatedStats.totalFiat)}</div>
            <div className="text-xs text-muted-foreground">Total Value</div>
          </div>
        </div>

        {selectedTransactions.size > 0 && (
          <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg">
            <span className="text-sm">
              {selectedTransactions.size} transaction(s) selected
            </span>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <EyeOff className="w-4 h-4 mr-2" />
              Clear Selection
            </Button>
          </div>
        )}

        {/* Enhanced Chart with Controls */}
        <TransactionChart 
          transactions={filteredTransactions}
          onRequestMoreData={handleRequestMoreData}
        />

        <Separator />

        {/* Transaction List */}
        <div className="space-y-2">
          {isLoading && transactions.length === 0 ? (
            <div className="text-center py-8">
              <RefreshCw className="w-6 h-6 mx-auto animate-spin text-muted-foreground mb-2" />
              <p className="text-muted-foreground">Loading transaction history...</p>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Hash className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No transactions found</p>
              <p className="text-sm mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <>
              {filteredTransactions.map((tx) => {
                const fiatAmount = fiatAmounts.get(tx.id) || 0;
                const isSelected = selectedTransactions.has(tx.id);
                
                return (
                  <div
                    key={tx.id}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer hover:bg-secondary/50",
                      isSelected && "bg-primary/10 border-primary/50"
                    )}
                    onClick={() => handleTransactionSelect(tx.id, !isSelected)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn(
                        "p-2 rounded-full transition-colors",
                        tx.direction === 'out' 
                          ? "bg-destructive/20 text-destructive"
                          : "bg-success/20 text-success"
                      )}>
                        {tx.direction === 'out' ? 
                          <ArrowUpRight className="w-4 h-4" /> : 
                          <ArrowDownLeft className="w-4 h-4" />
                        }
                      </div>
                      
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {tx.direction === 'out' ? 'Sent' : 'Received'} {tx.amount.toFixed(2)} XLM
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {tx.type}
                          </Badge>
                          {isSelected && (
                            <Eye className="w-4 h-4 text-primary" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span className="font-mono">
                            {truncateAddress(tx.counterparty)}
                          </span>
                          <span>•</span>
                          <span>
                            {formatDistanceToNow(tx.createdAt, { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="font-medium text-sm">
                          {formatFiatAmount(fiatAmount)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(tx.createdAt, 'MMM dd, HH:mm')}
                        </div>
                      </div>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(getHorizonTransactionUrl(network, tx.transactionHash), '_blank');
                        }}
                        className="shrink-0"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              {/* Load More Button */}
              {hasMore && (
                <div className="text-center pt-4">
                  <Button
                    onClick={loadMore}
                    variant="outline"
                    disabled={isLoading}
                    className="w-full sm:w-auto"
                  >
                    {isLoading ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <DollarSign className="w-4 h-4 mr-2" />
                    )}
                    Load More Transactions
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};