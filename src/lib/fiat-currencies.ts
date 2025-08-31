// Supported fiat currencies fetched dynamically from Reflector FX Oracle
export interface FiatCurrency {
  code: string;
  symbol: string;
  name: string;
}

// Static currency symbols and names for known currencies
const CURRENCY_INFO: Record<string, { symbol: string; name: string }> = {
  USD: { symbol: '$', name: 'US Dollar' },
  EUR: { symbol: '€', name: 'Euro' },
  GBP: { symbol: '£', name: 'British Pound' },
  JPY: { symbol: '¥', name: 'Japanese Yen' },
  CAD: { symbol: 'C$', name: 'Canadian Dollar' },
  AUD: { symbol: 'A$', name: 'Australian Dollar' },
  CHF: { symbol: 'CHF', name: 'Swiss Franc' },
  CNY: { symbol: '¥', name: 'Chinese Yuan' },
  SEK: { symbol: 'kr', name: 'Swedish Krona' },
  NZD: { symbol: 'NZ$', name: 'New Zealand Dollar' },
  NOK: { symbol: 'kr', name: 'Norwegian Krone' },
  DKK: { symbol: 'kr', name: 'Danish Krone' },
  PLN: { symbol: 'zł', name: 'Polish Zloty' },
  CZK: { symbol: 'Kč', name: 'Czech Koruna' },
  HUF: { symbol: 'Ft', name: 'Hungarian Forint' },
  RUB: { symbol: '₽', name: 'Russian Ruble' },
  BRL: { symbol: 'R$', name: 'Brazilian Real' },
  MXN: { symbol: '$', name: 'Mexican Peso' },
  INR: { symbol: '₹', name: 'Indian Rupee' },
  KRW: { symbol: '₩', name: 'South Korean Won' },
  SGD: { symbol: 'S$', name: 'Singapore Dollar' },
  HKD: { symbol: 'HK$', name: 'Hong Kong Dollar' },
  TWD: { symbol: 'NT$', name: 'Taiwan Dollar' },
  THB: { symbol: '฿', name: 'Thai Baht' },
  MYR: { symbol: 'RM', name: 'Malaysian Ringgit' },
  IDR: { symbol: 'Rp', name: 'Indonesian Rupiah' },
  PHP: { symbol: '₱', name: 'Philippine Peso' },
  VND: { symbol: '₫', name: 'Vietnamese Dong' },
  ZAR: { symbol: 'R', name: 'South African Rand' },
  TRY: { symbol: '₺', name: 'Turkish Lira' },
  ILS: { symbol: '₪', name: 'Israeli Shekel' },
  AED: { symbol: 'د.إ', name: 'UAE Dirham' },
  SAR: { symbol: '﷼', name: 'Saudi Riyal' },
  EGP: { symbol: '£', name: 'Egyptian Pound' },
};

// Cache for available currencies and FX rates
let availableCurrenciesCache: FiatCurrency[] | null = null;
const fxRatesCache: Record<string, { rate: number; timestamp: number }> = {};
const FX_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CURRENCIES_CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day

// FX Oracle contract configuration
const FX_ORACLE = {
  contract: 'CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC',
  base: 'USD',
  decimals: 14
} as const;

// Get available fiat currencies from the FX oracle
export const getAvailableFiatCurrencies = async (): Promise<FiatCurrency[]> => {
  // Return cached currencies if still valid
  if (availableCurrenciesCache) {
    return availableCurrenciesCache;
  }
  
  try {
    const { OracleClient, AssetType } = await import('./reflector-client');
    const client = new (OracleClient as any)(FX_ORACLE.contract);
    
    // Fetch available assets (currencies) from FX oracle
    const availableAssets = await client.getAssets();
    
    // Always include USD as base currency
    const currencies: FiatCurrency[] = [
      { code: 'USD', symbol: '$', name: 'US Dollar' }
    ];
    
    // Add other currencies that are available from the oracle
    availableAssets.forEach(asset => {
      if (asset !== 'USD' && CURRENCY_INFO[asset]) {
        currencies.push({
          code: asset,
          symbol: CURRENCY_INFO[asset].symbol,
          name: CURRENCY_INFO[asset].name
        });
      }
    });
    
    availableCurrenciesCache = currencies;
    return currencies;
  } catch (error) {
    console.warn('Failed to fetch available currencies from FX oracle:', error);
    // Return only USD if oracle fails
    return [{ code: 'USD', symbol: '$', name: 'US Dollar' }];
  }
};

// Get exchange rate quoted in USD per 1 unit of target currency (e.g., EURUSD)
export const getFxRate = async (targetCurrency: string): Promise<number> => {
  if (targetCurrency === 'USD') return 1;
  
  const cacheKey = `USD_${targetCurrency}`;
  const cached = fxRatesCache[cacheKey];
  
  if (cached && (Date.now() - cached.timestamp) < FX_CACHE_DURATION) {
    return cached.rate;
  }
  
  try {
    const { OracleClient, AssetType } = await import('./reflector-client');
    const client = new (OracleClient as any)(FX_ORACLE.contract);
    
    // Fetch rate for target currency from oracle
    const rawRate = await client.getLastPrice({
      type: AssetType.Other,
      code: targetCurrency
    });
    
    if (rawRate > 0) {
      const rate = rawRate / Math.pow(10, FX_ORACLE.decimals); // USD per 1 target unit
      fxRatesCache[cacheKey] = { rate, timestamp: Date.now() };
      return rate;
    } else {
      throw new Error(`No rate available for ${targetCurrency}`);
    }
  } catch (error) {
    console.warn(`Failed to fetch FX rate for ${targetCurrency}:`, error);
    throw error; // Don't fallback to hardcoded rates
  }
};

// Convert an amount in USD to the target currency using USD-per-target quote
// If rate is USD per 1 target unit (e.g., EURUSD), then target = USD / rate
export const convertFromUSD = async (usdAmount: number, targetCurrency: string): Promise<number> => {
  const rate = await getFxRate(targetCurrency);
  if (!rate) return usdAmount; // fallback: return USD amount if no rate
  return usdAmount / rate;
};