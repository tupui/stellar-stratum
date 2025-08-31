// Supported fiat currencies with their symbols and conversion functions
export interface FiatCurrency {
  code: string;
  symbol: string;
  name: string;
}

export const FIAT_CURRENCIES: FiatCurrency[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
];

// Cache for FX rates
const fxRatesCache: Record<string, { rate: number; timestamp: number }> = {};
const FX_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// FX Oracle contract configuration
const FX_ORACLE = {
  contract: 'CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC',
  base: 'USD',
  decimals: 14
} as const;

// Get exchange rate from USD to target currency
export const getFxRate = async (targetCurrency: string): Promise<number> => {
  if (targetCurrency === 'USD') return 1;
  
  const cacheKey = `USD_${targetCurrency}`;
  const cached = fxRatesCache[cacheKey];
  
  if (cached && (Date.now() - cached.timestamp) < FX_CACHE_DURATION) {
    return cached.rate;
  }
  
  try {
    // Import the FX oracle client
    const { OracleClient, AssetType } = await import('./reflector-client');
    const client = new (OracleClient as any)(FX_ORACLE.contract);
    
    // Fetch rate for target currency
    const rawRate = await client.getLastPrice({
      type: AssetType.Other,
      code: targetCurrency
    });
    
    if (rawRate > 0) {
      const rate = rawRate / Math.pow(10, FX_ORACLE.decimals);
      fxRatesCache[cacheKey] = { rate, timestamp: Date.now() };
      return rate;
    }
  } catch (error) {
    console.warn(`Failed to fetch FX rate for ${targetCurrency}:`, error);
  }
  
  // Fallback rates (approximate)
  const fallbackRates: Record<string, number> = {
    EUR: 0.85,
    GBP: 0.75,
    JPY: 110,
    CAD: 1.25,
    AUD: 1.35,
    CHF: 0.92,
    CNY: 6.5,
    SEK: 8.5,
    NZD: 1.45,
  };
  
  return fallbackRates[targetCurrency] || 1;
};

export const convertFromUSD = async (usdAmount: number, targetCurrency: string): Promise<number> => {
  const rate = await getFxRate(targetCurrency);
  return usdAmount * rate;
};