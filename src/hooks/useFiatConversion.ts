import { useState, useEffect } from 'react';
import { getFxRate } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';

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

  const convertXLMToFiat = async (xlmAmount: number): Promise<number> => {
    try {
      // First, we need to get USD price of XLM (this would require a price API)
      // For now, we'll use a placeholder - in a real implementation,
      // you'd fetch XLM/USD rate from a crypto API like CoinGecko
      const xlmToUsdRate = 0.12; // Placeholder XLM/USD rate
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
  };

  const formatFiatAmount = (amount: number): string => {
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
  };

  return {
    convertXLMToFiat,
    formatFiatAmount,
    isLoading,
    error,
    exchangeRate,
  };
};