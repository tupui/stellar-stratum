import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getAssetPrice, clearPriceCache } from '@/lib/reflector';
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

interface AssetWithPrice extends AssetBalance {
  priceUSD: number; // -1 = loading, 0 = unavailable, >0 = resolved
  valueUSD: number;
  symbol: string;
}

// Classic liquidity pool shares have no code or issuer and are not priced.
const isPoolShare = (b: AssetBalance): boolean => b.asset_type === 'liquidity_pool_shares';

const assetKey = (b: AssetBalance): string =>
  isPoolShare(b) ? 'LP' : b.asset_issuer ? `${b.asset_code}:${b.asset_issuer}` : (b.asset_code || 'XLM');

const symbolFor = (b: AssetBalance): string =>
  b.asset_type === 'native' ? 'XLM' : isPoolShare(b) ? 'LP shares' : (b.asset_code || 'UNKNOWN');

export const useAssetPrices = (balances: AssetBalance[]) => {
  const { network } = useNetwork();
  const [assetsWithPrices, setAssetsWithPrices] = useState<AssetWithPrice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Only the latest pricing run may update state; older runs finish silently.
  const latestRun = useRef(0);

  // Memoize the balances array by a stable content key so callers passing a
  // fresh array reference each render don't re-trigger the price fetch.
  const balancesKey = balances.map((b) => `${assetKey(b)}|${b.balance}`).join('~');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content, not by reference
  const memoizedBalances = useMemo(() => balances, [balancesKey]);

  const resolvePrices = useCallback(async () => {
    const run = ++latestRun.current;
    const toRow = (b: AssetBalance, priceUSD: number): AssetWithPrice => {
      const balanceNum = parseFloat(b.balance);
      return {
        ...b,
        priceUSD,
        valueUSD: priceUSD > 0 && Number.isFinite(balanceNum) ? priceUSD * balanceNum : 0,
        symbol: symbolFor(b),
      };
    };

    // Reflector only prices mainnet assets: testnet balances have no market value.
    if (network !== 'mainnet' || memoizedBalances.length === 0) {
      setAssetsWithPrices(memoizedBalances.map((b) => toRow(b, 0)));
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // Seed rows with loading sentinel (-1) so per-row UI can show a loading state
    setAssetsWithPrices(memoizedBalances.map((b) => toRow(b, isPoolShare(b) ? 0 : -1)));

    try {
      // Dedupe by unique asset key to avoid redundant oracle calls
      const pricedAssets = new Map<string, AssetBalance>();
      for (const b of memoizedBalances) {
        if (!isPoolShare(b)) pricedAssets.set(assetKey(b), b);
      }

      const priceEntries = await Promise.all(
        Array.from(pricedAssets, async ([k, b]) => {
          try {
            const price = await getAssetPrice(b.asset_code, b.asset_issuer);
            return [k, price > 0 ? price : 0] as const;
          } catch {
            return [k, 0] as const;
          }
        })
      );
      if (run !== latestRun.current) return;
      const priceMap = new Map<string, number>(priceEntries);

      const resolved = memoizedBalances.map((b) => toRow(b, priceMap.get(assetKey(b)) ?? 0));
      resolved.sort((a, b) => (b.valueUSD || 0) - (a.valueUSD || 0));
      setAssetsWithPrices(resolved);
    } catch (err) {
      if (run === latestRun.current) setError(err instanceof Error ? err.message : 'Failed to fetch asset prices');
    } finally {
      if (run === latestRun.current) setLoading(false);
    }
  }, [memoizedBalances, network]);

  // Manual refresh: bust caches so the user actually sees a fresh round-trip.
  // Pricing then reruns from the effect, on the balances of the latest render.
  const refetch = useCallback(async () => {
    await clearPriceCache();
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    resolvePrices();
  }, [resolvePrices, refreshKey]);

  // Total only counts resolved (>0) prices; -1 (loading) and 0 (unavailable) are excluded
  const totalValueUSD = useMemo(
    () => assetsWithPrices.reduce((sum, a) => (a.priceUSD > 0 ? sum + (a.valueUSD || 0) : sum), 0),
    [assetsWithPrices]
  );

  return {
    assetsWithPrices,
    totalValueUSD,
    loading,
    error,
    refetch,
  };
};
