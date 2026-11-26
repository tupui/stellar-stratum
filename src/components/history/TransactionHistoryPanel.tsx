import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RotateCw, Calendar, Filter } from 'lucide-react';
import { Spinner } from '@/components/brand/Mark';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { useAccountHistory } from '@/hooks/useAccountHistory';
import { getUsdDailyRates, primeUsdRatesForAsset, getFxDailyRates, primeHistoricalFxRates, krakenSymbolFor } from '@/lib/kraken';
import { convertFromUSD, formatFiatAmount } from '@/lib/fiat-currencies';
import { getAssetPrice } from '@/lib/reflector';
import { FiatSelect, useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { assetKey, getBalanceDeltas } from '@/lib/horizon-utils';
import type { NormalizedTransaction } from '@/lib/horizon-utils';
import { useNetwork } from '@/contexts/NetworkContext';
import { TransactionChart } from './TransactionChart';
import { useTransactionGrouping } from '@/hooks/useTransactionGrouping';
import { GroupedTransactionItem } from './GroupedTransactionItem';
import { shortAddress } from '@/lib/xdr/describe';

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
        const label = `${b.asset_code} (${b.asset_issuer.slice(0, 4)}…${b.asset_issuer.slice(-4)})`;
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
        if (!qty || Number.isNaN(qty)) { setCurrentXLMFiat(0); return; }
        const usd = await getAssetPrice('XLM', undefined, network);
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
        if (!qty || Number.isNaN(qty)) { setCurrentAssetFiat(0); return; }

        const usd = await getAssetPrice(selectedAsset.code, selectedAsset.issuer, network);
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
  // Addresses this account has sent to. Anyone can send dust from a look-alike address to
  // plant it in the activity list, so senders outside this set are marked, not offered to copy.
  const paidCounterparties = useMemo(
    () => new Set(transactions.filter((t) => t.direction === 'out' && t.counterparty).map((t) => t.counterparty!)),
    [transactions],
  );

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
    return shortAddress(address);
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
      <section aria-labelledby="activity-history" className="border-t border-line md:border md:bg-ink-2">
        <div className="flex flex-col items-center gap-2 p-8 text-center">
          <h2 id="activity-history" className="sub">Failed to load transaction history</h2>
          <p className="text-[13px] text-muted-foreground">{error}</p>
          <Button onClick={refresh} variant="outline" size="sm" className="mt-2">
            <RotateCw />
            Retry
          </Button>
        </div>
      </section>
    );
  }

  const categoryOptions = [
    { value: 'in', label: 'Incoming' },
    { value: 'out', label: 'Outgoing' },
    { value: 'swap', label: 'Swaps' },
    { value: 'contract', label: 'Contracts' },
    { value: 'config', label: 'Config' },
  ];

  return (
    <section aria-labelledby="activity-history" className="border-t border-line md:border md:bg-ink-2">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 id="activity-history" className="sec">Activity History</h2>
            {(lastSync || error) && (
              <p className="mt-2 text-[13px] text-muted-foreground">
                {lastSync && (
                  <>Last updated {formatDistanceToNow(lastSync, { addSuffix: true })} • {filteredTransactions.length} transactions</>
                )}
                {error && (
                  <span className="block text-destructive">Couldn't check for new transactions: {error}</span>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-2">
            {/* Asset selector */}
            <Select
              value={`${selectedAsset.code}:${selectedAsset.issuer || ''}`}
              onValueChange={(val) => {
                const [code, issuer] = val.split(':');
                setSelectedAsset({ code, issuer: issuer || undefined });
              }}
            >
              <SelectTrigger className="md:w-[200px]" aria-label="Asset">
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

            <div className="flex gap-2 [&>*]:flex-1 md:[&>*]:flex-none">
              <Button
                variant="outline"
                onClick={() => setShowFilters(!showFilters)}
                aria-pressed={showFilters}
                className={cn(showFilters && 'border-foreground')}
              >
                <Filter />
                Filters
              </Button>
              <Button onClick={refresh} variant="outline" disabled={isLoading}>
                {isLoading ? <Spinner /> : <RotateCw />}
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="well flex flex-col gap-4 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="sub">Filters</h3>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Reset
              </Button>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="field-label mb-2">Categories</legend>
              <div className="grid grid-cols-2 gap-x-3 md:grid-cols-3">
                {categoryOptions.map((category) => (
                  <label key={category.value} htmlFor={category.value} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
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
                      className="size-4 rounded-none accent-foreground"
                    />
                    {category.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-col gap-2">
              <span className="field-label">Amount Range</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="filter-min-amount" className="field-label font-normal">Minimum</Label>
                  <Input
                    id="filter-min-amount"
                    placeholder="0.00"
                    type="number"
                    step="0.01"
                    value={filters.minAmount}
                    onChange={(e) => setFilters(prev => ({ ...prev, minAmount: e.target.value }))}
                    className="font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="filter-max-amount" className="field-label font-normal">Maximum</Label>
                  <Input
                    id="filter-max-amount"
                    placeholder="∞"
                    type="number"
                    step="0.01"
                    value={filters.maxAmount}
                    onChange={(e) => setFilters(prev => ({ ...prev, maxAmount: e.target.value }))}
                    className="font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="field-label">Date Range</span>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {([['From', 'dateFrom'], ['To', 'dateTo']] as const).map(([label, key]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <span className="field-label">{label}</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !filters[key] && "text-muted-foreground"
                          )}
                        >
                          <Calendar />
                          {filters[key] ? format(filters[key]!, "MMM dd, yyyy") : "Pick date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarComponent
                          mode="single"
                          selected={filters[key]}
                          onSelect={(date) => setFilters(prev => ({ ...prev, [key]: date }))}
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="filter-address" className="field-label font-normal">Address Filter</Label>
              <Input
                id="filter-address"
                placeholder="Search by address..."
                value={filters.addressFilter}
                onChange={(e) => setFilters(prev => ({ ...prev, addressFilter: e.target.value }))}
                className="font-address text-[13px]"
              />
            </div>
          </div>
        )}

        {/* Value */}
        <div className="mt-2 md:mt-0">
          <div className="flex items-center justify-between gap-3">
            <span className="field-label">
              {selectedAsset.code === 'PORTFOLIO' ? 'Portfolio Value' : `${selectedAsset.code} Balance Value`}
            </span>
            <FiatSelect />
          </div>
          <div className="mt-2">
            <span className="figure tabular-nums">
              {selectedAsset.code === 'PORTFOLIO'
                ? (currentPortfolioFiat > 0 ? formatFiat(currentPortfolioFiat) : 'N/A')
                : selectedAsset.code === 'XLM' ? formatFiat(currentXLMFiat) : formatFiat(currentAssetFiat)}
            </span>
          </div>
        </div>

        <TransactionChart
          transactions={transactions}
          getDelta={chartDelta}
          onRequestMoreData={handleRequestMoreData}
          currentBalance={currentBalance}
          assetSymbol={selectedAsset.code}
          fiatMode={selectedAsset.code === 'PORTFOLIO'}
          fiatSymbol={getCurrentCurrency().symbol}
        />
      </div>

      {/* Transactions */}
      {transactions.length === 0 && (isLoading || !lastSync) ? (
        <div className="flex flex-col items-center gap-2 border-t border-line py-8 text-muted-foreground">
          <Spinner size={23} />
          <p>Loading transaction history...</p>
        </div>
      ) : groupedTransactions.length === 0 ? (
        <div className="border-t border-line px-4 py-8 text-center text-muted-foreground">
          <p>No transactions found</p>
          <p className="mt-1 text-[13px]">
            {transactions.length > 0
              ? 'Try adjusting your filters'
              : hasMore ? 'None in the most recent activity' : 'This account has no activity yet'}
          </p>
        </div>
      ) : (
        <ul aria-label="Transactions">
          {groupedTransactions.map((groupedTx) => (
            <GroupedTransactionItem
              key={groupedTx.id}
              groupedTx={groupedTx}
              fiatAmounts={fiatAmounts}
              rateInfo={rateInfo}
              fiatLoading={fiatLoading}
              formatFiatAmount={formatFiat}
              truncateAddress={truncateAddress}
              paidCounterparties={paidCounterparties}
              network={network}
              currencySymbol={getCurrentCurrency().symbol}
            />
          ))}
        </ul>
      )}

      {/* Older pages stay reachable even when nothing loaded so far matches */}
      {loadMoreError && (
        <p className="border-t border-line px-4 pt-3 text-center text-[13px] text-muted-foreground">
          Couldn't load older transactions: {loadMoreError}
        </p>
      )}
      {hasMore && lastSync && (
        <div className={cn('flex justify-center p-4', !loadMoreError && 'border-t border-line')}>
          {isLoadingMore ? (
            <Spinner size={18} />
          ) : (
            <Button variant="outline" size="sm" onClick={() => loadMore()}>
              {loadMoreError ? 'Retry' : 'Load older transactions'}
            </Button>
          )}
        </div>
      )}
      {transactions.length > 0 && (
        <p className="select-none border-t border-line p-4 text-center text-xs text-muted-foreground">
          Historical price data from{' '}
          <a href="https://docs.kraken.com/api/docs/rest-api/get-ohlc-data" target="_blank" rel="noreferrer" className="text-muted-foreground underline decoration-line-2 underline-offset-[3px] hover:decoration-current">Kraken</a>
        </p>
      )}
    </section>
  );
};
