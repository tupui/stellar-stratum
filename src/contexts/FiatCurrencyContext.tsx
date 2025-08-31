import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getAvailableFiatCurrencies, type FiatCurrency } from '@/lib/fiat-currencies';

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
  const [quoteCurrency, setQuoteCurrency] = useState('USD');
  const [availableCurrencies, setAvailableCurrencies] = useState<FiatCurrency[]>([
    { code: 'USD', symbol: '$', name: 'US Dollar' }
  ]);

  useEffect(() => {
    const loadCurrencies = async () => {
      try {
        const currencies = await getAvailableFiatCurrencies();
        setAvailableCurrencies(currencies);
      } catch (error) {
        console.warn('Failed to load available currencies:', error);
      }
    };
    loadCurrencies();
  }, []);

  const getCurrentCurrency = (): FiatCurrency => {
    return availableCurrencies.find(c => c.code === quoteCurrency) || availableCurrencies[0];
  };

  return (
    <FiatCurrencyContext.Provider 
      value={{ 
        quoteCurrency, 
        setQuoteCurrency, 
        availableCurrencies, 
        getCurrentCurrency 
      }}
    >
      {children}
    </FiatCurrencyContext.Provider>
  );
};