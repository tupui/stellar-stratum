import { useState, useEffect, useCallback, useMemo } from 'react';
import { getFxRate } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { getAssetPrice } from '@/lib/reflector';
import { useNetwork } from '@/contexts/NetworkContext';

interface FiatConversionHook {
  convertXLMToFiat: (xlmAmount: number) => Promise<number>;
  formatFiatAmount: (amount: number) => string;
  isLoading: boolean;
  error: string | null;
  exchangeRate: number | null;
}

export const useFiatConversion = (): FiatConversionHook => {
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();
  const { network } = useNetwork();
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
        const rate = await getFxRate(quoteCurrency, network);
        setExchangeRate(rate);
      } catch (err) {
        setError(`Failed to fetch exchange rate for ${quoteCurrency}`);
        setExchangeRate(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRate();
  }, [quoteCurrency, network]);

  const convertXLMToFiat = useCallback(async (xlmAmount: number): Promise<number> => {
    try {
      // Validate input
      if (!Number.isFinite(xlmAmount) || xlmAmount < 0) {
        return 0;
      }

      // Get current XLM/USD rate from oracle
      const xlmToUsdRate = await getAssetPrice('XLM');
      if (!Number.isFinite(xlmToUsdRate) || xlmToUsdRate <= 0) {
        return 0;
      }

      const usdAmount = xlmAmount * xlmToUsdRate;
      if (!Number.isFinite(usdAmount)) {
        return 0;
      }

      if (quoteCurrency === 'USD') {
        return usdAmount;
      }

      if (exchangeRate && Number.isFinite(exchangeRate) && exchangeRate > 0) {
        // exchangeRate is USD per 1 unit of target currency, so divide to convert USD to target
        const converted = usdAmount / exchangeRate;
        return Number.isFinite(converted) ? converted : usdAmount;
      }

      // If no rate available, return USD amount
      return usdAmount;
    } catch (err) {
      // Return 0 on error instead of throwing to prevent UI crashes
      return 0;
    }
  }, [quoteCurrency, exchangeRate]);

  const formatFiatAmount = useCallback((amount: number): string => {
    const currency = getCurrentCurrency();
    
    // Validate input
    if (!Number.isFinite(amount) || amount < 0) {
      return `${currency.symbol}0.00`;
    }

    // Handle very large numbers
    if (amount > Number.MAX_SAFE_INTEGER) {
      return `${currency.symbol}∞`;
    }
    
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