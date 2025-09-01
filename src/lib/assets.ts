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

// Cache for SEP1 TOML data
const tomlCache = new Map<string, SEP1TomlAsset[]>();

export const fetchAssetInfo = async (assetCode: string, assetIssuer?: string): Promise<AssetInfo> => {
  // Native XLM
  if (!assetCode || assetCode === 'XLM' || !assetIssuer) {
    return {
      code: 'XLM',
      name: 'Stellar Lumens',
      image: 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png'
    };
  }

  try {
    // Check cache first
    const cacheKey = assetIssuer;
    if (tomlCache.has(cacheKey)) {
      const cachedAssets = tomlCache.get(cacheKey)!;
      const asset = cachedAssets.find(a => a.code === assetCode);
      if (asset) {
        return {
          code: asset.code,
          issuer: asset.issuer,
          name: asset.name || asset.desc,
          image: asset.image
        };
      }
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
    const assets = parseTomlCurrencies(tomlText);
    
    // Cache the results
    tomlCache.set(cacheKey, assets);
    
    // Find the specific asset
    const asset = assets.find(a => a.code === assetCode && a.issuer === assetIssuer);
    
    if (asset) {
      return {
        code: asset.code,
        issuer: asset.issuer,
        name: asset.name || asset.desc,
        image: asset.image
      };
    }
    
    throw new Error('Asset not found in TOML');
  } catch (error) {
    console.warn(`Failed to fetch asset info for ${assetCode}:${assetIssuer}`, error);
    
    // Return default asset info
    return {
      code: assetCode,
      issuer: assetIssuer,
      name: assetCode
    };
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