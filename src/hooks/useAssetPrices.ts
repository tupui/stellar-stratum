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

      try {
        setLoading(true);
        setError(null);

        const assetsWithPricesPromises = balances.map(async (balance) => {
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
          } catch (err) {
            console.warn(`Failed to get price for ${balance.asset_code}:`, err);
            return {
              ...balance,
              priceUSD: 0,
              valueUSD: 0,
              symbol: balance.asset_code || 'XLM'
            };
          }
        });

        const results = await Promise.all(assetsWithPricesPromises);
        
        // Sort by USD value (highest first)
        results.sort((a, b) => b.valueUSD - a.valueUSD);
        
        setAssetsWithPrices(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch asset prices');
        console.error('Error fetching asset prices:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPrices();
  }, [balances]);

  const totalValueUSD = assetsWithPrices.reduce((sum, asset) => sum + asset.valueUSD, 0);

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
            const priceUSD = await getAssetPrice(balance.asset_code, balance.asset_issuer);
            const balanceNum = parseFloat(balance.balance);
            const valueUSD = balanceNum * priceUSD;
            
            return {
              ...balance,
              priceUSD,
              valueUSD,
              symbol: balance.asset_code || 'XLM'
            };
          } catch (err) {
            console.warn(`Failed to get price for ${balance.asset_code}:`, err);
            return {
              ...balance,
              priceUSD: 0,
              valueUSD: 0,
              symbol: balance.asset_code || 'XLM'
            };
          }
        });

        const results = await Promise.all(assetsWithPricesPromises);
        results.sort((a, b) => b.valueUSD - a.valueUSD);
        setAssetsWithPrices(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch asset prices');
      } finally {
        setLoading(false);
      }
    }
  };
};