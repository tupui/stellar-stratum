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

// Enhanced caching system
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

// Cache for SEP1 TOML data
const tomlCache = new Map<string, CacheEntry<SEP1TomlAsset[]>>();

// Cache for asset info with longer expiry
const assetInfoCache = new Map<string, CacheEntry<AssetInfo>>();

// Cache expiry times
const TOML_CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day
const ASSET_INFO_CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day for successful fetches with image
const ASSET_INFO_SHORT_CACHE = 30 * 60 * 1000; // 30 minutes for entries without image
const STORAGE_KEY_PREFIX = 'stellar_asset_cache_v3_'; // Bumped to v3 for XLM TOML fetch

// Load cache from localStorage on startup
const loadCacheFromStorage = () => {
  try {
    const keys = Object.keys(localStorage).filter(key => key.startsWith(STORAGE_KEY_PREFIX));
    keys.forEach(key => {
      const data = localStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data);
        const assetKey = key.replace(STORAGE_KEY_PREFIX, '');
        
        // Check if cache entry is still valid
        if (parsed.expiresAt > Date.now()) {
          assetInfoCache.set(assetKey, parsed);
        } else {
          localStorage.removeItem(key);
        }
      }
    });
  } catch (error) {
    // Silent - no console noise
  }
};

// Save cache entry to localStorage
const saveCacheToStorage = (key: string, entry: CacheEntry<AssetInfo>) => {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(entry));
  } catch (error) {
    // Silent - no console noise
  }
};

// Initialize cache from storage
loadCacheFromStorage();

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
  // Check asset info cache first
  const assetCacheKey = `${assetCode}:${assetIssuer || 'native'}:${network}`;
  const cachedAssetInfo = assetInfoCache.get(assetCacheKey);
  if (cachedAssetInfo && cachedAssetInfo.expiresAt > Date.now()) {
    return cachedAssetInfo.data;
  }

  // Handle native XLM by fetching from stellar.org
  const isNativeXLM = (!assetCode || assetCode === 'XLM') && !assetIssuer;
  let homeDomain = '';

  if (isNativeXLM) {
    homeDomain = 'stellar.org';
  } else {
    try {
      // Fetch issuer's home domain from Horizon
      const horizonUrl = getHorizonUrl(network);
      const accountUrl = `${horizonUrl}/accounts/${assetIssuer}`;
      const accountResponse = await fetch(accountUrl);
      
      if (!accountResponse.ok) throw new Error('Account fetch failed');
      
      const accountData = await accountResponse.json();
      homeDomain = accountData.home_domain;
      
      if (!homeDomain) throw new Error('No home domain');
    } catch (error) {
      throw new Error('Failed to fetch account home domain');
    }
  }

  try {
    let tomlContent = '';
    
    // Try primary CORS proxy
    try {
      const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;
      const corsProxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(tomlUrl)}`;
      const tomlResponse = await fetch(corsProxyUrl, { signal: AbortSignal.timeout(5000) });
      
      if (tomlResponse.ok) {
        const tomlData = await tomlResponse.json();
        tomlContent = tomlData.contents;
      }
    } catch {
      // Fallback to jina.ai proxy
      try {
        const tomlUrl = `http://${homeDomain}/.well-known/stellar.toml`;
        const jinaUrl = `https://r.jina.ai/${tomlUrl}`;
        const tomlResponse = await fetch(jinaUrl, { signal: AbortSignal.timeout(5000) });
        
        if (tomlResponse.ok) {
          tomlContent = await tomlResponse.text();
        }
      } catch {
        throw new Error('Both CORS proxies failed');
      }
    }
    
    if (!tomlContent) throw new Error('No TOML content');
    
    // Parse TOML to find asset info
    const currencies = parseTomlCurrencies(tomlContent);
    const matchingAsset = currencies.find(currency => {
      if (isNativeXLM) {
        return currency.code === 'XLM';
      }
      return currency.code === assetCode && currency.issuer === assetIssuer;
    });
    
    let resolvedImage: string | undefined;
    if (matchingAsset?.image) {
      resolvedImage = resolveImageUrl(matchingAsset.image, homeDomain);
    }
    
    const assetInfo: AssetInfo = {
      code: assetCode || 'XLM',
      issuer: assetIssuer,
      name: matchingAsset?.name || matchingAsset?.desc || assetCode || 'Stellar Lumens',
      image: resolvedImage
    };
    
    // Cache with appropriate expiry based on whether we found an image
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
    // Fallback: return basic info without image
    const assetInfo: AssetInfo = {
      code: assetCode,
      issuer: assetIssuer,
      name: assetCode
    };
    
    // Cache failure for shorter duration
    const now = Date.now();
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

// No longer needed - AssetIcon component handles all fallbacks generically
export const getAssetIcon = (assetCode: string, assetIssuer?: string): string => {
  return '';
};