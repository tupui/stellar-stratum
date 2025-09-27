import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
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
  Settings,
  Replace,
  Code2,
  Loader2
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { useAccountHistory } from '@/hooks/useAccountHistory';
import { useFiatConversion } from '@/hooks/useFiatConversion';
import { getXlmUsdRateForDate, primeXlmUsdRates, getUsdRateForDateByAsset, primeUsdRatesForAsset } from '@/lib/kraken';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { getAssetPrice } from '@/lib/reflector';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { getHorizonTransactionUrl } from '@/lib/horizon-utils';
import { useNetwork } from '@/contexts/NetworkContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { TransactionChart } from './TransactionChart';
import { LoadingPill } from '@/components/ui/loading-pill';
import { useTransactionGrouping } from '@/hooks/useTransactionGrouping';
import { GroupedTransactionItem } from './GroupedTransactionItem';

interface TransactionHistoryPanelProps {
  accountPublicKey: string;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
  }>;
}

interface Filters {
  categories: string[];
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

export const TransactionHistoryPanel = ({ accountPublicKey, balances }: TransactionHistoryPanelProps) => {
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
  
  const { formatFiatAmount } = useFiatConversion();
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();

  // Filter and selection state
  const [filters, setFilters] = useState<Filters>({
    categories: ['in', 'out', 'swap', 'contract', 'config'],
    minAmount: '',
    maxAmount: '',
    dateFrom: undefined,
    dateTo: undefined,
    addressFilter: '',
  });

  const [showFilters, setShowFilters] = useState(false);
  const [fiatAmounts, setFiatAmounts] = useState<Map<string, number>>(new Map());
  const [fiatLoading, setFiatLoading] = useState<boolean>(true);
  const [selectedAsset, setSelectedAsset] = useState<{ code: string; issuer?: string }>({ code: 'PORTFOLIO' });
  const [currentPortfolioFiat, setCurrentPortfolioFiat] = useState<number>(0);
  const [currentXLMFiat, setCurrentXLMFiat] = useState<number>(0);
  const [currentAssetFiat, setCurrentAssetFiat] = useState<number>(0);

  // Build asset options from balances
  const assetOptions = useMemo(() => {
    const options: Array<{ code: string; issuer?: string; label: string }> = [];
    options.push({ code: 'PORTFOLIO', label: 'Portfolio' });
    // XLM native
    options.push({ code: 'XLM', label: 'XLM' });
    balances.forEach((b) => {
      if (b.asset_type !== 'native' && b.asset_code && b.asset_issuer) {
        const label = `${b.asset_code} (${b.asset_issuer.slice(0, 4)}...${b.asset_issuer.slice(-4)})`;
        options.push({ code: b.asset_code, issuer: b.asset_issuer, label });
      }
    });
    // Deduplicate by code+issuer
    const seen = new Set<string>();
    return options.filter((o) => {
      const key = `${o.code}:${o.issuer || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [balances]);

  // Convert amounts to fiat based on asset prices and selected currency
  useEffect(() => {
    const convertAll = async () => {
      const newFiatAmounts = new Map<string, number>();
      
      if (transactions.length === 0) {
        setFiatAmounts(newFiatAmounts);
        setFiatLoading(false);
        return;
      }

      // Prime a single OHLC(365d) window up-front so per-tx lookups hit cache
      try {
        const earliest = transactions.reduce((min, tx) => tx.createdAt < min ? tx.createdAt : min, transactions[0].createdAt);
        const start = new Date(earliest);
        const end = new Date();
        await primeXlmUsdRates(start, end);
      } catch {
        // Ignore rate fetching errors, continue with current prices
      }

      // We compute fiat at transaction time using Kraken OHLC USD rates per asset and the transaction date
      // Prime non-XLM asset OHLC windows upfront so per-tx lookups hit cache as well
      try {
        const end = new Date();
        const assets = Array.from(new Set(transactions
          .filter(t => t.assetType !== 'native' && t.assetCode)
          .map(t => t.assetCode!)));
        await Promise.all(assets.map(code => {
          const earliestForAsset = transactions
            .filter(t => t.assetCode === code)
            .reduce((min, tx) => tx.createdAt < min ? tx.createdAt : min, transactions[0].createdAt);
          const s = new Date(earliestForAsset);
          return primeUsdRatesForAsset(code, s, end);
        }));
      } catch {
        // Ignore asset priming errors; we'll fall back to per-tx fetch
      }

      // Pre-compute FX factor once (USD -> target fiat)
      let fxFactor = 1;
      try {
        if (quoteCurrency !== 'USD') {
          fxFactor = await convertFromUSD(1, quoteCurrency);
        }
      } catch {
        fxFactor = 1;
      }

      for (const tx of transactions) {
        const txDate = tx.createdAt instanceof Date ? tx.createdAt : new Date(tx.createdAt);
        let usdPrice = 0;
        if (tx.assetType === 'native') {
          usdPrice = await getXlmUsdRateForDate(txDate);
        } else {
          // Non-XLM assets: use Kraken USD OHLC for the transaction date
          usdPrice = await getUsdRateForDateByAsset(tx.assetCode!, txDate);
        }

        if (!usdPrice || !tx.amount) {
          newFiatAmounts.set(tx.id, 0);
          continue;
        }
        const usdAmount = usdPrice * tx.amount;
        const fiatAmount = usdAmount * fxFactor;
        newFiatAmounts.set(tx.id, fiatAmount);
      }
      
      setFiatAmounts(newFiatAmounts);
      setFiatLoading(false);
    };

    convertAll();
  }, [transactions, quoteCurrency]);

  // Compute current portfolio fiat value from balances
  useEffect(() => {
    const computePortfolio = async () => {
      try {
        let totalUSD = 0;
        const tasks = balances.map(async (b) => {
          const qty = parseFloat(b.balance);
          if (!qty || Number.isNaN(qty)) return 0;
          if (b.asset_type === 'native') {
            const p = await getAssetPrice('XLM');
            return (p || 0) * qty;
          }
          if (b.asset_code && b.asset_issuer) {
            const p = await getAssetPrice(b.asset_code, b.asset_issuer);
            return (p || 0) * qty;
          }
          return 0;
        });
        const parts = await Promise.all(tasks);
        totalUSD = parts.reduce((a, b) => a + b, 0);

        if (quoteCurrency === 'USD') {
          setCurrentPortfolioFiat(totalUSD);
        } else {
          const converted = await convertFromUSD(totalUSD, quoteCurrency);
          setCurrentPortfolioFiat(converted);
        }
      } catch {
        setCurrentPortfolioFiat(0);
      }
    };
    computePortfolio();
  }, [balances, quoteCurrency]);

  // Compute current XLM balance in fiat for chart anchoring when viewing XLM
  useEffect(() => {
    const computeXLM = async () => {
      try {
        const xlm = balances.find(b => b.asset_type === 'native');
        const qty = xlm ? parseFloat(xlm.balance) : 0;
        if (!qty || Number.isNaN(qty)) { setCurrentXLMFiat(0); return; }
        const usd = await getAssetPrice('XLM');
        const valueUSD = (usd || 0) * qty;
        if (quoteCurrency === 'USD') setCurrentXLMFiat(valueUSD);
        else setCurrentXLMFiat(await convertFromUSD(valueUSD, quoteCurrency));
      } catch {
        setCurrentXLMFiat(0);
      }
    };
    computeXLM();
  }, [balances, quoteCurrency]);

  // Compute current selected asset balance in fiat
  useEffect(() => {
    const computeCurrentAsset = async () => {
      try {
        if (selectedAsset.code === 'PORTFOLIO' || selectedAsset.code === 'XLM') {
          setCurrentAssetFiat(0);
          return;
        }
        
        const asset = balances.find(b => 
          b.asset_code === selectedAsset.code && 
          b.asset_issuer === selectedAsset.issuer
        );
        const qty = asset ? parseFloat(asset.balance) : 0;
        if (!qty || Number.isNaN(qty)) { setCurrentAssetFiat(0); return; }
        
        const usd = await getAssetPrice(selectedAsset.code, selectedAsset.issuer);
        const valueUSD = (usd || 0) * qty;
        if (quoteCurrency === 'USD') setCurrentAssetFiat(valueUSD);
        else setCurrentAssetFiat(await convertFromUSD(valueUSD, quoteCurrency));
      } catch {
        setCurrentAssetFiat(0);
      }
    };
    computeCurrentAsset();
  }, [balances, selectedAsset, quoteCurrency]);

  // Filter transactions based on current filters and selected asset
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      // Category and direction filter combined
      if (filters.categories.length > 0) {
        const matchesCategory = tx.category && filters.categories.includes(tx.category);
        const matchesDirection = tx.direction && filters.categories.includes(tx.direction);
        if (!matchesCategory && !matchesDirection) return false;
      }
      // Asset filter
      if (selectedAsset.code !== 'PORTFOLIO') {
        if (selectedAsset.code === 'XLM') {
          if (tx.assetType && tx.assetType !== 'native') return false;
        } else {
          if (tx.assetCode && tx.assetCode !== selectedAsset.code) return false;
          if (selectedAsset.issuer && tx.assetIssuer && tx.assetIssuer !== selectedAsset.issuer) return false;
        }
      }

      // Direction filter is now handled in the categories section above
      
      // Amount filters
      if (filters.minAmount && (tx.amount || 0) < parseFloat(filters.minAmount)) {
        return false;
      }
      if (filters.maxAmount && (tx.amount || 0) > parseFloat(filters.maxAmount)) {
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
        if (!tx.counterparty || !tx.counterparty.toLowerCase().includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [transactions, filters, selectedAsset.code, selectedAsset.issuer]);

  // Group filtered transactions
  const groupedTransactions = useTransactionGrouping(filteredTransactions);

  // Calculate aggregated stats for grouped transactions (sum totals only)
  const aggregatedStats = useMemo((): AggregatedStats => {
    const count = filteredTransactions.length; // Use original count for stats
    const totalAsset = filteredTransactions.reduce((sum, tx) => {
      const amt = tx.amount || 0;
      if (!tx.direction) return sum + amt; // fallback
      return tx.direction === 'in' ? sum + amt : sum - amt;
    }, 0);
    
    let totalFiat = 0;
    filteredTransactions.forEach(tx => {
      const fiatAmount = fiatAmounts.get(tx.id) || 0;
      if (!tx.direction) { totalFiat += fiatAmount; return; }
      totalFiat += tx.direction === 'in' ? fiatAmount : -fiatAmount;
    });

    return {
      count,
      totalXLM: totalAsset,
      totalFiat,
      avgXLM: 0, // Remove avg calculation
      avgFiat: 0, // Remove avg calculation
    };
  }, [filteredTransactions, fiatAmounts]);

  // Auto-load more data progressively for better UX
  const handleRequestMoreData = async () => {
    await loadProgressively();
  };

  // Kick off progressive loading only if we need more data
  useEffect(() => {
    // Only start progressive loading if we have some transactions but want more
    if (transactions.length > 0 && transactions.length < 1000 && hasMore && !isLoading) {
      loadProgressively();
    }
  }, [transactions.length, hasMore, isLoading, loadProgressively]);

  const truncateAddress = (address?: string | null) => {
    if (!address || typeof address !== 'string') return '—';
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };



  const clearFilters = () => {
    setFilters({
      categories: ['in', 'out', 'swap', 'contract', 'config'],
      minAmount: '',
      maxAmount: '',
      dateFrom: undefined,
      dateTo: undefined,
      addressFilter: '',
    });
  };

  // Build transactions for chart (asset or portfolio filtered)
  const assetOnlyTransactions = useMemo(() => {
    if (selectedAsset.code === 'PORTFOLIO') {
      // For portfolio, include all transactions
      return transactions;
    }
    // For specific assets, filter transactions that affect that asset
    return transactions.filter((tx) => {
      if (selectedAsset.code === 'XLM') return tx.assetType === 'native';
      if (tx.assetCode !== selectedAsset.code) return false;
      if (selectedAsset.issuer && tx.assetIssuer !== selectedAsset.issuer) return false;
      return true;
    });
  }, [transactions, selectedAsset]);

  // Current balance for selected asset
  const currentBalance = useMemo(() => {
    if (selectedAsset.code === 'XLM') {
      const xlmBal = balances.find(b => b.asset_type === 'native');
      return xlmBal ? parseFloat(xlmBal.balance) : 0;
    }
    if (selectedAsset.code === 'PORTFOLIO') {
      return currentPortfolioFiat; // used only when fiatMode is true for portfolio
    }
    const b = balances.find(b => b.asset_code === selectedAsset.code && b.asset_issuer === selectedAsset.issuer);
    return b ? parseFloat(b.balance) : 0;
  }, [balances, selectedAsset, currentPortfolioFiat]);

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
              {lastSync && (
                <>Last updated {formatDistanceToNow(lastSync, { addSuffix: true })} • {filteredTransactions.length} transactions</>
              )}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {/* Asset selector */}
            <Select 
              value={`${selectedAsset.code}:${selectedAsset.issuer || ''}`}
              onValueChange={(val) => {
                const [code, issuer] = val.split(':');
                setSelectedAsset({ code, issuer: issuer || undefined });
              }}
            >
              <SelectTrigger className="h-8 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assetOptions.map((opt) => (
                  <SelectItem key={`${opt.code}:${opt.issuer || ''}`} value={`${opt.code}:${opt.issuer || ''}`}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
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

        {/* Attribution (CoinGecko) - Keep near the bottom */}
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Enhanced Filter Panel */}
        {showFilters && (
          <div className="border rounded-lg bg-card/50 backdrop-blur-sm">
            <div className="p-4 border-b border-border/50">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Filters</h3>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={clearFilters}
                  className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Reset
                </Button>
              </div>
            </div>
            
            <div className="p-4 space-y-6">
              {/* Categories Section */}
              <div className="space-y-3">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Categories</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { value: 'in', label: 'Incoming', icon: ArrowDownLeft },
                    { value: 'out', label: 'Outgoing', icon: ArrowUpRight },
                    { value: 'swap', label: 'Swaps', icon: Replace },
                    { value: 'contract', label: 'Contracts', icon: Code2 },
                    { value: 'config', label: 'Config', icon: Settings }
                  ].map((category) => (
                    <div key={category.value} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={category.value}
                        checked={filters.categories.includes(category.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFilters(prev => ({ 
                              ...prev, 
                              categories: [...prev.categories, category.value] 
                            }));
                          } else {
                            setFilters(prev => ({ 
                              ...prev, 
                              categories: prev.categories.filter(c => c !== category.value) 
                            }));
                          }
                        }}
                        className="rounded border-border"
                      />
                      <Label htmlFor={category.value} className="text-xs flex items-center gap-1 cursor-pointer">
                        <category.icon className="w-3 h-3" />
                        {category.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Row 2: Amount Range */}
              <div className="space-y-3">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount Range</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Minimum</Label>
                    <Input
                      placeholder="0.00"
                      type="number"
                      step="0.01"
                      value={filters.minAmount}
                      onChange={(e) => setFilters(prev => ({ ...prev, minAmount: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Maximum</Label>
                    <Input
                      placeholder="∞"
                      type="number"
                      step="0.01"
                      value={filters.maxAmount}
                      onChange={(e) => setFilters(prev => ({ ...prev, maxAmount: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Date Range */}
              <div className="space-y-3">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date Range</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "h-9 w-full justify-start text-left font-normal text-sm",
                            !filters.dateFrom && "text-muted-foreground"
                          )}
                        >
                          <Calendar className="mr-2 h-4 w-4" />
                          {filters.dateFrom ? format(filters.dateFrom, "MMM dd, yyyy") : "Pick date"}
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
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "h-9 w-full justify-start text-left font-normal text-sm",
                            !filters.dateTo && "text-muted-foreground"
                          )}
                        >
                          <Calendar className="mr-2 h-4 w-4" />
                          {filters.dateTo ? format(filters.dateTo, "MMM dd, yyyy") : "Pick date"}
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
                </div>
              </div>

              {/* Address Filter */}
              <div className="space-y-3">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Address Filter</Label>
                <Input
                  placeholder="Search by address..."
                  value={filters.addressFilter}
                  onChange={(e) => setFilters(prev => ({ ...prev, addressFilter: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        {/* Value Card */}
        <div className="mt-1 p-4 bg-primary/5 rounded-lg border border-primary/10">
          <div className="flex items-center justify-between">
            <div>
              {selectedAsset.code === 'PORTFOLIO' ? (
                <>
                  <p className="text-sm text-muted-foreground/80">Portfolio Value</p>
                  <p className="text-2xl font-bold text-primary font-amount tabular-nums">{formatFiatAmount(currentPortfolioFiat)}</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground/80">
                    {selectedAsset.code} Balance Value
                  </p>
                  <p className="text-2xl font-bold text-primary font-amount tabular-nums">
                    {selectedAsset.code === 'XLM' ? formatFiatAmount(currentXLMFiat) : formatFiatAmount(currentAssetFiat)}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Enhanced Chart with Controls */}
        <TransactionChart 
          transactions={assetOnlyTransactions}
          onRequestMoreData={handleRequestMoreData}
          currentBalance={currentBalance}
          assetSymbol={selectedAsset.code}
          fiatMode={selectedAsset.code === 'PORTFOLIO'}
          fiatAmountMap={fiatAmounts}
          fiatSymbol={getCurrentCurrency().symbol}
        />

        <Separator />

        {/* Transaction List */}
        <div className="space-y-2">
          {isLoading && transactions.length === 0 ? (
            <div className="text-center py-8">
              <RefreshCw className="w-6 h-6 mx-auto animate-spin text-muted-foreground mb-2" />
              <p className="text-muted-foreground">Loading transaction history...</p>
            </div>
          ) : groupedTransactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Hash className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No transactions found</p>
              <p className="text-sm mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <>
              {groupedTransactions
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map((groupedTx) => (
                  <GroupedTransactionItem
                    key={groupedTx.id}
                    groupedTx={groupedTx}
                    fiatAmounts={fiatAmounts}
                    fiatLoading={fiatLoading}
                    formatFiatAmount={formatFiatAmount}
                    truncateAddress={truncateAddress}
                    network={network}
                  />
                ))}

              {/* Load more / loading indicator */}
              {hasMore && (
                <div className="flex justify-center py-4">
                    {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    ) : (
                    <Button variant="ghost" size="sm" onClick={loadMore}>
                      Load older transactions
                    </Button>
                    )}
                </div>
              )}
              <div className="text-[11px] text-muted-foreground/80 mt-4 select-none text-center">
                Historical price data from <a href="https://docs.kraken.com/api/docs/rest-api/get-ohlc-data" target="_blank" rel="noreferrer" className="underline hover:text-foreground">Kraken</a>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};