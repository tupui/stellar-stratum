import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAssetPrice, setLastFetchTimestamp, clearPriceCache } from '@/lib/reflector';

interface AssetBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

interface AssetWithPrice extends AssetBalance {
  priceUSD: number; // -1 = loading, 0 = unavailable, >0 = resolved
  valueUSD: number;
  symbol: string;
}

const assetKey = (b: AssetBalance): string =>
  b.asset_issuer ? `${b.asset_code}:${b.asset_issuer}` : (b.asset_code || 'XLM');

const symbolFor = (b: AssetBalance): string =>
  b.asset_type === 'native' || (!b.asset_code && !b.asset_issuer) ? 'XLM' : (b.asset_code || 'UNKNOWN');

export const useAssetPrices = (balances: AssetBalance[]) => {
  const [assetsWithPrices, setAssetsWithPrices] = useState<AssetWithPrice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize the balances array by a stable content key so callers passing a
  // fresh array reference each render don't re-trigger the price fetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoizedBalances = useMemo(
    () => balances,
    [balances.map((b) => `${assetKey(b)}|${b.balance}`).join('~')],
  );

  const resolvePrices = useCallback(async (invalidateCache: boolean) => {
    if (!memoizedBalances || memoizedBalances.length === 0) {
      setAssetsWithPrices([]);
      setLoading(false);
      return;
    }

    if (invalidateCache) {
      await clearPriceCache();
    }

    setLoading(true);
    setError(null);

    // Seed rows with loading sentinel (-1) so per-row UI can show a loading state
    const seeded: AssetWithPrice[] = memoizedBalances.map(b => ({
      ...b,
      priceUSD: -1,
      valueUSD: 0,
      symbol: symbolFor(b),
    }));
    setAssetsWithPrices(seeded);

    try {
      // Dedupe by unique asset key to avoid redundant oracle calls
      const uniqueMap = new Map<string, number[]>();
      memoizedBalances.forEach((b, i) => {
        const k = assetKey(b);
        const arr = uniqueMap.get(k) || [];
        arr.push(i);
        uniqueMap.set(k, arr);
      });

      const priceEntries = await Promise.all(
        Array.from(uniqueMap.keys()).map(async (k) => {
          const [code, issuer] = k.includes(':') ? k.split(':') : [k, undefined];
          try {
            const price = await getAssetPrice(code, issuer);
            return [k, price > 0 ? price : 0] as const;
          } catch {
            return [k, 0] as const;
          }
        })
      );
      const priceMap = new Map<string, number>(priceEntries);

      const resolved = memoizedBalances.map((b) => {
        const priceUSD = priceMap.get(assetKey(b)) ?? 0;
        const balanceNum = parseFloat(b.balance);
        return {
          ...b,
          priceUSD,
          valueUSD: priceUSD * (Number.isFinite(balanceNum) ? balanceNum : 0),
          symbol: symbolFor(b),
        };
      });

      resolved.sort((a, b) => (b.valueUSD || 0) - (a.valueUSD || 0));
      setAssetsWithPrices(resolved);
      setLastFetchTimestamp();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch asset prices');
    } finally {
      setLoading(false);
    }
  }, [memoizedBalances]);

  // Manual refresh: bust caches so the user actually sees a fresh round-trip
  const refetch = useCallback(() => resolvePrices(true), [resolvePrices]);

  useEffect(() => {
    resolvePrices(false);
  }, [resolvePrices]);

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
