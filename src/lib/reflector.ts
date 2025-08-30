// Price fetching using Reflector Oracles

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


export interface AssetPrice {
  symbol: string;
  price: number; // Price in USD
  timestamp: number;
}

export const getAssetPrice = async (assetCode?: string, assetIssuer?: string): Promise<number> => {
  const assetKey = assetIssuer ? `${assetCode}:${assetIssuer}` : (assetCode || 'XLM');
  
  try {
    // Try Reflector oracles for all assets
    const reflectorPrice = await fetchReflectorPrice(assetCode || 'XLM', assetIssuer);
    if (reflectorPrice > 0) {
      setCachedPrice(assetKey, reflectorPrice);
      return reflectorPrice;
    }

    // Fallback to cached price
    return getCachedPrice(assetKey);

  } catch (error) {
    console.warn(`Failed to get price for ${assetCode}:`, error);
    return getCachedPrice(assetKey);
  }
};


// Cache for oracle data to avoid multiple calls per contract
const oracleDataCache: Record<string, { data: any; timestamp: number }> = {};
const ORACLE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const fetchReflectorPrice = async (assetCode: string, assetIssuer?: string): Promise<number> => {
  // Try all oracle contracts in order of preference
  const oracles = [REFLECTOR_ORACLES.STELLAR, REFLECTOR_ORACLES.CEX_DEX, REFLECTOR_ORACLES.FX];
  
  for (const oracle of oracles) {
    try {
      const oracleData = await getOracleData(oracle);
      if (oracleData) {
        const price = extractAssetPrice(oracleData, assetCode, oracle, assetIssuer);
        if (price > 0) {
          return price;
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch from ${oracle.contract}:`, error);
      continue;
    }
  }
  
  return 0;
};

// Get all oracle data with a single contract call per oracle
const getOracleData = async (oracle: OracleConfig): Promise<any> => {
  const cacheKey = oracle.contract;
  const cached = oracleDataCache[cacheKey];
  
  // Return cached data if still valid
  if (cached && (Date.now() - cached.timestamp) < ORACLE_CACHE_DURATION) {
    console.log(`Using cached oracle data for ${oracle.contract}`);
    return cached.data;
  }
  
  try {
    const { Contract, nativeToScVal, scValToNative, rpc, Networks, TransactionBuilder } = await import('@stellar/stellar-sdk');
    
    // Use a CORS-friendly RPC endpoint
    const rpcServer = new rpc.Server('https://soroban-rpc.mainnet.stellar.gateway.fm');
    const contract = new Contract(oracle.contract);
    
    console.log(`Fetching all asset prices from oracle ${oracle.contract}`);
    
    // Build the contract call transaction for simulation
    const simulationAccount = 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV';
    const account = await rpcServer.getAccount(simulationAccount);
    
    // Try different method names for getting all assets/prices
    const methodNames = ['assets', 'prices', 'get_assets', 'get_prices', 'all_prices'];
    
    for (const method of methodNames) {
      try {
        // Build transaction with proper TransactionBuilder
        const transaction = new TransactionBuilder(account, {
          fee: '100000',
          networkPassphrase: Networks.PUBLIC,
        })
        .addOperation(contract.call(method))
        .setTimeout(30)
        .build();
          
        const simResult = await rpcServer.simulateTransaction(transaction);
        
        // Check if simulation was successful
        if ('error' in simResult) {
          console.warn(`Simulation error for ${method} on ${oracle.contract}:`, simResult.error);
          continue;
        }
        
        // Check for successful result
        if ('result' in simResult && simResult.result && 'retval' in simResult.result) {
          // Extract the data from the result
          const resultValue = scValToNative(simResult.result.retval);
          console.log(`Oracle ${oracle.contract} returned data:`, resultValue);
          
          // Cache the successful result
          oracleDataCache[cacheKey] = {
            data: resultValue,
            timestamp: Date.now()
          };
          
          return resultValue;
        }
      } catch (methodError) {
        console.warn(`Method ${method} failed on ${oracle.contract}:`, methodError);
        continue;
      }
    }
    
    return null;

  } catch (error) {
    console.warn(`Oracle ${oracle.contract} data fetch failed:`, error);
    return null;
  }
};

// Extract specific asset price from oracle data
const extractAssetPrice = (oracleData: any, assetCode: string, oracle: OracleConfig, assetIssuer?: string): number => {
  try {
    if (!oracleData) return 0;
    
    // Handle different oracle data formats
    let price = 0;
    
    // If it's an array of assets/prices
    if (Array.isArray(oracleData)) {
      const assetData = oracleData.find(item => {
        if (typeof item === 'object' && item.asset) {
          if (!assetCode || assetCode === 'XLM') {
            return item.asset === 'XLM' || item.asset === 'Native';
          }
          return item.asset === assetCode || (item.code === assetCode && item.issuer === assetIssuer);
        }
        return false;
      });
      
      if (assetData && assetData.price) {
        price = parseFloat(assetData.price);
      }
    }
    
    // If it's an object with asset keys
    else if (typeof oracleData === 'object') {
      const assetKey = !assetCode || assetCode === 'XLM' ? 'XLM' : assetCode;
      
      // Try different key formats
      const possibleKeys = [assetKey, `${assetKey}:${assetIssuer}`, 'Native'];
      
      for (const key of possibleKeys) {
        if (oracleData[key] && typeof oracleData[key] === 'number') {
          price = oracleData[key];
          break;
        }
        if (oracleData[key] && oracleData[key].price) {
          price = parseFloat(oracleData[key].price);
          break;
        }
      }
    }
    
    // Apply decimals scaling if we have a valid price
    if (price > 0) {
      const scaledPrice = price / Math.pow(10, oracle.decimals);
      console.log(`Extracted price for ${assetCode}: ${scaledPrice}`);
      return scaledPrice;
    }
    
    return 0;

  } catch (error) {
    console.warn(`Failed to extract price for ${assetCode}:`, error);
    return 0;
  }
};




// Price cache for fallback to previous values with localStorage persistence
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = 'stellar_asset_prices';

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
    console.warn('Failed to load price cache from localStorage:', error);
  }
  return {};
};

const savePriceCache = (cache: PriceCache): void => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Failed to save price cache to localStorage:', error);
  }
};

const getCachedPrice = (assetKey: string): number => {
  const cache = loadPriceCache();
  const cached = cache[assetKey];
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    console.log(`Using cached price for ${assetKey}: ${cached.price}`);
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
    console.warn('Failed to get last price update:', error);
    return null;
  }
};