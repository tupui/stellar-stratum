// Price fetching using CoinGecko API (free tier) and Reflector Oracle
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const REFLECTOR_ORACLE_URL = 'https://reflector.network/oracles/public/CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M';

// Asset mapping for CoinGecko price fetching
const ASSET_ID_MAP: Record<string, string> = {
  'XLM': 'stellar',
  'USDC': 'usd-coin',
  'EURC': 'euro-coin',
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
};

// Assets supported by Reflector Oracle (prices in USDC)
const REFLECTOR_ASSETS: Record<string, string> = {
  'AQUA': 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA',
  'XRF': 'GCHI6I3X62ND5XUMWINNNKXS2HPYZWKFQBZZYBSMHJ4MIP2XJXSZTXRF',
  'USDC': 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', // Circle USDC
};

export interface AssetPrice {
  symbol: string;
  price: number; // Price in USD
  timestamp: number;
}

export const getAssetPrice = async (assetCode?: string, assetIssuer?: string): Promise<number> => {
  try {
    // For native XLM
    if (!assetCode || assetCode === 'XLM') {
      return await fetchCoinGeckoPrice('stellar');
    }

    // Check if asset is supported by Reflector Oracle first
    if (assetCode && REFLECTOR_ASSETS[assetCode] && 
        (!assetIssuer || REFLECTOR_ASSETS[assetCode] === assetIssuer)) {
      const reflectorPrice = await fetchReflectorPrice(assetCode);
      if (reflectorPrice > 0) {
        // Convert USDC price to USD (in case USDC depegs)
        const usdcToUsd = await getUsdcToUsdRate();
        return reflectorPrice * usdcToUsd;
      }
    }

    // For USDC, get actual rate (don't assume 1:1 with USD)
    if (assetCode === 'USDC') {
      return await fetchCoinGeckoPrice('usd-coin');
    }

    // For other known assets in CoinGecko
    const coinId = ASSET_ID_MAP[assetCode];
    if (coinId) {
      return await fetchCoinGeckoPrice(coinId);
    }

    // For unknown assets, try to get a fallback price
    return getFallbackPrice(assetCode);

  } catch (error) {
    console.warn(`Failed to get price for ${assetCode}:`, error);
    return getFallbackPrice(assetCode);
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

const fetchReflectorPrice = async (assetCode: string): Promise<number> => {
  try {
    const response = await fetch(REFLECTOR_ORACLE_URL, {
      headers: {
        'accept': 'text/html',
      },
    });

    if (!response.ok) {
      throw new Error(`Reflector API error: ${response.status}`);
    }

    const html = await response.text();
    
    // Parse HTML to find the asset price
    // Look for pattern: assetCode followed by price in USDC
    const assetIssuer = REFLECTOR_ASSETS[assetCode];
    if (!assetIssuer) return 0;
    
    // Create regex to find asset price (look for asset code followed by issuer and price in USDC)
    const shortIssuer = assetIssuer.substring(0, 4) + '…' + assetIssuer.substring(-4);
    const regex = new RegExp(`${assetCode}[^0-9]*${shortIssuer}[^0-9]*([0-9]+\\.?[0-9]*) USDC`, 'i');
    const match = html.match(regex);
    
    if (match && match[1]) {
      return parseFloat(match[1]);
    }
    
    // Fallback: look for just asset code and price
    const simpleRegex = new RegExp(`${assetCode}[^0-9]*([0-9]+\\.?[0-9]*) USDC`, 'i');
    const simpleMatch = html.match(simpleRegex);
    
    if (simpleMatch && simpleMatch[1]) {
      return parseFloat(simpleMatch[1]);
    }
    
    return 0;

  } catch (error) {
    console.warn(`Reflector price fetch failed for ${assetCode}:`, error);
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

// Fallback prices based on recent market data (in USD)
const getFallbackPrice = (assetCode: string): number => {
  const fallbackPrices: Record<string, number> = {
    'XLM': 0.36, // Stellar Lumens
    'USDC': 1.0, // USD Coin
    'EURC': 1.15, // Euro Coin (approximate EUR/USD)
    'AQUA': 0.00088, // Aqua token
    'yUSDC': 1.0, // Yield USDC
    'BTC': 65000, // Bitcoin
    'ETH': 2600, // Ethereum
  };

  return fallbackPrices[assetCode?.toUpperCase() || ''] || 0;
};

export const getAssetSymbol = (assetCode?: string): string => {
  if (!assetCode) return 'XLM';
  return assetCode;
};