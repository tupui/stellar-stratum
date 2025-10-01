import { getHorizonUrl } from './stellar';

interface AssetInfo {
  code: string;
  issuer?: string;
  image?: string;
  name?: string;
}

interface SEP1TomlAsset {
  code: string;
  issuer: string;
  image?: string;
  desc?: string;
  name?: string;
}

// Generate deterministic color for asset based on code and issuer
const generateAssetColor = (assetCode: string, assetIssuer?: string): { hue: number; saturation: number; lightness: number } => {
  const input = `${assetCode}${assetIssuer || ''}`;
  let hash = 0;
  
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Generate visually pleasing colors
  const hue = Math.abs(hash % 360);
  const saturation = 65 + (Math.abs(hash >> 8) % 20); // 65-85%
  const lightness = 50 + (Math.abs(hash >> 16) % 15); // 50-65%
  
  return { hue, saturation, lightness };
};

export const getAssetColor = generateAssetColor;

// Enhanced caching system with TOML-level coherence
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

// Cache for SEP1 TOML data per domain
const tomlCache = new Map<string, CacheEntry<SEP1TomlAsset[]>>();

// Cache for asset info
const assetInfoCache = new Map<string, CacheEntry<AssetInfo>>();

// Cache expiry times
const TOML_CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day
const ASSET_INFO_CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day
const ASSET_INFO_SHORT_CACHE = 30 * 60 * 1000; // 30 minutes for failed lookups
const STORAGE_KEY_PREFIX = 'stellar_asset_cache_v4_'; // Bumped to v4 for cache coherence
const TOML_STORAGE_PREFIX = 'stellar_toml_cache_v4_';

// Load caches from localStorage on startup
const loadCacheFromStorage = () => {
  try {
    // Load asset cache
    const assetKeys = Object.keys(localStorage).filter(key => key.startsWith(STORAGE_KEY_PREFIX));
    assetKeys.forEach(key => {
      const data = localStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data);
        const assetKey = key.replace(STORAGE_KEY_PREFIX, '');
        
        if (parsed.expiresAt > Date.now()) {
          assetInfoCache.set(assetKey, parsed);
        } else {
          localStorage.removeItem(key);
        }
      }
    });
    
    // Load TOML cache
    const tomlKeys = Object.keys(localStorage).filter(key => key.startsWith(TOML_STORAGE_PREFIX));
    tomlKeys.forEach(key => {
      const data = localStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data);
        const tomlKey = key.replace(TOML_STORAGE_PREFIX, '');
        
        if (parsed.expiresAt > Date.now()) {
          tomlCache.set(tomlKey, parsed);
        } else {
          localStorage.removeItem(key);
        }
      }
    });
  } catch (error) {
    // Silent - no console noise
  }
};

// Save cache entries to localStorage
const saveCacheToStorage = (key: string, entry: CacheEntry<AssetInfo>) => {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(entry));
  } catch (error) {
    // Silent - no console noise
  }
};

const saveTomlToStorage = (key: string, entry: CacheEntry<SEP1TomlAsset[]>) => {
  try {
    localStorage.setItem(TOML_STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch (error) {
    // Silent - no console noise
  }
};

// Initialize cache from storage
loadCacheFromStorage();

// Helper function to fetch and cache TOML data for a domain
const fetchTomlForDomain = async (homeDomain: string, network: 'mainnet' | 'testnet'): Promise<SEP1TomlAsset[]> => {
  const tomlCacheKey = `${homeDomain}:${network}`;
  
  // Check TOML cache first
  const cachedToml = tomlCache.get(tomlCacheKey);
  if (cachedToml && cachedToml.expiresAt > Date.now()) {
    return cachedToml.data;
  }
  
  // Validate domain sanity
  if (!homeDomain || homeDomain.includes(' ') || homeDomain.length < 3) {
    // Cache empty result for invalid domains
    const now = Date.now();
    const emptyEntry: CacheEntry<SEP1TomlAsset[]> = {
      data: [],
      timestamp: now,
      expiresAt: now + TOML_CACHE_DURATION
    };
    tomlCache.set(tomlCacheKey, emptyEntry);
    saveTomlToStorage(tomlCacheKey, emptyEntry);
    return [];
  }
  
  // Direct HTTPS fetch (no proxies)
  try {
    const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;
    console.log(`[TOML Debug] Fetching TOML for ${homeDomain}`);
    
    const tomlResponse = await fetch(tomlUrl, { 
      mode: 'cors',
      signal: AbortSignal.timeout(5000) 
    });
    
    if (!tomlResponse.ok) {
      console.log(`[TOML Debug] Non-2xx response from ${homeDomain}: ${tomlResponse.status}`);
      throw new Error('Non-2xx response');
    }
    
    const tomlContent = await tomlResponse.text();
    
    if (!tomlContent) {
      console.log(`[TOML Debug] Empty TOML from ${homeDomain}`);
      throw new Error('Empty TOML');
    }
    
    console.log(`[TOML Debug] Successfully fetched TOML from ${homeDomain}, length: ${tomlContent.length}`);
    
    // Parse TOML currencies
    const currencies = parseTomlCurrencies(tomlContent);
    
    // Cache the TOML data
    const now = Date.now();
    const tomlCacheEntry: CacheEntry<SEP1TomlAsset[]> = {
      data: currencies,
      timestamp: now,
      expiresAt: now + TOML_CACHE_DURATION
    };
    tomlCache.set(tomlCacheKey, tomlCacheEntry);
    saveTomlToStorage(tomlCacheKey, tomlCacheEntry);
    
    return currencies;
  } catch (error) {
    console.log(`[TOML Debug] Failed to fetch TOML for ${homeDomain}:`, error);
    
    // Silently fail: cache empty result for 24h to avoid repeated attempts
    const now = Date.now();
    const emptyEntry: CacheEntry<SEP1TomlAsset[]> = {
      data: [],
      timestamp: now,
      expiresAt: now + TOML_CACHE_DURATION
    };
    tomlCache.set(tomlCacheKey, emptyEntry);
    saveTomlToStorage(tomlCacheKey, emptyEntry);
    return [];
  }
};

// Helper to resolve image URLs properly
const resolveImageUrl = (image: string, homeDomain: string): string => {
  // Handle ipfs:// protocol
  if (image.startsWith('ipfs://')) {
    const cid = image.replace('ipfs://', '');
    return `https://ipfs.io/ipfs/${cid}`;
  }
  
  // Force HTTPS for http:// URLs
  if (image.startsWith('http://')) {
    return image.replace('http://', 'https://');
  }
  
  // Already HTTPS
  if (image.startsWith('https://')) {
    return image;
  }
  
  // Relative URL - resolve against home domain
  try {
    const baseUrl = `https://${homeDomain}/`;
    return new URL(image, baseUrl).toString();
  } catch {
    return image;
  }
};

export const fetchAssetInfo = async (assetCode: string, assetIssuer?: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<AssetInfo> => {
  const debugAssets = ['USDC', 'EURC', 'TESOURO'];
  const shouldDebug = debugAssets.includes(assetCode);
  
  if (shouldDebug) {
    console.log(`[Asset Debug] Fetching ${assetCode} issued by ${assetIssuer?.substring(0, 8)}...`);
  }
  
  // HARDCODED: Native XLM always returns immediately with official info
  if ((!assetCode || assetCode === 'XLM') && !assetIssuer) {
    return {
      code: 'XLM',
      name: 'Stellar Lumens',
      image: '/xlm-logo.png'
    };
  }
  
  // Get TOML timestamp for cache key coherence
  let homeDomain = '';
  let tomlTimestamp = 0;
  
  try {
    // Fetch issuer's home domain from Horizon
    const horizonUrl = getHorizonUrl(network);
    const accountUrl = `${horizonUrl}/accounts/${assetIssuer}`;
    
    if (shouldDebug) {
      console.log(`[Asset Debug] Fetching account from Horizon: ${accountUrl}`);
    }
    
    const accountResponse = await fetch(accountUrl);
    
    if (!accountResponse.ok) throw new Error('Account fetch failed');
    
    const accountData = await accountResponse.json();
    homeDomain = accountData.home_domain;
    
    if (shouldDebug) {
      console.log(`[Asset Debug] Home domain: ${homeDomain}`);
    }
    
    if (!homeDomain) throw new Error('No home domain');
    
    // Fetch TOML data (uses cache if available)
    const currencies = await fetchTomlForDomain(homeDomain, network);
    
    if (shouldDebug) {
      console.log(`[Asset Debug] TOML currencies found: ${currencies.length}`);
    }
    
    // Get TOML cache timestamp for this domain
    const tomlCacheKey = `${homeDomain}:${network}`;
    const cachedToml = tomlCache.get(tomlCacheKey);
    tomlTimestamp = cachedToml?.timestamp || Date.now();
    
    // Check asset cache with TOML timestamp included in key for coherence
    const assetCacheKey = `${assetCode}:${assetIssuer}:${network}:${tomlTimestamp}`;
    const cachedAssetInfo = assetInfoCache.get(assetCacheKey);
    if (cachedAssetInfo && cachedAssetInfo.expiresAt > Date.now()) {
      return cachedAssetInfo.data;
    }
    
    // Find matching asset in TOML data
    const matchingAsset = currencies.find(currency => 
      currency.code.toLowerCase() === assetCode.toLowerCase() && 
      currency.issuer === assetIssuer
    );
    
    if (shouldDebug) {
      console.log(`[Asset Debug] Matching asset found: ${!!matchingAsset}, has image: ${!!matchingAsset?.image}`);
    }
    
    let resolvedImage: string | undefined;
    if (matchingAsset?.image) {
      resolvedImage = resolveImageUrl(matchingAsset.image, homeDomain);
      if (shouldDebug) {
        console.log(`[Asset Debug] Resolved image URL: ${resolvedImage}`);
      }
    }
    
    const assetInfo: AssetInfo = {
      code: assetCode,
      issuer: assetIssuer,
      name: matchingAsset?.name || matchingAsset?.desc || assetCode,
      image: resolvedImage
    };
    
    // Cache with appropriate expiry
    const now = Date.now();
    const ttl = resolvedImage ? ASSET_INFO_CACHE_DURATION : ASSET_INFO_SHORT_CACHE;
    const assetCacheEntry: CacheEntry<AssetInfo> = {
      data: assetInfo,
      timestamp: now,
      expiresAt: now + ttl
    };
    assetInfoCache.set(assetCacheKey, assetCacheEntry);
    saveCacheToStorage(assetCacheKey, assetCacheEntry);
    
    return assetInfo;
  } catch (error) {
    if (shouldDebug) {
      console.log(`[Asset Debug] Error fetching asset info:`, error);
    }
    
    // Fallback: return basic info without image
    const assetInfo: AssetInfo = {
      code: assetCode,
      issuer: assetIssuer,
      name: assetCode
    };
    
    // Cache failure for shorter duration
    const now = Date.now();
    const assetCacheKey = `${assetCode}:${assetIssuer}:${network}:${tomlTimestamp || 0}`;
    const assetCacheEntry: CacheEntry<AssetInfo> = {
      data: assetInfo,
      timestamp: now,
      expiresAt: now + ASSET_INFO_SHORT_CACHE
    };
    assetInfoCache.set(assetCacheKey, assetCacheEntry);
    saveCacheToStorage(assetCacheKey, assetCacheEntry);
    
    return assetInfo;
  }
};

// Simple TOML parser for CURRENCIES section
function parseTomlCurrencies(toml: string): SEP1TomlAsset[] {
  const assets: SEP1TomlAsset[] = [];
  // Normalize line endings and split
  const lines = toml.replace(/\r\n/g, '\n').split('\n');
  let inCurrenciesSection = false;
  let currentAsset: Partial<SEP1TomlAsset> = {};
  
  for (let line of lines) {
    // Strip inline comments
    const commentIndex = line.indexOf('#');
    if (commentIndex !== -1) {
      line = line.substring(0, commentIndex);
    }
    const trimmed = line.trim();
    
    if (trimmed === '[[CURRENCIES]]') {
      if (Object.keys(currentAsset).length > 0 && currentAsset.code) {
        assets.push(currentAsset as SEP1TomlAsset);
      }
      currentAsset = {};
      inCurrenciesSection = true;
      continue;
    }
    
    if (trimmed.startsWith('[') && trimmed !== '[[CURRENCIES]]') {
      inCurrenciesSection = false;
      if (Object.keys(currentAsset).length > 0 && currentAsset.code) {
        assets.push(currentAsset as SEP1TomlAsset);
      }
      currentAsset = {};
      continue;
    }
    
    if (inCurrenciesSection && trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=');
      let value = valueParts.join('=').trim();
      // Remove surrounding quotes
      value = value.replace(/^["']|["']$/g, '');
      
      switch (key.trim().toLowerCase()) {
        case 'code':
          currentAsset.code = value;
          break;
        case 'issuer':
          currentAsset.issuer = value;
          break;
        case 'image':
          currentAsset.image = value;
          break;
        case 'desc':
          currentAsset.desc = value;
          break;
        case 'name':
          currentAsset.name = value;
          break;
      }
    }
  }
  
  // Don't forget the last asset
  if (Object.keys(currentAsset).length > 0 && currentAsset.code) {
    assets.push(currentAsset as SEP1TomlAsset);
  }
  
  return assets;
}
