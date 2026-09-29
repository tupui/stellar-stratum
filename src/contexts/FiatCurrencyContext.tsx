import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getAvailableFiatCurrencies, type FiatCurrency } from '@/lib/fiat-currencies';
import { safeStorage } from '@/lib/storage';

const QUOTE_CURRENCY_STORAGE_KEY = 'stellar-quote-currency';
const USD_ONLY: FiatCurrency[] = [{ code: 'USD', symbol: '$', name: 'US Dollar' }];

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
  const [storedCurrency, setStoredCurrency] = useState<string>(
    () => safeStorage.get(QUOTE_CURRENCY_STORAGE_KEY) || 'USD',
  );
  const [availableCurrencies, setAvailableCurrencies] = useState<FiatCurrency[]>(USD_ONLY);

  // Exchange rates come from Reflector's mainnet FX oracle.
  useEffect(() => {
    let cancelled = false;
    getAvailableFiatCurrencies()
      .then((currencies) => {
        if (!cancelled) setAvailableCurrencies(currencies);
      })
      .catch(() => {
        // Keep the USD-only list
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setQuoteCurrency = (currency: string) => {
    setStoredCurrency(currency);
    safeStorage.set(QUOTE_CURRENCY_STORAGE_KEY, currency);
  };

  // Amounts are converted to `quoteCurrency` and printed with this currency's
  // symbol, so both come from the same value: the stored choice when the oracle
  // lists it, USD (the first entry) until then or if the list failed to load.
  const currentCurrency = availableCurrencies.find((c) => c.code === storedCurrency) || availableCurrencies[0];
  const quoteCurrency = currentCurrency.code;
  const getCurrentCurrency = (): FiatCurrency => currentCurrency;

  return (
    <FiatCurrencyContext.Provider
      value={{ quoteCurrency, setQuoteCurrency, availableCurrencies, getCurrentCurrency }}
    >
      {children}
    </FiatCurrencyContext.Provider>
  );
};
