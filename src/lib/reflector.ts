// Price fetching using Reflector Oracles
import { OracleClient, type OracleConfig, AssetType, type Asset } from './reflector-client';
import { xdr, Asset as StellarAsset, hash, StrKey, Networks } from '@stellar/stellar-sdk';
import { appConfig } from './appConfig';
import { pricingLogger } from './pricing-logger';

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
    contract: appConfig.ORACLE_CONTRACT,
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
  
  // Request deduplication - if same asset is being fetched, return the same promise
  if (inflightPriceRequests.has(assetKey)) {
    pricingLogger.log({ type: 'cache_hit', asset: assetKey });
    return inflightPriceRequests.get(assetKey)!;
  }
  
  const pricePromise = (async (): Promise<number> => {
    try {
      // Try Reflector oracles for all assets
      const reflectorPrice = await fetchReflectorPrice(assetCode || 'XLM', assetIssuer);
      if (reflectorPrice > 0) {
        pricingLogger.log({ type: 'price_fetch', asset: assetKey, price: reflectorPrice, oracle: 'reflector' });
        setCachedPrice(assetKey, reflectorPrice);
        return reflectorPrice;
      }

      // Fallback to orderbook pricing (only for non-XLM assets)
      if (assetCode && assetCode !== 'XLM') {
        const { getOrderbookPrice } = await import('./orderbook-pricing');
        const orderbookPrice = await getOrderbookPrice(assetCode, assetIssuer);
        if (orderbookPrice > 0) {
          pricingLogger.log({ type: 'price_fetch', asset: assetKey, price: orderbookPrice, oracle: 'orderbook' });
          setCachedPrice(assetKey, orderbookPrice);
          return orderbookPrice;
        }
      }

      // Fallback to cached price
      const cachedPrice = getCachedPrice(assetKey);
      if (cachedPrice > 0) {
        pricingLogger.log({ type: 'fallback_used', asset: assetKey, price: cachedPrice });
      } else {
        pricingLogger.log({ type: 'cache_miss', asset: assetKey });
      }
      return cachedPrice;

    } catch (error) {
      pricingLogger.log({ 
        type: 'oracle_error', 
        asset: assetKey, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      const cachedPrice = getCachedPrice(assetKey);
      if (cachedPrice > 0) {
        pricingLogger.log({ type: 'fallback_used', asset: assetKey, price: cachedPrice });
      }
      return cachedPrice;
    } finally {
      // Remove from inflight requests
      inflightPriceRequests.delete(assetKey);
    }
  })();
  
  inflightPriceRequests.set(assetKey, pricePromise);
  return pricePromise;
};


// Cache for oracle price data
const oraclePriceCache: Record<string, { price: number; timestamp: number }> = {};
const PRICE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Request deduplication for price fetches
const inflightPriceRequests = new Map<string, Promise<number>>();

// Cache for available assets per oracle
const oracleAssetsCache: Record<string, { assets: string[]; timestamp: number }> = {};
const ASSETS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day

// In-memory cache to track which oracle asset lists are loaded
const loadedOracles = new Set<string>();

// Global client cache to prevent multiple instances for same contract
const oracleClients = new Map<string, OracleClient>();

const getOracleClient = (contractId: string): OracleClient => {
  if (!oracleClients.has(contractId)) {
    oracleClients.set(contractId, new OracleClient(contractId));
  }
  return oracleClients.get(contractId)!;
};

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
      
      // Build the mapping - simplified approach
      let totalAssets = 0;
      for (const oracle of allOracles) {
        const cacheKey = `assets_${oracle.contract}`;
        const cached = oracleAssetsCache[cacheKey];
        
        if (cached && cached.assets) {
          for (const assetId of cached.assets) {
            totalAssets++;
            
            // Simplified mapping: if it starts with stellar_, use Stellar type, otherwise Other
            if (assetId.startsWith('stellar_')) {
              const code = assetId.substring(8);
              assetOracleMapping[assetId] = { 
                oracle, 
                asset: { type: AssetType.Stellar, code } 
              };
            } else {
              // Direct symbol mapping (XLM, USDC, BTC, etc.)
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
        // Silent - mapping will retry on next call
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
    return price;
  } catch (error) {
    // Silent - return 0 for failed price fetches
    return 0;
  }
};

// Simplified oracle mapping - no more complex guessing
const findAssetInMapping = (assetCode: string, assetIssuer?: string): { oracle: OracleConfig; asset: Asset } | null => {
  const code = (assetCode || 'XLM').toUpperCase();
  
  // 1) Direct symbol lookup (XLM, USDC, BTC, etc.)
  if (assetOracleMapping[code]) {
    return assetOracleMapping[code];
  }
  
  // 2) For issued assets with issuer, try stellar format
  if (assetIssuer) {
    const stellarKey = `stellar_${assetIssuer}`;
    if (assetOracleMapping[stellarKey]) {
      return assetOracleMapping[stellarKey];
    }
    
    // Try contract ID format
    const contractId = computeStellarAssetContractId(code, assetIssuer);
    if (contractId && assetOracleMapping[contractId]) {
      return assetOracleMapping[contractId];
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
      const client = getOracleClient(oracle.contract);
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
        // Continue immediately
      }
    } catch (error) {
      // Silent - continue to next attempt
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
      const client = getOracleClient(oracle.contract);
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
        // Continue immediately
      }
    } catch (error) {
      // Silent - continue to next attempt
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
    // Ignore localStorage errors (private mode, quota exceeded)
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
    // Ignore localStorage errors (private mode, quota exceeded)
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
    // Ignore localStorage errors (private mode, quota exceeded)
  }
  return {};
};

const savePriceCache = (cache: PriceCache): void => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    // Ignore localStorage errors (private mode, quota exceeded)
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
    return null;
  }
};

// Clear price cache and reset mapping (for refresh functionality)
export const clearPriceCache = async (): Promise<void> => {
  try {
    // Clear in-memory price cache
    Object.keys(oraclePriceCache).forEach(key => delete oraclePriceCache[key]);
    
    // Clear inflight requests
    inflightPriceRequests.clear();
    
    // Clear localStorage price cache
    localStorage.removeItem(CACHE_KEY);
    
    // Reset asset mapping to force re-initialization
    Object.keys(assetOracleMapping).forEach(key => delete assetOracleMapping[key]);
    mappingInitialized = false;
    mappingPromise = null;
    loadedOracles.clear();
    
    // Log cache clear event
    pricingLogger.log({ type: 'cache_miss', asset: 'cache_cleared' });
    
    // Clear assets cache as well
    Object.keys(oracleAssetsCache).forEach(key => delete oracleAssetsCache[key]);
    
    // Clear orderbook cache as well
    const { clearOrderbookCache } = await import('./orderbook-pricing');
    clearOrderbookCache();
    
  } catch (error) {
    // Ignore localStorage errors (private mode, quota exceeded)
  }
};