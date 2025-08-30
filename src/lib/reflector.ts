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

// Cache for available assets per oracle
const oracleAssetsCache: Record<string, { assets: string[]; timestamp: number }> = {};
const ASSETS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day

const fetchReflectorPrice = async (assetCode: string, assetIssuer?: string): Promise<number> => {
  // Try all oracle contracts in order of preference
  const oracles = [REFLECTOR_ORACLES.STELLAR, REFLECTOR_ORACLES.CEX_DEX, REFLECTOR_ORACLES.FX];
  
  for (const oracle of oracles) {
    try {
      const price = await getOracleAssetPrice(oracle, assetCode, assetIssuer);
      if (price > 0) {
        return price;
      }
    } catch (error) {
      console.warn(`Failed to fetch from ${oracle.contract}:`, error);
      continue;
    }
  }
  
  return 0;
};

// Fetch available assets from oracle
const getOracleAssets = async (oracle: OracleConfig): Promise<string[]> => {
  const cacheKey = `assets_${oracle.contract}`;
  const cached = oracleAssetsCache[cacheKey];
  
  // Return cached assets if still valid
  if (cached && (Date.now() - cached.timestamp) < ASSETS_CACHE_DURATION) {
    return cached.assets;
  }
  
  try {
    const { Contract, rpc, Networks, TransactionBuilder } = await import('@stellar/stellar-sdk');
    
    const rpcServer = new rpc.Server('https://mainnet.sorobanrpc.com');
    const contract = new Contract(oracle.contract);
    
    const simulationAccount = 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV';
    const account = await rpcServer.getAccount(simulationAccount);
    
    const transaction = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: Networks.PUBLIC,
    })
    .addOperation(contract.call('assets'))
    .setTimeout(30)
    .build();
      
    const simResult = await rpcServer.simulateTransaction(transaction);
    
    if ('error' in simResult) {
      console.warn(`Failed to fetch assets from ${oracle.contract}:`, simResult.error);
      return [];
    }
    
    if ('result' in simResult && simResult.result && 'retval' in simResult.result) {
      const { scValToNative } = await import('@stellar/stellar-sdk');
      const resultValue = scValToNative(simResult.result.retval);
      
      // Extract asset symbols from the Vec<Asset> result
      const assetSymbols: string[] = [];
      if (Array.isArray(resultValue)) {
        for (const asset of resultValue) {
          if (asset && typeof asset === 'object') {
            // Handle Asset enum: { Stellar: Address } or { Other: Symbol }
            if ('Other' in asset && Array.isArray(asset.Other) && asset.Other[0]) {
              assetSymbols.push(String(asset.Other[0]));
            } else if ('Stellar' in asset) {
              // For Stellar assets, we might not have the symbol directly
              // but we can use the issuer address as identifier
              assetSymbols.push(`stellar_${asset.Stellar}`);
            }
          }
        }
      }
      
      // Cache the result
      oracleAssetsCache[cacheKey] = {
        assets: assetSymbols,
        timestamp: Date.now()
      };
      
      console.log(`Oracle ${oracle.contract} supports assets:`, assetSymbols);
      return assetSymbols;
    }
    
    return [];
  } catch (error) {
    console.warn(`Failed to fetch assets from oracle ${oracle.contract}:`, error);
    return [];
  }
};

// Check if asset exists in oracle
const assetExistsInOracle = async (oracle: OracleConfig, assetCode: string, assetIssuer?: string): Promise<boolean> => {
  const availableAssets = await getOracleAssets(oracle);
  
  // Check for exact symbol match
  if (availableAssets.includes(assetCode)) {
    return true;
  }
  
  // For issued assets, check for stellar asset format
  if (assetIssuer && availableAssets.includes(`stellar_${assetIssuer}`)) {
    return true;
  }
  
  return false;
};

// Get individual asset price from oracle
const getOracleAssetPrice = async (oracle: OracleConfig, assetCode: string, assetIssuer?: string): Promise<number> => {
  // First check if asset exists in this oracle
  const assetExists = await assetExistsInOracle(oracle, assetCode, assetIssuer);
  if (!assetExists) {
    console.log(`Asset ${assetCode} not available in oracle ${oracle.contract}`);
    return 0;
  }

  const cacheKey = `${oracle.contract}:${assetCode}:${assetIssuer || ''}`;
  const cached = oracleDataCache[cacheKey];
  
  // Return cached data if still valid
  if (cached && (Date.now() - cached.timestamp) < ORACLE_CACHE_DURATION) {
    console.log(`Using cached price for ${assetCode} from ${oracle.contract}: ${cached.data}`);
    return cached.data;
  }
  
  try {
    const { Contract, nativeToScVal, scValToNative, rpc, Networks, TransactionBuilder, Address } = await import('@stellar/stellar-sdk');
    
    // Use the RPC endpoint
    const rpcServer = new rpc.Server('https://mainnet.sorobanrpc.com');
    const contract = new Contract(oracle.contract);
    
    console.log(`Fetching price for ${assetCode} from oracle ${oracle.contract}`);
    
    // Build the contract call transaction for simulation
    const simulationAccount = 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV';
    const account = await rpcServer.getAccount(simulationAccount);
    
    // Create asset parameter according to Reflector API
    let assetParam;
    if (!assetCode || assetCode === 'XLM') {
      // For native XLM - use Other(Symbol) format as per docs
      assetParam = nativeToScVal({
        tag: 'Other',
        values: [nativeToScVal('XLM', { type: 'symbol' })]
      }, { type: 'instance' });
    } else if (assetIssuer) {
      // For issued assets - use Stellar(Address) format
      assetParam = nativeToScVal({
        tag: 'Stellar',
        values: [nativeToScVal(assetIssuer, { type: 'address' })]
      }, { type: 'instance' });
    } else {
      // For other symbols - use Other(Symbol) format
      assetParam = nativeToScVal({
        tag: 'Other',
        values: [nativeToScVal(assetCode, { type: 'symbol' })]
      }, { type: 'instance' });
    }
    
    try {
      // Use the correct method name from documentation: lastprice
      const transaction = new TransactionBuilder(account, {
        fee: '100000',
        networkPassphrase: Networks.PUBLIC,
      })
      .addOperation(contract.call('lastprice', assetParam))
      .setTimeout(30)
      .build();
        
      const simResult = await rpcServer.simulateTransaction(transaction);
      
      // Check if simulation was successful
      if ('error' in simResult) {
        console.warn(`Simulation error for lastprice(${assetCode}) on ${oracle.contract}:`, simResult.error);
        return 0;
      }
      
      // Check for successful result
      if ('result' in simResult && simResult.result && 'retval' in simResult.result) {
        // Extract the price from the result
        const resultValue = scValToNative(simResult.result.retval);
        console.log(`Oracle ${oracle.contract} returned for ${assetCode}:`, resultValue);
        
        // The result should be Option<PriceData> where PriceData has { price, timestamp }
        if (resultValue && typeof resultValue === 'object') {
          let price = 0;
          
          // Handle Option<PriceData> - check if it's Some(value) or None
          if ('price' in resultValue) {
            // Direct PriceData object
            price = parseFloat(String(resultValue.price));
          } else if (Array.isArray(resultValue) && resultValue.length > 0) {
            // Handle array format [Some, PriceData]
            const priceData = resultValue[0];
            if (priceData && typeof priceData === 'object' && 'price' in priceData) {
              price = parseFloat(String(priceData.price));
            }
          }
          
          // Apply decimals scaling if we have a valid price
          if (price > 0) {
            const scaledPrice = price / Math.pow(10, oracle.decimals);
            console.log(`Scaled price for ${assetCode}: ${scaledPrice}`);
            
            // Cache the successful result
            oracleDataCache[cacheKey] = {
              data: scaledPrice,
              timestamp: Date.now()
            };
            
            return scaledPrice;
          }
        }
      }
    } catch (methodError) {
      console.warn(`Method lastprice(${assetCode}) failed on ${oracle.contract}:`, methodError);
    }
    
    return 0;

  } catch (error) {
    console.warn(`Oracle ${oracle.contract} price fetch failed for ${assetCode}:`, error);
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