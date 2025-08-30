// Price fetching using Reflector Oracles
import { OracleClient, type OracleConfig, AssetType, type Asset } from './reflector-client';

// Reflector Oracle Contracts
const REFLECTOR_ORACLES = {
  CEX_DEX: {
    contract: 'CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN',
    base: 'USD',
    decimals: 14
  },
  STELLAR: {
    contract: 'CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M',
    base: 'USDC',
    decimals: 14
  },
  FX: {
    contract: 'CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC',
    base: 'USD',
    decimals: 14
  }
} as const satisfies Record<string, OracleConfig>;


export interface AssetPrice {
  symbol: string;
  price: number; // Price in USD
  timestamp: number;
}

export const getAssetPrice = async (assetCode?: string, assetIssuer?: string): Promise<number> => {
  const assetKey = assetIssuer ? `${assetCode}:${assetIssuer}` : (assetCode || 'XLM');
  
  try {
    // Try Reflector oracles for all assets
    const reflectorPrice = await fetchReflectorPrice(assetCode || 'XLM', assetIssuer);
    if (reflectorPrice > 0) {
      setCachedPrice(assetKey, reflectorPrice);
      // Update the last fetch timestamp
      setLastFetchTimestamp();
      return reflectorPrice;
    }

    // Fallback to cached price
    return getCachedPrice(assetKey);

  } catch (error) {
    console.warn(`Failed to get price for ${assetCode}:`, error);
    return getCachedPrice(assetKey);
  }
};


// Cache for oracle price data
const oraclePriceCache: Record<string, { price: number; timestamp: number }> = {};
const PRICE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Cache for available assets per oracle
const oracleAssetsCache: Record<string, { assets: string[]; timestamp: number }> = {};
const ASSETS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day

// In-memory cache for asset lists to avoid localStorage issues
let assetsListsLoaded = false;

const fetchReflectorPrice = async (assetCode: string, assetIssuer?: string): Promise<number> => {
  // Step 1: Ensure asset lists are loaded first
  await ensureAssetListsLoaded();
  
  // Step 2: Check which oracle supports this asset
  const supportingOracle = findSupportingOracle(assetCode, assetIssuer);
  if (!supportingOracle) {
    console.log(`Asset ${assetCode}${assetIssuer ? ':' + assetIssuer : ''} not available in any oracle - assigning N/A`);
    return 0; // N/A - not supported
  }
  
  // Step 3: Create proper Asset object and get price from the supporting oracle
  const asset = createAssetObject(assetCode, assetIssuer);
  try {
    const price = await getOracleAssetPriceWithRetry(supportingOracle, asset);
    console.log(`Got price for ${assetCode}${assetIssuer ? ':' + assetIssuer : ''} from ${supportingOracle.contract}: ${price}`);
    return price;
  } catch (error) {
    console.warn(`Failed to fetch price for ${assetCode}${assetIssuer ? ':' + assetIssuer : ''} from ${supportingOracle.contract}:`, error);
    return 0; // N/A - failed to fetch
  }
};

// Sleep utility for retry delays
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Ensure asset lists are loaded for all oracles
const ensureAssetListsLoaded = async (): Promise<void> => {
  if (assetsListsLoaded) return;
  
  const oracles = [REFLECTOR_ORACLES.STELLAR, REFLECTOR_ORACLES.CEX_DEX, REFLECTOR_ORACLES.FX];
  
  // Load asset lists for all oracles
  await Promise.all(oracles.map(oracle => getOracleAssetsWithRetry(oracle)));
  
  assetsListsLoaded = true;
};

// Create Asset object for oracle calls
const createAssetObject = (assetCode: string, assetIssuer?: string): Asset => {
  if (!assetCode || assetCode === 'XLM') {
    return { type: AssetType.Other, code: 'XLM' };
  } else if (assetIssuer) {
    return { type: AssetType.Stellar, code: assetIssuer };
  } else {
    return { type: AssetType.Other, code: assetCode };
  }
};

// Get available assets from oracle with retry logic
const getOracleAssetsWithRetry = async (oracle: OracleConfig, maxRetries: number = 1): Promise<string[]> => {
  const cacheKey = `assets_${oracle.contract}`;
  const cached = oracleAssetsCache[cacheKey];
  
  // Return cached assets if still valid
  if (cached && (Date.now() - cached.timestamp) < ASSETS_CACHE_DURATION) {
    console.log(`Using cached asset list for ${oracle.contract}:`, cached.assets.length, 'assets');
    return cached.assets;
  }
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const client = new OracleClient(oracle.contract);
      const assets = await client.getAssets();
      if (assets.length > 0) {
        // Cache successful result
        oracleAssetsCache[cacheKey] = {
          assets,
          timestamp: Date.now()
        };
        console.log(`Oracle ${oracle.contract} supports ${assets.length} assets`);
        return assets;
      }
      
      // If no assets and not the last attempt, wait before retry
      if (attempt < maxRetries - 1) {
        const baseDelay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        const jitter = Math.random() * baseDelay;
        const delay = baseDelay + jitter;
        
        console.log(`No assets returned from ${oracle.contract}, retrying in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed to fetch assets from ${oracle.contract}:`, error);
      
      // If not the last attempt, wait before retry
      if (attempt < maxRetries - 1) {
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * baseDelay;
        const delay = baseDelay + jitter;
        
        console.log(`Retrying asset fetch from ${oracle.contract} in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }
  }
  
  return [];
};

// Find which oracle supports the given asset
const findSupportingOracle = (assetCode: string, assetIssuer?: string): OracleConfig | null => {
  const oracles = [REFLECTOR_ORACLES.STELLAR, REFLECTOR_ORACLES.CEX_DEX, REFLECTOR_ORACLES.FX];
  
  for (const oracle of oracles) {
    const cacheKey = `assets_${oracle.contract}`;
    const cached = oracleAssetsCache[cacheKey];
    
    if (cached && cached.assets) {
      // Check for exact symbol match
      if (cached.assets.includes(assetCode)) {
        return oracle;
      }
      
      // For issued assets, check for stellar asset format
      if (assetIssuer && cached.assets.includes(`stellar_${assetIssuer}`)) {
        return oracle;
      }
    }
  }
  
  return null;
};

// Get individual asset price from oracle with retry logic
const getOracleAssetPriceWithRetry = async (oracle: OracleConfig, asset: Asset, maxRetries: number = 1): Promise<number> => {
  const cacheKey = `${oracle.contract}:${asset.code}:${asset.type}`;
  const cached = oraclePriceCache[cacheKey];
  
  // Return cached price if still valid
  if (cached && (Date.now() - cached.timestamp) < PRICE_CACHE_DURATION) {
    console.log(`Using cached price for ${asset.code} from ${oracle.contract}: ${cached.price}`);
    return cached.price;
  }
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const client = new OracleClient(oracle.contract);
      const rawPrice = await client.getLastPrice(asset);
      
      if (rawPrice > 0) {
        // Apply decimals scaling
        const price = rawPrice / Math.pow(10, oracle.decimals);
        
        // Cache successful price
        oraclePriceCache[cacheKey] = {
          price,
          timestamp: Date.now()
        };
        
        console.log(`Scaled price for ${asset.code}: ${price} (raw: ${rawPrice}, decimals: ${oracle.decimals})`);
        return price;
      }
      
      // If no price and not the last attempt, wait before retry
      if (attempt < maxRetries - 1 && rawPrice === 0) {
        const baseDelay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        const jitter = Math.random() * baseDelay;
        const delay = baseDelay + jitter;
        
        console.log(`No price returned for ${asset.code} from ${oracle.contract}, retrying in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed for ${asset.code} from ${oracle.contract}:`, error);
      
      // If not the last attempt, wait before retry
      if (attempt < maxRetries - 1) {
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * baseDelay;
        const delay = baseDelay + jitter;
        
        console.log(`Retrying ${asset.code} from ${oracle.contract} in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }
  }
  
  // Don't cache failed results (N/A)
  return 0;
};




// Price cache for fallback to previous values with localStorage persistence
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = 'stellar_asset_prices';
const FETCH_TIMESTAMP_KEY = 'stellar_price_fetch_timestamp';

// Set last fetch timestamp
const setLastFetchTimestamp = (): void => {
  try {
    localStorage.setItem(FETCH_TIMESTAMP_KEY, Date.now().toString());
  } catch (error) {
    console.warn('Failed to save fetch timestamp:', error);
  }
};

// Get last fetch timestamp
export const getLastFetchTimestamp = (): Date | null => {
  try {
    const timestamp = localStorage.getItem(FETCH_TIMESTAMP_KEY);
    if (timestamp) {
      return new Date(parseInt(timestamp));
    }
  } catch (error) {
    console.warn('Failed to get fetch timestamp:', error);
  }
  return null;
};

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

export const getLastPriceUpdate = (): Date | null => {
  try {
    const cache = loadPriceCache();
    const timestamps = Object.values(cache).map(entry => entry.timestamp);
    if (timestamps.length === 0) return null;
    
    const latestTimestamp = Math.max(...timestamps);
    return new Date(latestTimestamp);
  } catch (error) {
    console.warn('Failed to get last price update:', error);
    return null;
  }
};

// Clear price cache but keep asset lists (for refresh functionality)
export const clearPriceCache = (): void => {
  try {
    // Clear in-memory price cache
    Object.keys(oraclePriceCache).forEach(key => delete oraclePriceCache[key]);
    
    // Clear localStorage price cache
    localStorage.removeItem(CACHE_KEY);
    
    console.log('Price cache cleared');
  } catch (error) {
    console.warn('Failed to clear price cache:', error);
  }
};