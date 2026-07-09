import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getAvailableFiatCurrencies, type FiatCurrency } from '@/lib/fiat-currencies';
import { safeStorage } from '@/lib/storage';

const QUOTE_CURRENCY_STORAGE_KEY = 'stellar-quote-currency';

interface FiatCurrencyContextType {
  quoteCurrency: string;
  setQuoteCurrency: (currency: string) => void;
  availableCurrencies: FiatCurrency[];
  getCurrentCurrency: () => FiatCurrency;
}

const FiatCurrencyContext = createContext<FiatCurrencyContextType | undefined>(undefined);

export const useFiatCurrency = () => {
  const context = useContext(FiatCurrencyContext);
  if (!context) {
    throw new Error('useFiatCurrency must be used within a FiatCurrencyProvider');
  }
  return context;
};

interface FiatCurrencyProviderProps {
  children: ReactNode;
}

export const FiatCurrencyProvider = ({ children }: FiatCurrencyProviderProps) => {
  const [quoteCurrency, setQuoteCurrencyState] = useState<string>(
    () => safeStorage.get(QUOTE_CURRENCY_STORAGE_KEY) || 'USD',
  );
  const [availableCurrencies, setAvailableCurrencies] = useState<FiatCurrency[]>([
    { code: 'USD', symbol: '$', name: 'US Dollar' },
  ]);

  useEffect(() => {
    getAvailableFiatCurrencies()
      .then(setAvailableCurrencies)
      .catch(() => {
        // Silent failure — keep default USD-only list
      });
  }, []);

  const setQuoteCurrency = (currency: string) => {
    setQuoteCurrencyState(currency);
    safeStorage.set(QUOTE_CURRENCY_STORAGE_KEY, currency);
  };

  const getCurrentCurrency = (): FiatCurrency =>
    availableCurrencies.find((c) => c.code === quoteCurrency) || availableCurrencies[0];

  return (
    <FiatCurrencyContext.Provider
      value={{ quoteCurrency, setQuoteCurrency, availableCurrencies, getCurrentCurrency }}
    >
      {children}
    </FiatCurrencyContext.Provider>
  );
};
