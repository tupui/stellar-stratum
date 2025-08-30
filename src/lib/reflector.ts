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
    // Call the oracle contract directly using Stellar RPC
    const rpcUrl = 'https://soroban-rpc.stellar.org';
    
    // Create the contract call to get all prices
    const contractCall = {
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: {
        transaction: await buildGetPricesTransaction(oracle.contract),
      }
    };

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contractCall),
    });

    if (!response.ok) {
      throw new Error(`Oracle ${oracle.contract} RPC error: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.error) {
      throw new Error(`Oracle contract error: ${result.error.message}`);
    }

    // Parse the contract response to find our asset
    const price = await parseOracleResponse(result, assetCode, oracle, assetIssuer);
    
    if (price > 0) {
      console.log(`Found ${assetCode} price: ${price} ${oracle.base} from oracle ${oracle.contract}`);
      return price;
    }
    
    return 0;

  } catch (error) {
    console.warn(`Oracle ${oracle.contract} contract call failed for ${assetCode}:`, error);
    // Fallback to web scraping for now
    return await fetchPriceFromOracleWeb(oracle, assetCode, assetIssuer);
  }
};

const buildGetPricesTransaction = async (contractAddress: string): Promise<string> => {
  // This is a simplified version - in a real implementation, you'd use Stellar SDK
  // to build a proper transaction that calls the oracle's get_prices method
  // For now, we'll use a basic structure
  const { TransactionBuilder, Keypair, Networks } = await import('@stellar/stellar-sdk');
  
  try {
    const sourceKeypair = Keypair.random(); // Temporary keypair for simulation
    const sourceAccount = await import('@stellar/stellar-sdk').then(({ Account }) => 
      new Account(sourceKeypair.publicKey(), '1')
    );
    
    const transaction = new TransactionBuilder(
      sourceAccount,
      { fee: '100', networkPassphrase: Networks.PUBLIC }
    )
    .setTimeout(30)
    .build();
    
    return transaction.toXDR();
  } catch (error) {
    console.warn('Failed to build transaction:', error);
    throw error;
  }
};

const parseOracleResponse = async (response: any, assetCode: string, oracle: OracleConfig, assetIssuer?: string): Promise<number> => {
  try {
    // Parse the Soroban contract response
    // This would need to be implemented based on the actual oracle contract structure
    // For now, return 0 to trigger fallback
    return 0;
  } catch (error) {
    console.warn('Failed to parse oracle response:', error);
    return 0;
  }
};

// Fallback web scraping method (existing implementation)
const fetchPriceFromOracleWeb = async (oracle: OracleConfig, assetCode: string, assetIssuer?: string): Promise<number> => {
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
    
    // Enhanced regex patterns for better matching
    let regex: RegExp;
    
    if (assetCode === 'XRF') {
      // Specific pattern for XRF with reflector.network domain
      regex = new RegExp(`XRF[^0-9]*reflector\\.network[^0-9]*([0-9]+\\.?[0-9]*) ${oracle.base}`, 'i');
    } else if (assetIssuer) {
      // For assets with issuer, look for asset code + shortened issuer + price
      const shortIssuer = assetIssuer.substring(0, 4) + '…' + assetIssuer.slice(-4);
      regex = new RegExp(`${assetCode}[^0-9]*${shortIssuer}[^0-9]*([0-9]+\\.?[0-9]*) ${oracle.base}`, 'i');
    } else if (assetCode === 'XLM') {
      // For XLM, look for "XLMstellar.org" pattern
      regex = new RegExp(`XLM[^0-9]*stellar\\.org[^0-9]*([0-9]+\\.?[0-9]*) ${oracle.base}`, 'i');
    } else {
      // For other assets, look for just asset code + price
      regex = new RegExp(`${assetCode}[^0-9A-Za-z]*[^0-9]*([0-9]+\\.?[0-9]*) ${oracle.base}`, 'i');
    }
    
    const match = html.match(regex);
    
    if (match && match[1]) {
      console.log(`Found ${assetCode} price: ${match[1]} ${oracle.base} from oracle web ${oracle.contract}`);
      return parseFloat(match[1]);
    }
    
    return 0;

  } catch (error) {
    console.warn(`Oracle ${oracle.contract} web fetch failed for ${assetCode}:`, error);
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