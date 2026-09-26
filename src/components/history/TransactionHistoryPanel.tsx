import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  RefreshCw,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Filter,
  TrendingUp,
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
import { getUsdDailyRates, primeUsdRatesForAsset, getFxDailyRates, primeHistoricalFxRates, krakenSymbolFor } from '@/lib/kraken';
import { convertFromUSD, formatFiatAmount } from '@/lib/fiat-currencies';
import { getAssetPrice } from '@/lib/reflector';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { assetKey, getBalanceDeltas } from '@/lib/horizon-utils';
import type { NormalizedTransaction } from '@/lib/horizon-utils';
import { useNetwork } from '@/contexts/NetworkContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { TransactionChart } from './TransactionChart';
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
  totalPortfolioValueUSD?: number;
  /** Whether the Activity tab is currently visible. History is only fetched while active. */
  active?: boolean;
}

interface Filters {
  categories: string[];
  minAmount: string;
  maxAmount: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  addressFilter: string;
}

// The asset amounts an entry can be valued by, in order of preference: a swap
// is valued by what was paid, or by what was received when that has no price.
const valuationLegs = (tx: NormalizedTransaction) => tx.category === 'swap'
  ? [
      { assetType: tx.swapFromAssetType, assetCode: tx.swapFromAssetCode, assetIssuer: tx.swapFromAssetIssuer, amount: tx.swapFromAmount },
      { assetType: tx.swapToAssetType, assetCode: tx.swapToAssetCode, assetIssuer: tx.swapToAssetIssuer, amount: tx.swapToAmount },
    ]
  : [{ assetType: tx.assetType, assetCode: tx.assetCode, assetIssuer: tx.assetIssuer, amount: tx.amount }];

export const TransactionHistoryPanel = ({ accountPublicKey, balances, totalPortfolioValueUSD = 0, active = true }: TransactionHistoryPanelProps) => {
  const { network } = useNetwork();
  const isMobile = useIsMobile();

  const {
    transactions,
    isLoading,
    isLoadingMore,
    error,
    loadMoreError,
    hasMore,
    lastSync,
    loadMore,
    loadProgressively,
    refresh,
  } = useAccountHistory(accountPublicKey, active);
  
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();
  const formatFiat = (amount: number) => formatFiatAmount(amount, quoteCurrency);

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
  const [rateInfo, setRateInfo] = useState<Map<string, { assetRate: number; fxRate: number; asset: string }>>(new Map());
  const [fiatLoading, setFiatLoading] = useState<boolean>(true);
  // Today's price per asset (by assetKey) in the quote currency, for the portfolio curve
  const [currentPrices, setCurrentPrices] = useState<Map<string, number>>(new Map());
  const pricedCurrencyRef = useRef<string | null>(null);
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

  // Single derivation: prime caches once, then synchronously compute fiat amounts
  // for every transaction. Re-runs when transactions or quote currency change.
  // Only native XLM and known code+issuer pairs are priced (see krakenSymbolFor).
  useEffect(() => {
    let cancelled = false;

    const compute = async () => {
      // Blank every row only when nothing is priced in this currency yet; a newly
      // loaded page just fills in its own rows.
      if (pricedCurrencyRef.current !== quoteCurrency) setFiatLoading(true);

      const symbols = new Set<string>(['XLM']);
      for (const tx of transactions) {
        for (const leg of valuationLegs(tx)) {
          const symbol = krakenSymbolFor(network, leg.assetType, leg.assetCode, leg.assetIssuer);
          if (symbol) symbols.add(symbol);
        }
      }

      // Prime once. These are deduped + 24h-cached in localStorage by kraken.ts.
      const [usdToQuote] = await Promise.all([
        convertFromUSD(1, quoteCurrency),
        Promise.all([
          ...Array.from(symbols).map(symbol => primeUsdRatesForAsset(symbol).catch(() => {})),
          quoteCurrency !== 'USD'
            ? primeHistoricalFxRates('USD', quoteCurrency).catch(() => {})
            : Promise.resolve(),
        ]),
      ]);

      if (cancelled) return;

      // Parse each daily series once; every lookup below is synchronous.
      const usdRates = new Map(Array.from(symbols).map(symbol => [symbol, getUsdDailyRates(symbol)]));
      const fxRates = quoteCurrency === 'USD' ? null : getFxDailyRates('USD', quoteCurrency);

      const newFiat = new Map<string, number>();
      const newRate = new Map<string, { assetRate: number; fxRate: number; asset: string }>();
      const newPrices = new Map<string, number>();

      for (const tx of transactions) {
        // 0 means no value: N/A rows get no rateInfo, so their caption stays hidden.
        newFiat.set(tx.id, 0);
        for (const leg of valuationLegs(tx)) {
          const symbol = krakenSymbolFor(network, leg.assetType, leg.assetCode, leg.assetIssuer);
          if (!symbol) continue;
          const rates = usdRates.get(symbol)!;
          newPrices.set(assetKey(leg.assetType, leg.assetCode, leg.assetIssuer), rates.latest * usdToQuote);

          const assetRate = rates.on(tx.createdAt);
          const fxRate = fxRates ? fxRates.on(tx.createdAt) : 1;
          if (newRate.has(tx.id) || !leg.amount || assetRate <= 0 || fxRate <= 0) continue;
          newFiat.set(tx.id, leg.amount * assetRate * fxRate);
          newRate.set(tx.id, { assetRate, fxRate, asset: symbol });
        }
      }

      setFiatAmounts(newFiat);
      setRateInfo(newRate);
      setCurrentPrices(newPrices);
      setFiatLoading(false);
      pricedCurrencyRef.current = quoteCurrency;
    };

    compute();
    return () => { cancelled = true; };
  }, [transactions, quoteCurrency, network]);

  // Convert portfolio value to selected fiat currency
  useEffect(() => {
    const convertPortfolio = async () => {
      try {
        if (quoteCurrency === 'USD') {
          setCurrentPortfolioFiat(totalPortfolioValueUSD);
        } else {
          const converted = await convertFromUSD(totalPortfolioValueUSD, quoteCurrency);
          setCurrentPortfolioFiat(converted);
        }
      } catch {
        setCurrentPortfolioFiat(totalPortfolioValueUSD);
      }
    };
    convertPortfolio();
  }, [totalPortfolioValueUSD, quoteCurrency]);

  // Compute current XLM balance in fiat for chart anchoring when viewing XLM
  useEffect(() => {
    const computeXLM = async () => {
      try {
        const xlm = balances.find(b => b.asset_type === 'native');
        const qty = xlm ? parseFloat(xlm.balance) : 0;
        // Only mainnet assets have a market price
        if (!qty || Number.isNaN(qty) || network !== 'mainnet') { setCurrentXLMFiat(0); return; }
        const usd = await getAssetPrice('XLM');
        const valueUSD = (usd || 0) * qty;
        if (quoteCurrency === 'USD') setCurrentXLMFiat(valueUSD);
        else setCurrentXLMFiat(await convertFromUSD(valueUSD, quoteCurrency));
      } catch {
        setCurrentXLMFiat(0);
      }
    };
    computeXLM();
  }, [balances, quoteCurrency, network]);

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
        if (!qty || Number.isNaN(qty) || network !== 'mainnet') { setCurrentAssetFiat(0); return; }

        const usd = await getAssetPrice(selectedAsset.code, selectedAsset.issuer);
        const valueUSD = (usd || 0) * qty;
        if (quoteCurrency === 'USD') setCurrentAssetFiat(valueUSD);
        else setCurrentAssetFiat(await convertFromUSD(valueUSD, quoteCurrency));
      } catch {
        setCurrentAssetFiat(0);
      }
    };
    computeCurrentAsset();
  }, [balances, selectedAsset, quoteCurrency, network]);

  // Asset the list and chart are narrowed to; null for the whole portfolio
  const selectedKey = selectedAsset.code === 'PORTFOLIO'
    ? null
    : selectedAsset.code === 'XLM'
      ? 'native'
      : assetKey('credit', selectedAsset.code, selectedAsset.issuer);

  // Filter transactions based on current filters and selected asset
  const filteredTransactions = useMemo(() => {
    const filtered = transactions.filter(tx => {
      // Incoming/Outgoing apply to transfers; every other category has its own checkbox
      if (filters.categories.length > 0) {
        const filterKey = tx.category === 'transfer' ? tx.direction : tx.category;
        if (!filterKey || !filters.categories.includes(filterKey)) return false;
      }

      // Asset filter: keep entries with a leg in the selected asset, and those that move no asset
      if (selectedKey !== null) {
        const keys = valuationLegs(tx)
          .filter(leg => leg.assetType)
          .map(leg => assetKey(leg.assetType, leg.assetCode, leg.assetIssuer));
        if (keys.length > 0 && !keys.includes(selectedKey)) return false;
      }

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
    
    return filtered;
  }, [transactions, filters, selectedKey]);

  // Group filtered transactions
  const groupedTransactions = useTransactionGrouping(filteredTransactions);

  // Navigating the chart back in time loads a few more older pages
  const handleRequestMoreData = async () => {
    await loadProgressively();
  };

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

  // What a transaction did to the charted balance: the selected asset's change,
  // or for the portfolio every change valued at today's price. One price basis
  // keeps the curve consistent with today's value, and makes swaps roughly neutral.
  const chartDelta = useCallback((tx: NormalizedTransaction) =>
    getBalanceDeltas(tx).reduce((sum, delta) => {
      const key = assetKey(delta.assetType, delta.assetCode, delta.assetIssuer);
      if (selectedKey === null) return sum + delta.amount * (currentPrices.get(key) ?? 0);
      return key === selectedKey ? sum + delta.amount : sum;
    }, 0),
  [selectedKey, currentPrices]);

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

  // With nothing to show, a failed load takes the whole panel; otherwise the
  // loaded history stays and the error is shown inline.
  if (error && transactions.length === 0) {
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
              {error && (
                <span className="block text-destructive">Couldn't check for new transactions: {error}</span>
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
                  <p className="text-2xl font-bold text-primary font-amount tabular-nums">{formatFiat(currentPortfolioFiat)}</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground/80">
                    {selectedAsset.code} Balance Value
                  </p>
                  <p className="text-2xl font-bold text-primary font-amount tabular-nums">
                    {selectedAsset.code === 'XLM' ? formatFiat(currentXLMFiat) : formatFiat(currentAssetFiat)}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Enhanced Chart with Controls */}
        <TransactionChart
          transactions={transactions}
          getDelta={chartDelta}
          onRequestMoreData={handleRequestMoreData}
          currentBalance={currentBalance}
          assetSymbol={selectedAsset.code}
          fiatMode={selectedAsset.code === 'PORTFOLIO'}
          fiatSymbol={getCurrentCurrency().symbol}
        />

        <Separator />

        {/* Transaction List */}
        <div className="space-y-2">
          {transactions.length === 0 && (isLoading || !lastSync) ? (
            <div className="text-center py-8">
              <RefreshCw className="w-6 h-6 mx-auto animate-spin text-muted-foreground mb-2" />
              <p className="text-muted-foreground">Loading transaction history...</p>
            </div>
          ) : groupedTransactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Hash className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No transactions found</p>
              <p className="text-sm mt-1">
                {transactions.length > 0
                  ? 'Try adjusting your filters'
                  : hasMore ? 'None in the most recent activity' : 'This account has no activity yet'}
              </p>
            </div>
          ) : (
            groupedTransactions.map((groupedTx) => (
              <GroupedTransactionItem
                key={groupedTx.id}
                groupedTx={groupedTx}
                fiatAmounts={fiatAmounts}
                rateInfo={rateInfo}
                fiatLoading={fiatLoading}
                formatFiatAmount={formatFiat}
                truncateAddress={truncateAddress}
                network={network}
                currencySymbol={getCurrentCurrency().symbol}
              />
            ))
          )}

          {/* Older pages stay reachable even when nothing loaded so far matches */}
          {loadMoreError && (
            <p className="text-center text-sm text-muted-foreground pt-2">
              Couldn't load older transactions: {loadMoreError}
            </p>
          )}
          {hasMore && lastSync && (
            <div className="flex justify-center py-4">
              {isLoadingMore ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                <Button variant="ghost" size="sm" onClick={() => loadMore()}>
                  {loadMoreError ? 'Retry' : 'Load older transactions'}
                </Button>
              )}
            </div>
          )}
          {transactions.length > 0 && (
            <div className="text-[11px] text-muted-foreground/80 mt-4 select-none text-center">
              Historical price data from <a href="https://docs.kraken.com/api/docs/rest-api/get-ohlc-data" target="_blank" rel="noreferrer" className="underline hover:text-foreground">Kraken</a>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};