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
import { getFxRate } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useToast } from '@/hooks/use-toast';
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
// Classic liquidity pool shares have no code, issuer or explorer asset page, and are not priced
const isPoolShare = (asset: AssetBalance): boolean => asset.asset_type === 'liquidity_pool_shares';
interface AssetBalancePanelProps {
  balances: AssetBalance[];
  onRefreshBalances?: () => Promise<void>;
}
export const AssetBalancePanel = ({
  balances,
  onRefreshBalances
}: AssetBalancePanelProps) => {
  const { network } = useNetwork();
  const { toast } = useToast();
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
  const [refreshingBalances, setRefreshingBalances] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(() => getLastFetchTimestamp());
  // USD per 1 unit of the quote currency; null when the FX oracle had no rate
  const [fxRate, setFxRate] = useState<{ currency: string; usdPerUnit: number | null } | null>(null);

  // Reflect the latest cache timestamp whenever prices resolve
  useEffect(() => {
    if (!loading) {
      const ts = getLastFetchTimestamp();
      if (ts) setLastUpdateTime(ts);
    }
  }, [loading, totalValueUSD]);

  const handleRefresh = useCallback(async () => {
    if (onRefreshBalances) {
      setRefreshingBalances(true);
      try {
        await onRefreshBalances();
      } catch (e) {
        toast({
          title: 'Balances not refreshed',
          description: e instanceof Error ? e.message : 'Could not load the account. Try again in a moment.',
          variant: 'destructive',
        });
      } finally {
        setRefreshingBalances(false);
      }
    }
    await refetch();
  }, [onRefreshBalances, refetch, toast]);

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

  // Filter assets based on hide small balances toggle (memoized for performance)
  const visibleAssets = useMemo(() =>
    hideSmallBalances ? assetsWithPrices.filter((asset) => asset.valueUSD >= 1) : assetsWithPrices,
    [hideSmallBalances, assetsWithPrices]
  );

  const defindexAssets = useMemo(
    () => visibleAssets.filter((asset) => asset.source === 'defindex'),
    [visibleAssets]
  );
  const walletAssets = useMemo(
    () => visibleAssets.filter((asset) => asset.source !== 'defindex'),
    [visibleAssets]
  );

  // Portfolio breakdown in USD (unfiltered — the toggle only hides rows, not value)
  const defindexTotalUSD = useMemo(
    () => assetsWithPrices.reduce((sum, a) => (a.source === 'defindex' && a.priceUSD > 0 ? sum + (a.valueUSD || 0) : sum), 0),
    [assetsWithPrices]
  );
  const walletTotalUSD = totalValueUSD - defindexTotalUSD;
  const hasDefindexPositions = assetsWithPrices.some(a => a.source === 'defindex');

  // Load the quote currency's FX rate; re-read the (5 min cached) rate whenever prices refresh.
  useEffect(() => {
    if (quoteCurrency === 'USD') return;
    let cancelled = false;
    getFxRate(quoteCurrency).then(
      (usdPerUnit) => { if (!cancelled) setFxRate({ currency: quoteCurrency, usdPerUnit }); },
      () => { if (!cancelled) setFxRate({ currency: quoteCurrency, usdPerUnit: null }); },
    );
    return () => { cancelled = true; };
  }, [quoteCurrency, assetsWithPrices]);

  // Values are in USD and shown in the quote currency once its rate is known.
  // Until then, or when the FX oracle fails, they stay in USD with a '$'.
  const usdPerQuoteUnit = quoteCurrency === 'USD' ? 1 : fxRate?.currency === quoteCurrency ? fxRate.usdPerUnit : null;
  const fxRateUnavailable = quoteCurrency !== 'USD' && fxRate?.currency === quoteCurrency && fxRate.usdPerUnit === null;
  const symbol = usdPerQuoteUnit ? getCurrentCurrency().symbol : '$';
  const toQuote = (usd: number): number => (usdPerQuoteUnit ? usd / usdPerQuoteUnit : usd);

  const formatPrice = (priceUSD: number): string => {
    if (priceUSD === 0) return 'N/A';
    const price = toQuote(priceUSD);
    if (price < 0.01) return `${symbol}${price.toFixed(6)}`;
    if (price < 1) return `${symbol}${price.toFixed(4)}`;
    return `${symbol}${price.toFixed(2)}`;
  };
  const formatSubTotal = (usdValue: number): string =>
    `${symbol}${toQuote(usdValue).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  const formatValue = (usdValue: number): string => {
    if (usdValue === 0) return 'N/A';
    const value = toQuote(usdValue);
    if (value < 0.01) return `<${symbol}0.01`;
    return `${symbol}${value.toLocaleString(undefined, {
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
    // Only the issuer-less asset is native XLM: a token can be called "XLM" too.
    if (!assetIssuer) {
      return `https://stellar.expert/explorer/${networkPath}/asset/XLM`;
    }
    return `https://stellar.expert/explorer/${networkPath}/asset/${assetCode}-${assetIssuer}`;
  };

  const getContractExplorerUrl = (contractAddress: string): string => {
    const networkPath = network === 'testnet' ? 'testnet' : 'public';
    return `https://stellar.expert/explorer/${networkPath}/contract/${contractAddress}`;
  };

  const renderAssetRow = (asset: (typeof assetsWithPrices)[number], index: number) => (
    <div key={index} className="p-4 border border-border/60 rounded-lg hover:bg-secondary/30 hover:border-border transition-smooth">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <AssetIcon assetCode={isPoolShare(asset) ? 'LP' : asset.asset_code} assetIssuer={asset.asset_type !== 'native' ? asset.asset_issuer : undefined} size={40} className="flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {isPoolShare(asset) ? <span className="font-semibold text-foreground truncate">{asset.symbol}</span> : <a
                href={asset.source === 'defindex' && asset.sourceAddress
                  ? getContractExplorerUrl(asset.sourceAddress)
                  : getAssetExplorerUrl(asset.symbol, asset.asset_type !== 'native' ? asset.asset_issuer : undefined)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1 truncate"
              >
                <span className="truncate">{asset.symbol}</span>
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>}
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
                : asset.asset_type === 'native' ? 'Stellar Lumens' : isPoolShare(asset) ? 'Liquidity pool' : asset.asset_code}
            </p>
            {asset.priceUSD === -1 ? <LoadingPill size="sm" className="mt-1" /> : asset.priceUSD > 0 ? <p className="text-xs text-muted-foreground/70 font-amount truncate max-w-[160px] sm:max-w-none">
                {formatPrice(asset.priceUSD)} per {asset.symbol}
              </p> : <p className="text-xs text-muted-foreground/70">
                {isPoolShare(asset) ? 'Not priced' : 'Price unavailable'}
              </p>}
          </div>
        </div>

        <div className="text-right flex-shrink-0 min-w-0">
          <p className="font-amount font-semibold text-foreground tabular-nums truncate max-w-[100px] sm:max-w-[180px]">
            {formatBalance(asset.balance)}
          </p>
          <div className="text-sm font-medium text-primary flex justify-end font-amount truncate max-w-[100px] sm:max-w-[180px]">
            {asset.priceUSD === -1 ? <LoadingPill size="sm" /> : formatValue(asset.valueUSD)}
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
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={loading || refreshingBalances} className="h-8 px-2">
              <RefreshCw className={`w-4 h-4 ${loading || refreshingBalances ? 'animate-spin' : ''}`} />
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
                {loading ? <span className="bg-gradient-to-r from-success/60 via-success-glow to-success/60 bg-[length:200%_100%] animate-[glow-sweep_1.5s_ease-in-out_infinite] bg-clip-text text-transparent">Loading...</span> : <span className="text-primary">{formatValue(totalValueUSD)}</span>}
              </p>
              {fxRateUnavailable && <p className="text-xs text-muted-foreground mt-1">
                  {quoteCurrency} rate unavailable, values shown in USD
                </p>}
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
                <p className="font-amount font-semibold">{formatSubTotal(defindexTotalUSD)}</p>
              </div>
              <div>
                <p className="text-muted-foreground/80 flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5" />
                  Available in Wallet
                </p>
                <p className="font-amount font-semibold">{formatSubTotal(walletTotalUSD)}</p>
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
                    {formatSubTotal(defindexTotalUSD)}
                  </span>
                </div>
                {defindexAssets.map(renderAssetRow)}
              </div>}

            {/* Wallet assets section */}
            <div className="space-y-3">
              {defindexAssets.length > 0 && <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Wallet className="w-4 h-4 text-primary" />
                    <span>Available in Wallet</span>
                  </div>
                  <span className="text-sm font-amount font-medium text-primary">
                    {formatSubTotal(walletTotalUSD)}
                  </span>
                </div>}
              {walletAssets.length > 0
                ? walletAssets.map(renderAssetRow)
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
