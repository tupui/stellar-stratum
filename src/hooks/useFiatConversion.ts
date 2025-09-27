import { useState, useEffect, useCallback, useMemo } from 'react';
import { getFxRate } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { getAssetPrice } from '@/lib/reflector';

interface FiatConversionHook {
  convertXLMToFiat: (xlmAmount: number) => Promise<number>;
  formatFiatAmount: (amount: number) => string;
  isLoading: boolean;
  error: string | null;
  exchangeRate: number | null;
}

export const useFiatConversion = (): FiatConversionHook => {
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch exchange rate when currency changes
  useEffect(() => {
    const fetchRate = async () => {
      if (quoteCurrency === 'USD') {
        setExchangeRate(1);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const rate = await getFxRate(quoteCurrency);
        setExchangeRate(rate);
      } catch (err) {
        setError(`Failed to fetch exchange rate for ${quoteCurrency}`);
        setExchangeRate(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRate();
  }, [quoteCurrency]);

  const convertXLMToFiat = useCallback(async (xlmAmount: number): Promise<number> => {
    try {
      // Get current XLM/USD rate from oracle
      const xlmToUsdRate = await getAssetPrice('XLM');
      const usdAmount = xlmAmount * xlmToUsdRate;

      if (quoteCurrency === 'USD') {
        return usdAmount;
      }

      if (exchangeRate) {
        return usdAmount * exchangeRate;
      }

      // If no rate available, return USD amount
      return usdAmount;
    } catch (err) {
      throw new Error('Failed to convert XLM to fiat');
    }
  }, [quoteCurrency, exchangeRate]);

  const formatFiatAmount = useCallback((amount: number): string => {
    const currency = getCurrentCurrency();
    
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency.code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      // Fallback if currency not supported by Intl.NumberFormat
      return `${currency.symbol}${amount.toFixed(2)}`;
    }
  }, [getCurrentCurrency]);

  return {
    convertXLMToFiat,
    formatFiatAmount,
    isLoading,
    error,
    exchangeRate,
  };
};