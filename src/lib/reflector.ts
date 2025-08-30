// Price fetching using CoinGecko API (free tier) and Reflector Oracles
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Oracle configuration type
type OracleConfig = {
  contract: string;
  base: string;
  decimals: number;
  url: string;
};

// Reflector Oracle Contracts
const REFLECTOR_ORACLES = {
  CEX_DEX: {
    contract: 'CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN',
    base: 'USD',
    decimals: 14,
    url: 'https://reflector.network/oracles/public/CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN'
  },
  STELLAR: {
    contract: 'CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M',
    base: 'USDC',
    decimals: 14,
    url: 'https://reflector.network/oracles/public/CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M'
  },
  FX: {
    contract: 'CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC',
    base: 'USD',
    decimals: 14,
    url: 'https://reflector.network/oracles/public/CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC'
  }
} as const satisfies Record<string, OracleConfig>;

// Asset mapping for CoinGecko price fetching (fallback)
const ASSET_ID_MAP: Record<string, string> = {
  'XLM': 'stellar',
  'USDC': 'usd-coin',
  'EURC': 'euro-coin',
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
};

export interface AssetPrice {
  symbol: string;
  price: number; // Price in USD
  timestamp: number;
}

export const getAssetPrice = async (assetCode?: string, assetIssuer?: string): Promise<number> => {
  const assetKey = assetIssuer ? `${assetCode}:${assetIssuer}` : (assetCode || 'XLM');
  
  try {
    // For native XLM
    if (!assetCode || assetCode === 'XLM') {
      // Try Reflector oracles first, then CoinGecko as fallback
      const reflectorPrice = await fetchReflectorPrice(assetCode || 'XLM', assetIssuer);
      if (reflectorPrice > 0) {
        setCachedPrice(assetKey, reflectorPrice);
        return reflectorPrice;
      }
      
      const coinGeckoPrice = await fetchCoinGeckoPrice('stellar');
      if (coinGeckoPrice > 0) {
        setCachedPrice(assetKey, coinGeckoPrice);
        return coinGeckoPrice;
      }
      
      // Fallback to cached price
      return getCachedPrice(assetKey);
    }

    // Try Reflector oracles first for all assets
    const reflectorPrice = await fetchReflectorPrice(assetCode, assetIssuer);
    if (reflectorPrice > 0) {
      setCachedPrice(assetKey, reflectorPrice);
      return reflectorPrice;
    }

    // Fallback to CoinGecko for known assets
    const coinId = ASSET_ID_MAP[assetCode];
    if (coinId) {
      const coinGeckoPrice = await fetchCoinGeckoPrice(coinId);
      if (coinGeckoPrice > 0) {
        setCachedPrice(assetKey, coinGeckoPrice);
        return coinGeckoPrice;
      }
    }

    // Final fallback to cached price
    return getCachedPrice(assetKey);

  } catch (error) {
    console.warn(`Failed to get price for ${assetCode}:`, error);
    return getCachedPrice(assetKey);
  }
};

const fetchCoinGeckoPrice = async (coinId: string): Promise<number> => {
  try {
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=${coinId}&vs_currencies=usd`,
      {
        headers: {
          'accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();
    return data[coinId]?.usd || 0;

  } catch (error) {
    console.warn(`CoinGecko price fetch failed for ${coinId}:`, error);
    throw error;
  }
};

const fetchReflectorPrice = async (assetCode: string, assetIssuer?: string): Promise<number> => {
  // Try all oracle contracts in order of preference
  const oracles = [REFLECTOR_ORACLES.STELLAR, REFLECTOR_ORACLES.CEX_DEX, REFLECTOR_ORACLES.FX];
  
  for (const oracle of oracles) {
    try {
      const price = await fetchPriceFromOracle(oracle, assetCode, assetIssuer);
      if (price > 0) {
        // Convert to USD if the base is not USD
        if (oracle.base === 'USDC') {
          const usdcToUsd = await getUsdcToUsdRate();
          return price * usdcToUsd;
        }
        return price;
      }
    } catch (error) {
      console.warn(`Failed to fetch from ${oracle.contract}:`, error);
      continue;
    }
  }
  
  return 0;
};

const fetchPriceFromOracle = async (oracle: OracleConfig, assetCode: string, assetIssuer?: string): Promise<number> => {
  try {
    // For now, implement a simple placeholder that logs the attempt
    // Real Soroban contract calls would require proper contract ABI and method signatures
    console.log(`Attempting to call Reflector oracle ${oracle.contract} for ${assetCode}`);
    
    // TODO: Implement proper Soroban contract calls when we have:
    // 1. The correct contract method signatures (assets, get_price, etc.)
    // 2. Proper parameter encoding for the contract calls
    // 3. Result decoding based on the contract's return types
    
    // For now, return 0 to use fallback methods (CoinGecko, static prices)
    return 0;

  } catch (error) {
    console.warn(`Oracle ${oracle.contract} contract call failed for ${assetCode}:`, error);
    return 0;
  }
};



const getUsdcToUsdRate = async (): Promise<number> => {
  try {
    return await fetchCoinGeckoPrice('usd-coin');
  } catch (error) {
    console.warn('Failed to get USDC/USD rate, assuming 1:1:', error);
    return 1.0; // Fallback to 1:1 if CoinGecko fails
  }
};

// Price cache for fallback to previous values with localStorage persistence
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = 'stellar_asset_prices';

interface PriceCacheEntry {
  price: number;
  timestamp: number;
}

interface PriceCache {
  [assetKey: string]: PriceCacheEntry;
}

const loadPriceCache = (): PriceCache => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.warn('Failed to load price cache from localStorage:', error);
  }
  return {};
};

const savePriceCache = (cache: PriceCache): void => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Failed to save price cache to localStorage:', error);
  }
};

const getCachedPrice = (assetKey: string): number => {
  const cache = loadPriceCache();
  const cached = cache[assetKey];
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    console.log(`Using cached price for ${assetKey}: ${cached.price}`);
    return cached.price;
  }
  
  // Clean expired entry
  if (cached && (Date.now() - cached.timestamp) >= CACHE_DURATION) {
    delete cache[assetKey];
    savePriceCache(cache);
  }
  
  return 0;
};

const setCachedPrice = (assetKey: string, price: number): void => {
  if (price > 0) {
    const cache = loadPriceCache();
    cache[assetKey] = {
      price,
      timestamp: Date.now()
    };
    savePriceCache(cache);
  }
};

export const getAssetSymbol = (assetCode?: string): string => {
  if (!assetCode) return 'XLM';
  return assetCode;
};