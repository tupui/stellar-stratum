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
const ASSET_INFO_CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day
const STORAGE_KEY_PREFIX = 'stellar_asset_cache_';

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
    if (import.meta.env.DEV) console.warn('Failed to load asset cache from localStorage:', error);
  }
};

// Save cache entry to localStorage
const saveCacheToStorage = (key: string, entry: CacheEntry<AssetInfo>) => {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(entry));
  } catch (error) {
    if (import.meta.env.DEV) console.warn('Failed to save asset cache to localStorage:', error);
  }
};

// Initialize cache from storage
loadCacheFromStorage();

export const fetchAssetInfo = async (assetCode: string, assetIssuer?: string, network: 'mainnet' | 'testnet' = 'mainnet'): Promise<AssetInfo> => {
  // Native XLM - no image URL, let component handle fallback
  if (!assetCode || assetCode === 'XLM' || !assetIssuer) {
    return {
      code: 'XLM',
      name: 'Stellar Lumens'
    };
  }

  // Check asset info cache first
  const assetCacheKey = `${assetCode}:${assetIssuer}:${network}`;
  const cachedAssetInfo = assetInfoCache.get(assetCacheKey);
  if (cachedAssetInfo && cachedAssetInfo.expiresAt > Date.now()) {
    return cachedAssetInfo.data;
  }

  try {
    // Check TOML cache
    const tomlCacheKey = `${assetIssuer}:${network}`;
    const cachedToml = tomlCache.get(tomlCacheKey);
    
    let assets: SEP1TomlAsset[];
    
    if (cachedToml && cachedToml.expiresAt > Date.now()) {
      assets = cachedToml.data;
    } else {
      // Fetch from Stellar account using network-aware URL
      const horizonUrl = getHorizonUrl(network);
      const response = await Promise.race([
        fetch(`${horizonUrl}/accounts/${assetIssuer}`),
        new Promise<Response>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 5000)
        )
      ]);
      
      if (!response.ok) throw new Error('Failed to fetch account data');
      
      const accountData = await response.json();
      const homeDomain = accountData.home_domain;
      
      if (!homeDomain) {
        throw new Error('No home domain found');
      }

      // Fetch SEP-1 TOML directly with timeout
      const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;
      const tomlResponse = await Promise.race([
        fetch(tomlUrl),
        new Promise<Response>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 5000)
        )
      ]);
      
      if (!tomlResponse.ok) throw new Error('Failed to fetch TOML');
      
      const tomlText = await tomlResponse.text();
      
      // Parse TOML (simple parser for CURRENCIES section)
      assets = parseTomlCurrencies(tomlText);
      
      // Cache the TOML results with expiry
      const now = Date.now();
      const tomlCacheEntry: CacheEntry<SEP1TomlAsset[]> = {
        data: assets,
        timestamp: now,
        expiresAt: now + TOML_CACHE_DURATION
      };
      tomlCache.set(tomlCacheKey, tomlCacheEntry);
    }
    
    // Find the specific asset
    const asset = assets.find(a => a.code === assetCode && a.issuer === assetIssuer);
    
    if (asset) {
      const assetInfo: AssetInfo = {
        code: asset.code,
        issuer: asset.issuer,
        name: asset.name || asset.desc,
        image: asset.image
      };
      
      // Cache the asset info with longer expiry
      const now = Date.now();
      const assetCacheEntry: CacheEntry<AssetInfo> = {
        data: assetInfo,
        timestamp: now,
        expiresAt: now + ASSET_INFO_CACHE_DURATION
      };
      assetInfoCache.set(assetCacheKey, assetCacheEntry);
      saveCacheToStorage(assetCacheKey, assetCacheEntry);
      
      return assetInfo;
    }
    
    throw new Error('Asset not found in TOML');
  } catch (error) {
    if (import.meta.env.DEV) console.warn(`Failed to fetch asset info for ${assetCode}:${assetIssuer}`, error);
    
    // Return default asset info without image - component will generate fallback
    const defaultAssetInfo: AssetInfo = {
      code: assetCode,
      issuer: assetIssuer,
      name: assetCode
    };
    
    // Cache default info for shorter duration to retry sooner
    const now = Date.now();
    const defaultCacheEntry: CacheEntry<AssetInfo> = {
      data: defaultAssetInfo,
      timestamp: now,
      expiresAt: now + (5 * 60 * 1000) // 5 minutes for failed lookups
    };
    assetInfoCache.set(assetCacheKey, defaultCacheEntry);
    
    return defaultAssetInfo;
  }
};

// Simple TOML parser for CURRENCIES section
function parseTomlCurrencies(toml: string): SEP1TomlAsset[] {
  const assets: SEP1TomlAsset[] = [];
  const lines = toml.split('\n');
  let inCurrenciesSection = false;
  let currentAsset: Partial<SEP1TomlAsset> = {};
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === '[[CURRENCIES]]') {
      if (Object.keys(currentAsset).length > 0 && currentAsset.code && currentAsset.issuer) {
        assets.push(currentAsset as SEP1TomlAsset);
      }
      currentAsset = {};
      inCurrenciesSection = true;
      continue;
    }
    
    if (trimmed.startsWith('[') && trimmed !== '[[CURRENCIES]]') {
      inCurrenciesSection = false;
      if (Object.keys(currentAsset).length > 0 && currentAsset.code && currentAsset.issuer) {
        assets.push(currentAsset as SEP1TomlAsset);
      }
      currentAsset = {};
      continue;
    }
    
    if (inCurrenciesSection && trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
      
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
  if (Object.keys(currentAsset).length > 0 && currentAsset.code && currentAsset.issuer) {
    assets.push(currentAsset as SEP1TomlAsset);
  }
  
  return assets;
}

// No longer needed - AssetIcon component handles all fallbacks generically
export const getAssetIcon = (assetCode: string, assetIssuer?: string): string => {
  return '';
};