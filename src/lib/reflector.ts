// Price fetching using Reflector Oracles

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
  
  // Step 2: Check which oracle(s) support this asset
  const supportingOracle = findSupportingOracle(assetCode, assetIssuer);
  if (!supportingOracle) {
    console.log(`Asset ${assetCode} not available in any oracle`);
    return 0; // N/A - not supported
  }
  
  // Step 3: Try to get price from the supporting oracle
  try {
    const price = await getOracleAssetPriceWithRetry(supportingOracle, assetCode, assetIssuer);
    return price;
  } catch (error) {
    console.warn(`Failed to fetch price for ${assetCode} from ${supportingOracle.contract}:`, error);
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

// Get available assets from oracle with retry logic
const getOracleAssetsWithRetry = async (oracle: OracleConfig, maxRetries: number = 3): Promise<string[]> => {
  const cacheKey = `assets_${oracle.contract}`;
  const cached = oracleAssetsCache[cacheKey];
  
  // Return cached assets if still valid
  if (cached && (Date.now() - cached.timestamp) < ASSETS_CACHE_DURATION) {
    console.log(`Using cached asset list for ${oracle.contract}:`, cached.assets.length, 'assets');
    return cached.assets;
  }
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const assets = await getOracleAssets(oracle);
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

// Fetch available assets from oracle (single attempt)
const getOracleAssets = async (oracle: OracleConfig): Promise<string[]> => {
  try {
    const { Contract, rpc, Networks, TransactionBuilder } = await import('@stellar/stellar-sdk');
    
    const rpcServer = new rpc.Server('https://mainnet.sorobanrpc.com');
    const contract = new Contract(oracle.contract);
    
    const simulationAccount = 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV';
    const account = await rpcServer.getAccount(simulationAccount);
    
    const transaction = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: Networks.PUBLIC,
    })
    .addOperation(contract.call('assets'))
    .setTimeout(30)
    .build();
      
    const simResult = await rpcServer.simulateTransaction(transaction);
    
    if ('error' in simResult) {
      throw new Error(`Assets fetch failed: ${simResult.error}`);
    }
    
    if ('result' in simResult && simResult.result && 'retval' in simResult.result) {
      const { scValToNative } = await import('@stellar/stellar-sdk');
      const resultValue = scValToNative(simResult.result.retval);
      
      // Extract asset symbols from the Vec<Asset> result
      const assetSymbols: string[] = [];
      if (Array.isArray(resultValue)) {
        for (const asset of resultValue) {
          if (asset && typeof asset === 'object') {
            // Handle Asset enum: { Stellar: Address } or { Other: Symbol }
            if ('Other' in asset && Array.isArray(asset.Other) && asset.Other[0]) {
              assetSymbols.push(String(asset.Other[0]));
            } else if ('Stellar' in asset) {
              // For Stellar assets, use the issuer address as identifier
              assetSymbols.push(`stellar_${asset.Stellar}`);
            }
          }
        }
      }
      
      return assetSymbols;
    }
    
    return [];
  } catch (error) {
    throw error;
  }
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
const getOracleAssetPriceWithRetry = async (oracle: OracleConfig, assetCode: string, assetIssuer?: string, maxRetries: number = 3): Promise<number> => {
  const cacheKey = `${oracle.contract}:${assetCode}:${assetIssuer || ''}`;
  const cached = oraclePriceCache[cacheKey];
  
  // Return cached price if still valid
  if (cached && (Date.now() - cached.timestamp) < PRICE_CACHE_DURATION) {
    console.log(`Using cached price for ${assetCode} from ${oracle.contract}: ${cached.price}`);
    return cached.price;
  }
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const price = await getOracleAssetPrice(oracle, assetCode, assetIssuer);
      if (price > 0) {
        // Cache successful price
        oraclePriceCache[cacheKey] = {
          price,
          timestamp: Date.now()
        };
        return price;
      }
      
      // If no price and not the last attempt, wait before retry
      if (attempt < maxRetries - 1 && price === 0) {
        const baseDelay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        const jitter = Math.random() * baseDelay;
        const delay = baseDelay + jitter;
        
        console.log(`No price returned for ${assetCode} from ${oracle.contract}, retrying in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed for ${assetCode} from ${oracle.contract}:`, error);
      
      // If not the last attempt, wait before retry
      if (attempt < maxRetries - 1) {
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * baseDelay;
        const delay = baseDelay + jitter;
        
        console.log(`Retrying ${assetCode} from ${oracle.contract} in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }
  }
  
  // Don't cache failed results (N/A)
  return 0;
};

// Get individual asset price from oracle (single attempt)
const getOracleAssetPrice = async (oracle: OracleConfig, assetCode: string, assetIssuer?: string): Promise<number> => {
  try {
    const { Contract, nativeToScVal, scValToNative, rpc, Networks, TransactionBuilder } = await import('@stellar/stellar-sdk');
    
    const rpcServer = new rpc.Server('https://mainnet.sorobanrpc.com');
    const contract = new Contract(oracle.contract);
    
    console.log(`Fetching price for ${assetCode} from oracle ${oracle.contract}`);
    
    // Build the contract call transaction for simulation
    const simulationAccount = 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV';
    const account = await rpcServer.getAccount(simulationAccount);
    
    // Create asset parameter based on Reflector documentation
    let assetParam;
    if (!assetCode || assetCode === 'XLM') {
      // For native XLM - use simple symbol
      assetParam = nativeToScVal('XLM', { type: 'symbol' });
    } else if (assetIssuer) {
      // For issued assets - use Stellar format with issuer
      assetParam = nativeToScVal({
        Stellar: assetIssuer
      }, { type: 'instance' });
    } else {
      // For other symbols - use simple symbol
      assetParam = nativeToScVal(assetCode, { type: 'symbol' });
    }
    
    const transaction = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: Networks.PUBLIC,
    })
    .addOperation(contract.call('lastprice', assetParam))
    .setTimeout(30)
    .build();
      
    const simResult = await rpcServer.simulateTransaction(transaction);
    
    if ('error' in simResult) {
      throw new Error(`Price fetch failed: ${simResult.error}`);
    }
    
    if ('result' in simResult && simResult.result && 'retval' in simResult.result) {
      const resultValue = scValToNative(simResult.result.retval);
      console.log(`Oracle ${oracle.contract} returned for ${assetCode}:`, resultValue);
      
      // Handle Option<PriceData> result
      if (resultValue && typeof resultValue === 'object') {
        let price = 0;
        
        // Handle Some(PriceData) case
        if ('Some' in resultValue && resultValue.Some) {
          const priceData = resultValue.Some;
          if (priceData && typeof priceData === 'object' && 'price' in priceData) {
            price = parseFloat(String(priceData.price));
          }
        }
        // Handle direct PriceData case
        else if ('price' in resultValue) {
          price = parseFloat(String(resultValue.price));
        }
        
        // Apply decimals scaling
        if (price > 0) {
          const scaledPrice = price / Math.pow(10, oracle.decimals);
          console.log(`Scaled price for ${assetCode}: ${scaledPrice}`);
          return scaledPrice;
        }
      }
    }
    
    return 0;
  } catch (error) {
    throw error;
  }
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