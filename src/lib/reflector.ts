// Price fetching using Reflector Oracles
import { OracleClient, type OracleConfig, AssetType, type Asset } from './reflector-client';
import { xdr, Asset as StellarAsset, hash, StrKey, Networks } from '@stellar/stellar-sdk';

// Reflector Oracle Contracts
// Helper: compute SAC (contract) ID for classic assets on PUBLIC network
const computeStellarAssetContractId = (assetCode: string, assetIssuer: string): string => {
  try {
    if (!assetIssuer || assetCode === 'XLM') return '';
    const stellarAsset = new StellarAsset(assetCode, assetIssuer);
    const preimage = new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(Networks.PUBLIC)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(stellarAsset.toXDRObject()),
    });
    const envelope = xdr.HashIdPreimage.envelopeTypeContractId(preimage);
    const cid = StrKey.encodeContract(hash(envelope.toXDR()));
    return cid;
  } catch (e) {
    console.warn('computeStellarAssetContractId failed', { assetCode, assetIssuer, error: e });
    return '';
  }
};

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

// In-memory cache to track which oracle asset lists are loaded
const loadedOracles = new Set<string>();

const ensureAssetListsLoaded = async (oraclesToLoad: OracleConfig[]): Promise<void> => {
  const toLoad = oraclesToLoad.filter((o) => !loadedOracles.has(o.contract));
  if (toLoad.length === 0) return;
  await Promise.all(toLoad.map(oracle => getOracleAssetsWithRetry(oracle)));
  toLoad.forEach(o => loadedOracles.add(o.contract));
};

// Sleep utility for retry delays
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Asset to oracle mapping cache
const assetOracleMapping: Record<string, { oracle: OracleConfig; asset: Asset }> = {};
let mappingInitialized = false;
let mappingPromise: Promise<void> | null = null;

// Initialize the asset-to-oracle mapping by querying all 3 contracts (singleton with promise)
const initializeAssetMapping = async (): Promise<void> => {
  if (mappingInitialized) return;
  
  // If already in progress, wait for the existing promise
  if (mappingPromise) {
    await mappingPromise;
    return;
  }
  
  // Start the initialization process
  mappingPromise = (async () => {
    try {
      const allOracles = [REFLECTOR_ORACLES.CEX_DEX, REFLECTOR_ORACLES.STELLAR, REFLECTOR_ORACLES.FX];
      
      // Load asset lists from all oracles in parallel
      await Promise.all(allOracles.map(oracle => getOracleAssetsWithRetry(oracle)));
      
      // Build the mapping
      let totalAssets = 0;
      for (const oracle of allOracles) {
        const cacheKey = `assets_${oracle.contract}`;
        const cached = oracleAssetsCache[cacheKey];
        
        if (cached && cached.assets) {
          for (const assetId of cached.assets) {
            totalAssets++;
            // Handle different asset formats
            if (assetId.startsWith('stellar_')) {
              // This is a Stellar asset with issuer/contract ID
              const code = assetId.substring(8);
              assetOracleMapping[assetId] = { 
                oracle, 
                asset: { type: AssetType.Stellar, code } 
              };
            } else {
              // This is a direct symbol (XLM, USDC, BTC, etc.)
              assetOracleMapping[assetId] = { 
                oracle, 
                asset: { type: AssetType.Other, code: assetId } 
              };
            }
          }
        }
      }
      
      mappingInitialized = true;
    } catch (error) {
      console.error('Failed to initialize asset mapping:', error);
      mappingPromise = null; // Reset to allow retry
      throw error;
    }
  })();
  
  await mappingPromise;
};

// Fetch price using the asset-to-oracle mapping
const fetchReflectorPrice = async (assetCode: string, assetIssuer?: string): Promise<number> => {
  // Initialize mapping if not done yet
  if (!mappingInitialized) {
    await initializeAssetMapping();
  }
  
  // Find the oracle for this specific asset
  const resolved = findAssetInMapping(assetCode, assetIssuer);
  if (!resolved) {
    return 0; // Silently return 0 for assets without oracles
  }

  const { oracle, asset } = resolved;
  
  try {
    const price = await getOracleAssetPriceWithRetry(oracle, asset);
    console.log(`Successfully fetched price for ${assetCode}${assetIssuer ? ':' + assetIssuer : ''}: $${price}`);
    return price;
  } catch (error) {
    console.warn(`Failed to fetch price for ${assetCode}${assetIssuer ? ':' + assetIssuer : ''} from ${oracle.contract}:`, error);
    return 0;
  }
};

// Find asset in the pre-built mapping
const findAssetInMapping = (assetCode: string, assetIssuer?: string): { oracle: OracleConfig; asset: Asset } | null => {
  // 1) First try direct symbol lookup (for XLM, USDC, BTC, etc.)
  if (assetOracleMapping[assetCode]) {
    return assetOracleMapping[assetCode];
  }
  
  // 2) For issued assets, try different formats
  if (assetIssuer) {
    const contractId = computeStellarAssetContractId(assetCode, assetIssuer);
    
    // Try different formats that might exist in the mapping
    const formats = [
      `stellar_${assetIssuer}`,        
      `stellar_${contractId}`,         
      contractId,                      
      assetIssuer,                     
      `${assetCode}_${assetIssuer}`,   
      `${assetCode}:${assetIssuer}`    
    ];
    
    for (const format of formats) {
      if (assetOracleMapping[format]) {
        return assetOracleMapping[format];
      }
    }
  }
  
  return null;
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
const getOracleAssetsWithRetry = async (oracle: OracleConfig, maxRetries: number = 3): Promise<string[]> => {
  const cacheKey = `assets_${oracle.contract}`;
  const cached = oracleAssetsCache[cacheKey];
  
  // Return cached assets if still valid
  if (cached && (Date.now() - cached.timestamp) < ASSETS_CACHE_DURATION) {
    
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
        
        return assets;
      }
      
      // If no assets but still have more attempts, continue immediately
      if (attempt < maxRetries - 1) {
        console.warn(`No assets returned from ${oracle.contract}, attempt ${attempt + 1}/${maxRetries}`);
      }
    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed to fetch assets from ${oracle.contract}:`, error);
      
      // Continue to next attempt immediately without delay
    }
  }
  
  return [];
};

// Resolve which oracle supports the given asset AND the correct Asset shape for that oracle
const resolveOracleAndAsset = (
  assetCode: string,
  assetIssuer?: string,
  oracles: OracleConfig[] = [REFLECTOR_ORACLES.CEX_DEX, REFLECTOR_ORACLES.STELLAR, REFLECTOR_ORACLES.FX]
): { oracle: OracleConfig; asset: Asset } | null => {
  
  for (const oracle of oracles) {
    const cacheKey = `assets_${oracle.contract}`;
    const cached = oracleAssetsCache[cacheKey];
    
    if (cached && cached.assets) {
      // 1) Direct symbol match (for assets like XLM, USDC, BTC, ETH)
      if (cached.assets.includes(assetCode)) {
        return { oracle, asset: { type: AssetType.Other, code: assetCode } };
      }
      
      // 2) Issued/Stellar assets (for assets with issuer addresses)
      if (assetIssuer) {
        // Compute SAC contract ID for this asset
        const contractId = computeStellarAssetContractId(assetCode, assetIssuer);
        
        // Try different formats that oracles might use
        const formats = [
          `stellar_${assetIssuer}`,        // Preferred stellar asset format
          `stellar_${contractId}`,         // SAC contract ID format
          contractId,                      // Direct contract ID
          assetIssuer,                     // Direct issuer address
          `${assetCode}_${assetIssuer}`,   // Asset code + issuer
          `${assetCode}:${assetIssuer}`    // Alternative separator
        ];
        
        for (const format of formats) {
          if (cached.assets.includes(format)) {
            // Determine the correct Asset type based on format
            if (format.startsWith('stellar_') || format === contractId) {
              const code = format.startsWith('stellar_') ? format.substring(8) : format;
              return { oracle, asset: { type: AssetType.Stellar, code } };
            } else {
              return { oracle, asset: { type: AssetType.Stellar, code: assetIssuer } };
            }
          }
        }
      }
    }
  }
  
  return null;
};

// Get individual asset price from oracle with retry logic
const getOracleAssetPriceWithRetry = async (oracle: OracleConfig, asset: Asset, maxRetries: number = 3): Promise<number> => {
  const cacheKey = `${oracle.contract}:${asset.code}:${asset.type}`;
  const cached = oraclePriceCache[cacheKey];
  
  // Return cached price if still valid
  if (cached && (Date.now() - cached.timestamp) < PRICE_CACHE_DURATION) {
    
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
        
        
        return price;
      }
      
      // If no price but still have attempts, continue immediately
      if (attempt < maxRetries - 1 && rawPrice === 0) {
        console.warn(`No price returned for ${asset.code}, attempt ${attempt + 1}/${maxRetries}`);
      }
    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed for ${asset.code} from ${oracle.contract}:`, error);
      
      // Continue to next attempt immediately without delay
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
export const setLastFetchTimestamp = (): void => {
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
    // Update last fetch timestamp when we successfully cache a new price
    setLastFetchTimestamp();
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

// Clear price cache and reset mapping (for refresh functionality)
export const clearPriceCache = (): void => {
  try {
    // Clear in-memory price cache
    Object.keys(oraclePriceCache).forEach(key => delete oraclePriceCache[key]);
    
    // Clear localStorage price cache
    localStorage.removeItem(CACHE_KEY);
    
    // Reset asset mapping to force re-initialization
    Object.keys(assetOracleMapping).forEach(key => delete assetOracleMapping[key]);
    mappingInitialized = false;
    mappingPromise = null;
    loadedOracles.clear();
    
  } catch (error) {
    console.warn('Failed to clear price cache:', error);
  }
};