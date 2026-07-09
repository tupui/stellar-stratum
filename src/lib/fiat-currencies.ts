// Supported fiat currencies — fetched dynamically from the Reflector FX oracle.
// The FX oracle is a mainnet-only contract; there is no testnet variant, so
// none of the public API here takes a network argument.

import { OracleClient, AssetType } from './reflector-client';
import { appConfig } from './appConfig';

export interface FiatCurrency {
  code: string;
  symbol: string;
  name: string;
}

// Symbol + display name for currencies the oracle may return.
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

const FX_ORACLE = {
  contract: appConfig.ORACLE_CONTRACT,
  base: 'USD',
  decimals: 14,
} as const;

// The FX oracle publishes rates as USD per 1 target unit (e.g. rate for EUR
// ≈ 1.05, meaning 1 EUR = 1.05 USD).

const FX_CACHE_DURATION_MS = 5 * 60 * 1000;
const ORACLE_ASSETS_TTL_MS = 24 * 60 * 60 * 1000;

const fxRatesCache = new Map<string, { rate: number; timestamp: number }>();
const inflightFxRateRequests = new Map<string, Promise<number>>();

let availableCurrenciesCache: FiatCurrency[] | null = null;
let availableCurrenciesTimestamp = 0;
let oracleAssetsCache: string[] | null = null;
let oracleAssetsCacheTimestamp = 0;

let fxClient: OracleClient | null = null;
const getFxClient = (): OracleClient => {
  if (!fxClient) fxClient = new OracleClient(FX_ORACLE.contract);
  return fxClient;
};

const refreshOracleAssets = async (): Promise<string[]> => {
  const assets = await getFxClient().getAssets();
  oracleAssetsCache = assets.map((a) => a.toUpperCase());
  oracleAssetsCacheTimestamp = Date.now();
  return oracleAssetsCache;
};

// Format `amount` in `currencyCode` using Intl.NumberFormat, with a safe fallback.
export const formatFiatAmount = (amount: number, currencyCode: string): string => {
  const info = CURRENCY_INFO[currencyCode?.toUpperCase()];
  const symbol = info?.symbol ?? '$';
  if (!Number.isFinite(amount) || amount < 0) return `${symbol}0.00`;
  if (amount > Number.MAX_SAFE_INTEGER) return `${symbol}∞`;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${symbol}${amount.toFixed(2)}`;
  }
};

export const getAvailableFiatCurrencies = async (): Promise<FiatCurrency[]> => {
  if (availableCurrenciesCache && Date.now() - availableCurrenciesTimestamp < ORACLE_ASSETS_TTL_MS) {
    return availableCurrenciesCache;
  }

  try {
    const assets = await refreshOracleAssets();
    const currencies: FiatCurrency[] = [{ code: 'USD', symbol: '$', name: 'US Dollar' }];
    for (const upperAsset of assets) {
      if (upperAsset !== 'USD' && CURRENCY_INFO[upperAsset]) {
        currencies.push({
          code: upperAsset,
          symbol: CURRENCY_INFO[upperAsset].symbol,
          name: CURRENCY_INFO[upperAsset].name,
        });
      }
    }
    availableCurrenciesCache = currencies;
    availableCurrenciesTimestamp = Date.now();
    return currencies;
  } catch {
    return [{ code: 'USD', symbol: '$', name: 'US Dollar' }];
  }
};

// Exchange rate expressed as USD per 1 unit of `targetCurrency`.
const getFxRate = async (targetCurrency: string): Promise<number> => {
  if (targetCurrency === 'USD') return 1;

  const upperCurrency = targetCurrency.toUpperCase();

  const existing = inflightFxRateRequests.get(upperCurrency);
  if (existing) return existing;

  const cached = fxRatesCache.get(upperCurrency);
  if (cached && Date.now() - cached.timestamp < FX_CACHE_DURATION_MS) {
    return cached.rate;
  }

  const promise = (async () => {
    try {
      if (!oracleAssetsCache || Date.now() - oracleAssetsCacheTimestamp > ORACLE_ASSETS_TTL_MS) {
        await refreshOracleAssets();
      }
      if (!oracleAssetsCache!.includes(upperCurrency)) {
        throw new Error(`Currency ${upperCurrency} not supported by oracle`);
      }

      const rawRate = await getFxClient().getLastPrice({ type: AssetType.Other, code: upperCurrency });
      if (rawRate <= 0) throw new Error(`Oracle returned zero rate for ${upperCurrency}`);

      const rate = rawRate / Math.pow(10, FX_ORACLE.decimals);
      fxRatesCache.set(upperCurrency, { rate, timestamp: Date.now() });
      return rate;
    } finally {
      inflightFxRateRequests.delete(upperCurrency);
    }
  })();

  inflightFxRateRequests.set(upperCurrency, promise);
  return promise;
};

// Convert a USD amount to `targetCurrency`. Returns the input on any failure so
// the UI never shows blank/NaN values.
export const convertFromUSD = async (usdAmount: number, targetCurrency: string): Promise<number> => {
  if (!Number.isFinite(usdAmount) || usdAmount < 0) return 0;
  if (targetCurrency === 'USD') return usdAmount;

  try {
    const rate = await getFxRate(targetCurrency);
    if (!rate || !Number.isFinite(rate) || rate <= 0) return usdAmount;
    // rate = USD per 1 target unit ⇒ target = USD / rate
    const converted = usdAmount / rate;
    return Number.isFinite(converted) ? converted : usdAmount;
  } catch {
    return usdAmount;
  }
};
