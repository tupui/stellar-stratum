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

// Fallback image URLs for common Stellar assets
const COMMON_ASSET_IMAGES: Record<string, string> = {
  // USDC (Circle)
  'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN': 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  // USDT (Tether)
  'USDT:GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V': 'https://cryptologos.cc/logos/tether-usdt-logo.png',
  // AQUA
  'AQUA:GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA': 'https://aqua.network/assets/img/aqua-logo.png',
  // yUSDC (Ultra Capital)
  'yUSDC:GDGTVWSM4MGS4T7Z6W4RPWOCHE2I6RDFCIFZGS3DOA63LWQTRNZNTTFF': 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  // yXLM (Ultra Capital)
  'yXLM:GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55': 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png',
};

// Generic fallback using StellarExpert for unknown assets
const getStellarExpertImageUrl = (assetCode: string, assetIssuer: string): string => {
  return `https://stellar.expert/img/vendor/asset/${assetCode}-${assetIssuer}.svg`;
};

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

export const fetchAssetInfo = async (assetCode: string, assetIssuer?: string): Promise<AssetInfo> => {
  // Native XLM
  if (!assetCode || assetCode === 'XLM' || !assetIssuer) {
    return {
      code: 'XLM',
      name: 'Stellar Lumens',
      image: 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png'
    };
  }

  // Check asset info cache first
  const assetCacheKey = `${assetCode}:${assetIssuer}`;
  const cachedAssetInfo = assetInfoCache.get(assetCacheKey);
  if (cachedAssetInfo && cachedAssetInfo.expiresAt > Date.now()) {
    return cachedAssetInfo.data;
  }

  try {
    // Check TOML cache
    const tomlCacheKey = assetIssuer;
    const cachedToml = tomlCache.get(tomlCacheKey);
    
    let assets: SEP1TomlAsset[];
    
    if (cachedToml && cachedToml.expiresAt > Date.now()) {
      assets = cachedToml.data;
    } else {
      // Skip TOML fetching on testnet to avoid unnecessary API calls
      if (assetIssuer.includes('testnet')) {
        throw new Error('Skip TOML for testnet');
      }
      
      // Fetch from Stellar account
      const response = await fetch(`${getHorizonUrl('mainnet')}/accounts/${assetIssuer}`);
      if (!response.ok) throw new Error('Failed to fetch account data');
      
      const accountData = await response.json();
      const homeDomain = accountData.home_domain;
      
      if (!homeDomain) {
        throw new Error('No home domain found');
      }

      // Fetch SEP-1 TOML
      const tomlResponse = await fetch(`https://${homeDomain}/.well-known/stellar.toml`);
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
    
    // Try to use fallback image from common assets mapping, otherwise use StellarExpert
    const fallbackImage = COMMON_ASSET_IMAGES[assetCacheKey] || getStellarExpertImageUrl(assetCode, assetIssuer || '');
    
    // Return default asset info with fallback image
    const defaultAssetInfo: AssetInfo = {
      code: assetCode,
      issuer: assetIssuer,
      name: assetCode,
      image: fallbackImage
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

export const getAssetIcon = (assetCode: string, assetIssuer?: string): string => {
  // Return a default gradient-based icon for now
  // This will be enhanced with the real icon once fetchAssetInfo is called
  if (!assetCode || assetCode === 'XLM') {
    return 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png';
  }
  
  // Return a placeholder that can be replaced
  return '';
};