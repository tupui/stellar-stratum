// Price fetching using CoinGecko API (free tier) and Reflector Oracles
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

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

// Asset mapping for CoinGecko price fetching (fallback)
const ASSET_ID_MAP: Record<string, string> = {
  'XLM': 'stellar',
  'USDC': 'usd-coin',
  'EURC': 'euro-coin',
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
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
      // Try Reflector oracles first, then CoinGecko as fallback
      const reflectorPrice = await fetchReflectorPrice(assetCode || 'XLM', assetIssuer);
      if (reflectorPrice > 0) {
        return reflectorPrice;
      }
      return await fetchCoinGeckoPrice('stellar');
    }

    // Try Reflector oracles first for all assets
    const reflectorPrice = await fetchReflectorPrice(assetCode, assetIssuer);
    if (reflectorPrice > 0) {
      return reflectorPrice;
    }

    // Fallback to CoinGecko for known assets
    const coinId = ASSET_ID_MAP[assetCode];
    if (coinId) {
      return await fetchCoinGeckoPrice(coinId);
    }

    // Final fallback to static prices
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

const fetchReflectorPrice = async (assetCode: string, assetIssuer?: string): Promise<number> => {
  // Try all oracle contracts in order of preference
  const oracles = [REFLECTOR_ORACLES.STELLAR, REFLECTOR_ORACLES.CEX_DEX, REFLECTOR_ORACLES.FX];
  
  for (const oracle of oracles) {
    try {
      const price = await fetchPriceFromOracle(oracle, assetCode, assetIssuer);
      if (price > 0) {
        // Convert to USD if the base is not USD
        if (oracle.base === 'USDC') {
          const usdcToUsd = await getUsdcToUsdRate();
          return price * usdcToUsd;
        }
        return price;
      }
    } catch (error) {
      console.warn(`Failed to fetch from ${oracle.contract}:`, error);
      continue;
    }
  }
  
  return 0;
};

const fetchPriceFromOracle = async (oracle: OracleConfig, assetCode: string, assetIssuer?: string): Promise<number> => {
  try {
    const response = await fetch(oracle.url, {
      headers: {
        'accept': 'text/html',
      },
    });

    if (!response.ok) {
      throw new Error(`Oracle ${oracle.contract} API error: ${response.status}`);
    }

    const html = await response.text();
    
    // Debug XRF specifically
    if (assetCode === 'XRF') {
      console.log('XRF Debug: Searching in oracle', oracle.contract);
      console.log('XRF Debug: HTML length', html.length);
      
      // Look for any mention of reflector or XRF (case insensitive)
      const hasReflector = /reflector/i.test(html);
      const hasXrf = /xrf/i.test(html);
      console.log('XRF Debug: HTML contains reflector?', hasReflector);
      console.log('XRF Debug: HTML contains XRF?', hasXrf);
      
      // Check for the specific issuer address
      const xrfIssuer = 'GCHI6I3X62ND5XUMWINNNKXS2HPYZWKFQBZZYBSMHJ4MIP2XJXSZTXRF';
      const hasXrfIssuer = html.includes(xrfIssuer);
      console.log('XRF Debug: HTML contains XRF issuer?', hasXrfIssuer);
      
      if (hasXrfIssuer) {
        // Find the context around the XRF issuer
        const issuerIndex = html.indexOf(xrfIssuer);
        const contextStart = Math.max(0, issuerIndex - 200);
        const contextEnd = Math.min(html.length, issuerIndex + 200);
        const context = html.substring(contextStart, contextEnd);
        console.log('XRF Debug: Context around issuer:', context);
        
        // Look for price pattern in context
        const priceInContext = context.match(/(\d+\.?\d*)\s*(USDC|USD)/);
        if (priceInContext) {
          console.log('XRF Debug: Found price in context:', priceInContext[1], priceInContext[2]);
          return parseFloat(priceInContext[1]);
        }
      }
      
      // If we still can't find it, log a sample of the HTML
      if (oracle.contract === 'CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M') {
        console.log('XRF Debug: Sample HTML from Stellar oracle (first 1000 chars):', html.substring(0, 1000));
      }
    }
    
    // Parse HTML to find the asset price
    let regex: RegExp;
    
    if (assetIssuer) {
      // For assets with issuer, look for asset code + shortened issuer + price
      const shortIssuer = assetIssuer.substring(0, 4) + '…' + assetIssuer.substring(-4);
      regex = new RegExp(`${assetCode}[^0-9]*${shortIssuer}[^0-9]*([0-9]+\\.?[0-9]*) ${oracle.base}`, 'i');
    } else if (assetCode === 'XLM') {
      // For XLM, look for "XLMstellar.org" pattern
      regex = new RegExp(`XLM[^0-9]*stellar\\.org[^0-9]*([0-9]+\\.?[0-9]*) ${oracle.base}`, 'i');
    } else {
      // For other assets, look for just asset code + price with more flexible matching
      regex = new RegExp(`${assetCode}[^0-9A-Za-z]*[^0-9]*([0-9]+\\.?[0-9]*) ${oracle.base}`, 'i');
    }
    
    const match = html.match(regex);
    
    if (match && match[1]) {
      console.log(`Found ${assetCode} price: ${match[1]} ${oracle.base} from oracle ${oracle.contract}`);
      return parseFloat(match[1]);
    }
    
    return 0;

  } catch (error) {
    console.warn(`Oracle ${oracle.contract} price fetch failed for ${assetCode}:`, error);
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