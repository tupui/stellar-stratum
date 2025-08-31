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
        // Initialize assets with loading state (priceUSD = -1 indicates loading)
        const initialAssets: AssetWithPrice[] = balances.map(balance => ({
          ...balance,
          priceUSD: -1, // Special value to indicate loading
          valueUSD: 0,
          symbol: balance.asset_code || 'XLM'
        }));
        setAssetsWithPrices(initialAssets);

        // Fetch all prices in parallel without delays - should be instant for small numbers
        const pricePromises = balances.map(async (balance, index) => {
          try {
            const price = await getAssetPrice(balance.asset_code, balance.asset_issuer);
            const priceUSD = price > 0 ? price : 0;
            const valueUSD = priceUSD * parseFloat(balance.balance);
            
            return {
              index,
              asset: {
                ...balance,
                priceUSD,
                valueUSD,
                symbol: balance.asset_code || 'XLM'
              }
            };
          } catch (error) {
            console.warn(`Failed to fetch price for ${balance.asset_code}:`, error);
            return {
              index,
              asset: {
                ...balance,
                priceUSD: 0,
                valueUSD: 0,
                symbol: balance.asset_code || 'XLM'
              }
            };
          }
        });

        // Wait for all prices to resolve
        const results = await Promise.allSettled(pricePromises);
        
        // Update all assets at once
        const finalAssets = new Array(balances.length);
        results.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            finalAssets[result.value.index] = result.value.asset;
          } else {
            // Fallback for rejected promises
            finalAssets[i] = {
              ...balances[i],
              priceUSD: 0,
              valueUSD: 0,
              symbol: balances[i].asset_code || 'XLM'
            };
          }
        });
        
        setAssetsWithPrices(finalAssets)
        
        // Final sort by value
        setAssetsWithPrices(prev => 
          [...prev].sort((a, b) => (b.valueUSD || 0) - (a.valueUSD || 0))
        );
        
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