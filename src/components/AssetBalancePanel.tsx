import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { RotateCw, ExternalLink } from 'lucide-react';
import { Spinner } from '@/components/brand/Mark';
import { Notice } from '@/components/brand/Shell';
import { AssetIcon } from './AssetIcon';
import { useAssetPrices } from '@/hooks/useAssetPrices';
import { getLastFetchTimestamp } from '@/lib/reflector';
import { getFxRate } from '@/lib/fiat-currencies';
import { FiatSelect, useFiatCurrency } from '@/contexts/FiatCurrencyContext';
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
/** A row action without a frame: a 32 px glyph area inside a 44 px hit area. */
const inlineIcon =
  'box-content inline-grid size-8 shrink-0 place-items-center -m-1.5 p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4';
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
    <li key={index} className="flex items-center gap-3 border-t border-line px-4 py-3">
      <AssetIcon assetCode={isPoolShare(asset) ? 'LP' : asset.asset_code} assetIssuer={asset.asset_type !== 'native' ? asset.asset_issuer : undefined} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold">{asset.symbol}</span>
          {!isPoolShare(asset) && (
            <a
              href={asset.source === 'defindex' && asset.sourceAddress
                ? getContractExplorerUrl(asset.sourceAddress)
                : getAssetExplorerUrl(asset.symbol, asset.asset_type !== 'native' ? asset.asset_issuer : undefined)}
              target="_blank"
              rel="noopener noreferrer"
              className={inlineIcon}
              aria-label={`${asset.symbol} in explorer`}
            >
              <ExternalLink />
            </a>
          )}
          {asset.asset_type === 'native' && <Badge className="shrink-0">Native</Badge>}
          {asset.source === 'defindex' && <Badge className="shrink-0">DeFindex</Badge>}
        </div>
        <p className="truncate text-[13px] text-muted-foreground">
          {asset.source === 'defindex'
            ? `Deposited in ${asset.sourceName || 'DeFindex vault'}`
            : asset.asset_type === 'native' ? 'Stellar Lumens' : isPoolShare(asset) ? 'Liquidity pool' : asset.asset_code}
        </p>
        {asset.priceUSD === -1
          ? <Spinner size={12} className="mt-1" />
          : <p className="truncate text-xs text-muted-foreground">
              {asset.priceUSD > 0 ? formatPrice(asset.priceUSD) : isPoolShare(asset) ? 'Not priced' : 'Price unavailable'}
            </p>}
      </div>
      <div className="min-w-0 shrink-0 text-right">
        <p className="max-w-[120px] truncate font-amount text-[15px] tabular-nums sm:max-w-[200px]">
          {formatBalance(asset.balance)}
        </p>
        <div className="flex max-w-[120px] justify-end truncate font-amount text-[13px] text-muted-foreground tabular-nums sm:max-w-[200px]">
          {asset.priceUSD === -1 ? <Spinner size={12} /> : formatValue(asset.valueUSD)}
        </div>
      </div>
    </li>
  );

  // A group of DeFindex deposits or wallet assets, under its own heading when both are held
  const groupHeading = (label: string, totalUSD: number) => (
    <li className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
      <span className="sub">{label}</span>
      <span className="font-amount text-[15px] tabular-nums">{formatSubTotal(totalUSD)}</span>
    </li>
  );

  const refreshing = loading || refreshingBalances;

  return (
    <section aria-labelledby="asset-balances" className="border-t border-line md:border md:bg-ink-2">
      <div className="p-4">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h2 id="asset-balances" className="sec">Asset Balances</h2>
          <Button variant="outline" size="icon" onClick={handleRefresh} disabled={refreshing} aria-label="Refresh balances">
            {refreshing ? <Spinner size={18} /> : <RotateCw className="!size-[18px]" />}
          </Button>
        </div>

        {/* Total value */}
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="field-label">Portfolio Value</span>
            <FiatSelect />
          </div>
          <div className="mt-2 min-h-[58px]">
            {loading
              ? <Spinner size={23} className="mt-4" />
              : <span className="figure">{formatValue(totalValueUSD)}</span>}
          </div>
          {fxRateUnavailable && <p className="mt-2 text-[13px] text-muted-foreground">
              {quoteCurrency} rate unavailable, values shown in USD
            </p>}
          {lastUpdateTime && <p className="mt-2 text-xs text-muted-foreground">
              Prices updated {formatLastUpdate(lastUpdateTime)} via{' '}
              <a href="https://reflector.network/" target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline decoration-line-2 underline-offset-[3px] hover:decoration-current">
                Reflector
              </a>
            </p>}

          {/* Breakdown: DeFindex deposits vs assets available in the wallet */}
          {!loading && hasDefindexPositions && (
            <div className="well mt-4 grid grid-cols-2 gap-3">
              <div>
                <p className="field-label">Deposited in DeFindex</p>
                <p className="font-amount text-[15px] tabular-nums">{formatSubTotal(defindexTotalUSD)}</p>
              </div>
              <div>
                <p className="field-label">Available in Wallet</p>
                <p className="font-amount text-[15px] tabular-nums">{formatSubTotal(walletTotalUSD)}</p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-2">
          <label htmlFor="hide-small" className="inline-flex min-h-11 items-center gap-3">
            <Switch id="hide-small" checked={hideSmallBalances} onCheckedChange={setHideSmallBalances} />
            Hide &lt; $1
          </label>
        </div>

        {error && <Notice level="error" className="mt-4">{error}</Notice>}
      </div>

      {/* Assets */}
      {loading && visibleAssets.length === 0 ? <div className="flex items-center justify-center gap-2 border-t border-line py-8 text-muted-foreground">
          <Spinner />
          <span>Loading prices...</span>
        </div> : visibleAssets.length === 0 ? <p className="border-t border-line py-8 text-center text-[13px] text-muted-foreground">
          {hideSmallBalances ? 'No assets above $1' : 'No assets found'}
        </p> : <ul aria-label="Assets">
          {defindexAssets.length > 0 && <>
              {groupHeading('Deposited in DeFindex', defindexTotalUSD)}
              {defindexAssets.map(renderAssetRow)}
              {groupHeading('Available in Wallet', walletTotalUSD)}
            </>}
          {walletAssets.length > 0
            ? walletAssets.map(renderAssetRow)
            : <li className="border-t border-line px-4 py-3 text-[13px] text-muted-foreground">
                {hideSmallBalances ? 'No wallet assets above $1' : 'No wallet assets'}
              </li>}
        </ul>}

      {/* Summary */}
      {visibleAssets.length > 0 && hideSmallBalances && <p className="border-t border-line px-4 py-3 text-[13px] text-muted-foreground">
          Filtering assets (&gt;= $1)
        </p>}
    </section>
  );
};
