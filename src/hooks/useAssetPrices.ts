import { useState, useEffect } from 'react';
import { getAssetPrice } from '@/lib/reflector';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPrices = async () => {
      if (!balances || balances.length === 0) {
        setAssetsWithPrices([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Initialize assets skeleton
        const initialAssets: AssetWithPrice[] = balances.map(balance => ({
          ...balance,
          priceUSD: -1,
          valueUSD: 0,
          symbol: balance.asset_code || 'XLM'
        }));
        setAssetsWithPrices(initialAssets);

        // Deduplicate price requests by unique asset key to avoid redundant oracle calls
        const uniqueMap = new Map<string, number[]>(); // key -> indices
        balances.forEach((b, i) => {
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

        const finalAssets = balances.map((balance) => {
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
        
      } catch (error) {
        console.error('Error fetching prices:', error);
        setError('Failed to fetch asset prices');
      } finally {
        setLoading(false);
      }
    };

    fetchPrices();
  }, [balances]);

  const totalValueUSD = assetsWithPrices.reduce((sum, asset) => {
    // Only count assets that have finished loading (priceUSD >= 0)
    return asset.priceUSD >= 0 ? sum + (asset.valueUSD || 0) : sum;
  }, 0);

  return {
    assetsWithPrices,
    totalValueUSD,
    loading,
    error,
    refetch: async () => {
      if (!balances || balances.length === 0) return;
      
      try {
        setLoading(true);
        setError(null);

        const assetsWithPricesPromises = balances.map(async (balance) => {
          try {
            console.log(`Fetching price for ${balance.asset_code || 'XLM'}`);
            const priceUSD = await getAssetPrice(balance.asset_code, balance.asset_issuer);
            console.log(`Got price for ${balance.asset_code || 'XLM'}: $${priceUSD}`);
            const balanceNum = parseFloat(balance.balance);
            const valueUSD = balanceNum * priceUSD;
            
            return {
              ...balance,
              priceUSD,
              valueUSD,
              symbol: balance.asset_code || 'XLM'
            };
          } catch (err) {
            console.warn(`Failed to get price for ${balance.asset_code || 'XLM'}:`, err);
            return {
              ...balance,
              priceUSD: 0,
              valueUSD: 0,
              symbol: balance.asset_code || 'XLM'
            };
          }
        });

        console.log('Waiting for all price fetches to complete...');
        const results = await Promise.allSettled(assetsWithPricesPromises);
        console.log('All price fetch results:', results);
        
        const successfulResults = results
          .filter(result => result.status === 'fulfilled')
          .map(result => (result as PromiseFulfilledResult<any>).value);
          
        successfulResults.sort((a, b) => b.valueUSD - a.valueUSD);
        setAssetsWithPrices(successfulResults);
        
        console.log('Updated asset prices:', successfulResults.map(a => `${a.symbol}: $${a.priceUSD}`));
      } catch (err) {
        console.error('Price refetch failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch asset prices');
      } finally {
        setLoading(false);
      }
    }
  };
};