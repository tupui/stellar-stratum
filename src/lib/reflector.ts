// Simple price fetching using CoinGecko API (free tier)
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Asset mapping for price fetching
const ASSET_ID_MAP: Record<string, string> = {
  'XLM': 'stellar',
  'USDC': 'usd-coin',
  'EURC': 'euro-coin',
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'AQUA': 'aquarius-protocol', // Example mapping
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

    // For USDC, assume 1:1 with USD
    if (assetCode === 'USDC') {
      return 1.0;
    }

    // For other known assets
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