import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { LoadingPill } from '@/components/ui/loading-pill';
import { RefreshCw, DollarSign, TrendingUp, Filter, Eye, EyeOff, Clock, ExternalLink, Landmark, Wallet } from 'lucide-react';
import { AssetIcon } from './AssetIcon';
import { useAssetPrices } from '@/hooks/useAssetPrices';
import { getLastFetchTimestamp } from '@/lib/reflector';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { useNetwork } from '@/contexts/NetworkContext';
interface AssetBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  // Present when the balance is held outside the wallet (e.g. deposited in a DeFindex vault)
  source?: 'defindex';
  sourceName?: string;
  sourceAddress?: string;
}
interface AssetBalancePanelProps {
  balances: AssetBalance[];
  onRefreshBalances?: () => Promise<void>;
}
export const AssetBalancePanel = ({
  balances,
  onRefreshBalances
}: AssetBalancePanelProps) => {
  const { network } = useNetwork();
  const {
    assetsWithPrices,
    totalValueUSD,
    loading,
    error,
    refetch
  } = useAssetPrices(balances);
  const {
    quoteCurrency,
    getCurrentCurrency
  } = useFiatCurrency();
  const [hideSmallBalances, setHideSmallBalances] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(() => getLastFetchTimestamp());
  const [converted, setConverted] = useState<{
    total: number;
    defindex: number;
    wallet: number;
    values: Record<number, number>;
    prices: Record<number, number>;
  }>({ total: totalValueUSD, defindex: 0, wallet: 0, values: {}, prices: {} });

  // Reflect the latest cache timestamp whenever prices resolve
  useEffect(() => {
    if (!loading) {
      const ts = getLastFetchTimestamp();
      if (ts) setLastUpdateTime(ts);
    }
  }, [loading, totalValueUSD]);

  const handleRefresh = useCallback(async () => {
    try {
      if (onRefreshBalances) {
        await onRefreshBalances();
      }
      await refetch();
    } catch (e) {
      // Ignore refresh errors - balances will be updated on next successful fetch
    } finally {
      setLastUpdateTime(new Date());
    }
  }, [onRefreshBalances, refetch]);

  const formatLastUpdate = useCallback((date: Date | null): string => {
    if (!date) return '';
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    if (diffInMinutes < 1) return 'just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    return date.toLocaleDateString();
  }, []);

  // Keep the original index into assetsWithPrices so converted value/price lookups stay correct after filtering
  const indexedAssets = useMemo(
    () => assetsWithPrices.map((asset, index) => ({ asset, index })),
    [assetsWithPrices]
  );

  // Filter assets based on hide small balances toggle (memoized for performance)
  const visibleAssets = useMemo(() =>
    hideSmallBalances ? indexedAssets.filter(({ asset }) => asset.valueUSD >= 1) : indexedAssets,
    [hideSmallBalances, indexedAssets]
  );

  const defindexAssets = useMemo(
    () => visibleAssets.filter(({ asset }) => asset.source === 'defindex'),
    [visibleAssets]
  );
  const walletAssets = useMemo(
    () => visibleAssets.filter(({ asset }) => asset.source !== 'defindex'),
    [visibleAssets]
  );

  // Portfolio breakdown in USD (unfiltered — the toggle only hides rows, not value)
  const defindexTotalUSD = useMemo(
    () => assetsWithPrices.reduce((sum, a) => (a.source === 'defindex' && a.priceUSD > 0 ? sum + (a.valueUSD || 0) : sum), 0),
    [assetsWithPrices]
  );
  const walletTotalUSD = totalValueUSD - defindexTotalUSD;
  const hasDefindexPositions = assetsWithPrices.some(a => a.source === 'defindex');

  // Recompute converted values when currency or prices change.
  useEffect(() => {
    if (quoteCurrency === 'USD') {
      setConverted({ total: totalValueUSD, defindex: defindexTotalUSD, wallet: walletTotalUSD, values: {}, prices: {} });
      return;
    }

    let cancelled = false;
    (async () => {
      const totalPromise = totalValueUSD
        ? convertFromUSD(totalValueUSD, quoteCurrency).catch(() => totalValueUSD)
        : Promise.resolve(totalValueUSD);
      const defindexPromise = defindexTotalUSD
        ? convertFromUSD(defindexTotalUSD, quoteCurrency).catch(() => defindexTotalUSD)
        : Promise.resolve(0);
      const walletPromise = walletTotalUSD
        ? convertFromUSD(walletTotalUSD, quoteCurrency).catch(() => walletTotalUSD)
        : Promise.resolve(0);

      const perAsset = assetsWithPrices.map((asset, i) =>
        Promise.all([
          asset.valueUSD > 0 ? convertFromUSD(asset.valueUSD, quoteCurrency).catch(() => null) : Promise.resolve(null),
          asset.priceUSD > 0 ? convertFromUSD(asset.priceUSD, quoteCurrency).catch(() => null) : Promise.resolve(null),
        ]).then(([v, p]) => ({ i, v, p })),
      );

      const [total, defindex, wallet, results] = await Promise.all([
        totalPromise,
        defindexPromise,
        walletPromise,
        Promise.all(perAsset),
      ]);
      if (cancelled) return;

      const values: Record<number, number> = {};
      const prices: Record<number, number> = {};
      for (const { i, v, p } of results) {
        if (v !== null) values[i] = v;
        if (p !== null) prices[i] = p;
      }
      setConverted({ total, defindex, wallet, values, prices });
    })();

    return () => { cancelled = true; };
  }, [totalValueUSD, defindexTotalUSD, walletTotalUSD, quoteCurrency, assetsWithPrices]);
  const formatPriceSync = (price: number, assetIndex: number): string => {
    if (price === 0) return 'N/A';
    const currency = getCurrentCurrency();
    const convertedPrice = converted.prices[assetIndex];
    // If we're in a non-USD quote but conversion failed, fall back to USD display
    const displayPrice = convertedPrice ?? price;
    const symbol = quoteCurrency !== 'USD' && convertedPrice === undefined ? '$' : currency.symbol;
    if (displayPrice < 0.01) return `${symbol}${displayPrice.toFixed(6)}`;
    if (displayPrice < 1) return `${symbol}${displayPrice.toFixed(4)}`;
    return `${symbol}${displayPrice.toFixed(2)}`;
  };
  const formatValueForAsset = (value: number, assetIndex: number): string => {
    if (value === 0) return 'N/A';
    const currency = getCurrentCurrency();
    const convertedValue = converted.values[assetIndex];
    const displayValue = convertedValue ?? value;
    const symbol = quoteCurrency !== 'USD' && convertedValue === undefined ? '$' : currency.symbol;
    if (displayValue < 0.01) return `<${symbol}0.01`;
    return `${symbol}${displayValue.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };
  const formatSubTotal = (usdValue: number, convertedValue: number): string => {
    const currency = getCurrentCurrency();
    const v = quoteCurrency === 'USD' ? usdValue : convertedValue;
    return `${currency.symbol}${v.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };
  const formatValueSync = (value: number): string => {
    const currency = getCurrentCurrency();
    // The cached converted total is only valid for the top-line value.
    const displayValue = value === totalValueUSD ? converted.total : value;
    if (displayValue === 0) return 'N/A';
    if (displayValue < 0.01) return `<${currency.symbol}0.01`;
    return `${currency.symbol}${displayValue.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };
  const formatBalance = (balance: string): string => {
    const num = parseFloat(balance);
    if (num === 0) return '0.00';
    if (num < 0.01) return num.toFixed(6);
    if (num < 1) return num.toFixed(4);
    // Always show 2 decimal places for consistent alignment
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const getAssetExplorerUrl = (assetCode: string, assetIssuer?: string): string => {
    const networkPath = network === 'testnet' ? 'testnet' : 'public';
    if (!assetIssuer || assetCode === 'XLM') {
      return `https://stellar.expert/explorer/${networkPath}/asset/XLM`;
    }
    return `https://stellar.expert/explorer/${networkPath}/asset/${assetCode}-${assetIssuer}`;
  };

  const getContractExplorerUrl = (contractAddress: string): string => {
    const networkPath = network === 'testnet' ? 'testnet' : 'public';
    return `https://stellar.expert/explorer/${networkPath}/contract/${contractAddress}`;
  };

  // index is the position in assetsWithPrices (used for converted value/price lookups)
  const renderAssetRow = (asset: (typeof assetsWithPrices)[number], index: number) => (
    <div key={index} className="p-4 border border-border/60 rounded-lg hover:bg-secondary/30 hover:border-border transition-smooth">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <AssetIcon assetCode={asset.asset_code} assetIssuer={asset.asset_type !== 'native' ? asset.asset_issuer : undefined} size={40} className="flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <a
                href={asset.source === 'defindex' && asset.sourceAddress
                  ? getContractExplorerUrl(asset.sourceAddress)
                  : getAssetExplorerUrl(asset.symbol, asset.asset_type !== 'native' ? asset.asset_issuer : undefined)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1 truncate"
              >
                <span className="truncate">{asset.symbol}</span>
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
              {asset.asset_type === 'native' && <Badge variant="outline" className="text-xs border-primary/30 text-primary flex-shrink-0">Native</Badge>}
              {asset.source === 'defindex' && (
                <Badge variant="secondary" className="text-xs flex-shrink-0 inline-flex items-center gap-1">
                  <Landmark className="w-3 h-3" />
                  DeFindex
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground/80 truncate">
              {asset.source === 'defindex'
                ? `Deposited in ${asset.sourceName || 'DeFindex vault'}`
                : asset.asset_type === 'native' ? 'Stellar Lumens' : asset.asset_code}
            </p>
            {asset.priceUSD === -1 ? <LoadingPill size="sm" className="mt-1" /> : asset.priceUSD > 0 ? <p className="text-xs text-muted-foreground/70 font-amount truncate max-w-[160px] sm:max-w-none">
                {formatPriceSync(asset.priceUSD, index)} per {asset.symbol}
              </p> : <p className="text-xs text-muted-foreground/70">
                Price unavailable
              </p>}
          </div>
        </div>

        <div className="text-right flex-shrink-0 min-w-0">
          <p className="font-amount font-semibold text-foreground tabular-nums truncate max-w-[100px] sm:max-w-[180px]">
            {formatBalance(asset.balance)}
          </p>
          <div className="text-sm font-medium text-primary flex justify-end font-amount truncate max-w-[100px] sm:max-w-[180px]">
            {asset.priceUSD === -1 ? <LoadingPill size="sm" /> : formatValueForAsset(asset.valueUSD, index)}
          </div>
        </div>
      </div>
    </div>
  );

  return <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Asset Balances
            </CardTitle>
            
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={loading} className="h-8 px-2">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        
        {/* Price Update Info */}
        {lastUpdateTime && <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
            <Clock className="w-3 h-3" />
            <span>Prices updated {formatLastUpdate(lastUpdateTime)}</span>
            <span className="text-muted-foreground/60">• </span>
            <a href="https://reflector.network/" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1">
              via Reflector
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>}

        {/* Total Value Display */}
        <div className="mt-4 p-4 bg-primary/5 rounded-lg border border-primary/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground/80">Total Portfolio Value</p>
              <p className="text-2xl font-bold font-amount">
                {loading ? <span className="bg-gradient-to-r from-success/60 via-success-glow to-success/60 bg-[length:200%_100%] animate-[glow-sweep_1.5s_ease-in-out_infinite] bg-clip-text text-transparent">Loading...</span> : <span className="text-primary">{formatValueSync(totalValueUSD)}</span>}
              </p>
            </div>
            <div className="text-sm text-muted-foreground"></div>
          </div>

          {/* Breakdown: DeFindex deposits vs assets available in the wallet */}
          {!loading && hasDefindexPositions && (
            <div className="mt-3 pt-3 border-t border-primary/10 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground/80 flex items-center gap-1.5">
                  <Landmark className="w-3.5 h-3.5" />
                  Deposited in DeFindex
                </p>
                <p className="font-amount font-semibold">{formatSubTotal(defindexTotalUSD, converted.defindex)}</p>
              </div>
              <div>
                <p className="text-muted-foreground/80 flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" />
                  Available in Wallet
                </p>
                <p className="font-amount font-semibold">{formatSubTotal(walletTotalUSD, converted.wallet)}</p>
              </div>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="flex items-center justify-start gap-4 p-3 bg-secondary/20 rounded-lg border border-border/50">
          <div className="flex items-center space-x-3">
            <Switch id="hide-small" checked={hideSmallBalances} onCheckedChange={setHideSmallBalances} />
            <Label htmlFor="hide-small" className="text-sm font-medium">Hide &lt; $1</Label>
          </div>
        </div>

        {/* Error Display */}
        {error && <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
          </div>}

        {/* Assets List */}
        {loading && visibleAssets.length === 0 ? <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-success" />
              <span className="text-success bg-gradient-to-r from-success/60 via-success-glow to-success/60 bg-[length:200%_100%] animate-[glow-sweep_1.5s_ease-in-out_infinite] bg-clip-text text-transparent font-medium">Loading prices...</span>
            </div>
          </div> : visibleAssets.length === 0 ? <div className="flex flex-col items-center justify-center py-8 text-center">
            <Filter className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {hideSmallBalances ? 'No assets above $1' : 'No assets found'}
            </p>
          </div> : <div className="space-y-5">
            {/* DeFindex deposits section */}
            {defindexAssets.length > 0 && <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Landmark className="w-4 h-4 text-primary" />
                    <span>Deposited in DeFindex</span>
                  </div>
                  <span className="text-sm font-amount font-medium text-primary">
                    {formatSubTotal(defindexTotalUSD, converted.defindex)}
                  </span>
                </div>
                {defindexAssets.map(({ asset, index }) => renderAssetRow(asset, index))}
              </div>}

            {/* Wallet assets section */}
            <div className="space-y-3">
              {defindexAssets.length > 0 && <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Wallet className="w-4 h-4 text-primary" />
                    <span>Available in Wallet</span>
                  </div>
                  <span className="text-sm font-amount font-medium text-primary">
                    {formatSubTotal(walletTotalUSD, converted.wallet)}
                  </span>
                </div>}
              {walletAssets.length > 0
                ? walletAssets.map(({ asset, index }) => renderAssetRow(asset, index))
                : <p className="text-sm text-muted-foreground py-2">
                    {hideSmallBalances ? 'No wallet assets above $1' : 'No wallet assets'}
                  </p>}
            </div>
          </div>}

        {/* Summary */}
        {visibleAssets.length > 0 && <>
            <Separator />
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">
                {hideSmallBalances && <span>Filtering assets (&gt;= $1)</span>}
              </span>
            </div>
          </>}
      </CardContent>
    </Card>;
};
