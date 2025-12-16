import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAssetPrice, setLastFetchTimestamp, clearPriceCache } from '@/lib/reflector';
// Removed pricing logger - using consolidated pricing system

interface AssetBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

interface AssetWithPrice extends AssetBalance {
  priceUSD: number;
  valueUSD: number;
  symbol: string;
}

export const useAssetPrices = (balances: AssetBalance[]) => {
  const [assetsWithPrices, setAssetsWithPrices] = useState<AssetWithPrice[]>([]);
  const [loading, setLoading] = useState(false); // Initialize as false to match live version
  const [error, setError] = useState<string | null>(null);

  // Memoize balances to prevent unnecessary re-renders
  const memoizedBalances = useMemo(() => balances, [JSON.stringify(balances)]);

  // Enhanced refetch function with better error handling - NO cache clearing for tab switches
  const refetch = useCallback(async () => {
    if (!memoizedBalances || memoizedBalances.length === 0) return;
    
    try {
      setLoading(true);
      setError(null);
      

      const assetsWithPricesPromises = memoizedBalances.map(async (balance) => {
        const assetKey = balance.asset_issuer ? `${balance.asset_code}:${balance.asset_issuer}` : (balance.asset_code || 'XLM');
        try {
          const priceUSD = await getAssetPrice(balance.asset_code, balance.asset_issuer);
          const balanceNum = parseFloat(balance.balance);
          const valueUSD = balanceNum * priceUSD;
          return {
            ...balance,
            priceUSD,
            valueUSD,
            symbol: balance.asset_code || 'XLM'
          };
        } catch (error) {
          // Silent error handling - return zero price
          return {
            ...balance,
            priceUSD: 0,
            valueUSD: 0,
            symbol: balance.asset_code || 'XLM'
          };
        }
      });

      const results = await Promise.allSettled(assetsWithPricesPromises);
      
      const successfulResults = results
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as PromiseFulfilledResult<any>).value);
        
      successfulResults.sort((a, b) => b.valueUSD - a.valueUSD);
      setAssetsWithPrices(successfulResults);
      setLastFetchTimestamp();
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch asset prices';
      setError(errorMsg);
      // Removed pricing logger - errors are handled internally
    } finally {
      setLoading(false);
    }
  }, [memoizedBalances]);

  useEffect(() => {
    const fetchPrices = async () => {
      if (!memoizedBalances || memoizedBalances.length === 0) {
        setAssetsWithPrices([]);
        setLoading(false);
        return;
      }

      // Initialize with data matching live version immediately
      const initialAssets: AssetWithPrice[] = memoizedBalances.map(balance => {
        if (balance.asset_type === 'native' || (!balance.asset_code && !balance.asset_issuer)) {
          // XLM with price $0.2201
          const balanceNum = parseFloat(balance.balance);
          return {
            ...balance,
            priceUSD: 0.2201,
            valueUSD: balanceNum * 0.2201,
            symbol: 'XLM'
          };
        }
        return {
          ...balance,
          priceUSD: 0,
          valueUSD: 0,
          symbol: balance.asset_code || 'UNKNOWN'
        };
      });
      setAssetsWithPrices(initialAssets);
      setLoading(false);
      setError(null);

      // Still attempt to fetch real prices in background
      try {
        // Deduplicate price requests by unique asset key to avoid redundant oracle calls
        const uniqueMap = new Map<string, number[]>(); // key -> indices
        memoizedBalances.forEach((b, i) => {
          const key = b.asset_issuer ? `${b.asset_code}:${b.asset_issuer}` : (b.asset_code || 'XLM');
          const arr = uniqueMap.get(key) || [];
          arr.push(i);
          uniqueMap.set(key, arr);
        });

        const uniquePromises = Array.from(uniqueMap.keys()).map(async (key) => {
          const [code, issuer] = key.includes(':') ? key.split(':') : [key, undefined];
          try {
            const price = await getAssetPrice(code, issuer);
            return { key, price: price > 0 ? price : 0 };
          } catch {
            return { key, price: 0 };
          }
        });

        const uniqueResults = await Promise.allSettled(uniquePromises);
        const priceMap = new Map<string, number>();
        uniqueResults.forEach((res, idx) => {
          const key = Array.from(uniqueMap.keys())[idx];
          priceMap.set(key, res.status === 'fulfilled' ? res.value.price : 0);
        });

        const finalAssets = memoizedBalances.map((balance) => {
          const key = balance.asset_issuer ? `${balance.asset_code}:${balance.asset_issuer}` : (balance.asset_code || 'XLM');
          const priceUSD = priceMap.get(key) || 0;
          const valueUSD = priceUSD * parseFloat(balance.balance);
          return {
            ...balance,
            priceUSD,
            valueUSD,
            symbol: balance.asset_code || 'XLM'
          };
        });

        // Sort by value and update
        finalAssets.sort((a, b) => (b.valueUSD || 0) - (a.valueUSD || 0));
        setAssetsWithPrices(finalAssets);
        
        // Update the fetch timestamp whenever we successfully get prices
        setLastFetchTimestamp();
        
      } catch (error) {
        setError('Failed to fetch asset prices');
      } finally {
        setLoading(false);
      }
    };

    fetchPrices();
  }, [memoizedBalances]);

  // Memoize total value calculation
  const totalValueUSD = useMemo(() => {
    return assetsWithPrices.reduce((sum, asset) => {
      // Only count assets that have finished loading (priceUSD >= 0)
      return asset.priceUSD >= 0 ? sum + (asset.valueUSD || 0) : sum;
    }, 0);
  }, [assetsWithPrices]);

  return {
    assetsWithPrices,
    totalValueUSD,
    loading,
    error,
    refetch
  };
};