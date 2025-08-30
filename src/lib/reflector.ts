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


const fetchReflectorPrice = async (assetCode: string, assetIssuer?: string): Promise<number> => {
  // Try all oracle contracts in order of preference
  const oracles = [REFLECTOR_ORACLES.STELLAR, REFLECTOR_ORACLES.CEX_DEX, REFLECTOR_ORACLES.FX];
  
  for (const oracle of oracles) {
    try {
      const price = await fetchPriceFromOracle(oracle, assetCode, assetIssuer);
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

const fetchPriceFromOracle = async (oracle: OracleConfig, assetCode: string, assetIssuer?: string): Promise<number> => {
  try {
    const { Contract, Address, nativeToScVal, scValToNative, rpc, Networks, TransactionBuilder, Account } = await import('@stellar/stellar-sdk');
    
    const rpcServer = new rpc.Server('https://mainnet.sorobanrpc.com');
    const contract = new Contract(oracle.contract);
    
    // Create asset parameter - for XLM use native, for others create asset struct
    let assetParam;
    if (!assetCode || assetCode === 'XLM') {
      assetParam = nativeToScVal('Native', { type: 'symbol' });
    } else {
      // For issued assets, create an asset object
      assetParam = nativeToScVal({
        Other: {
          code: assetCode,
          issuer: assetIssuer || ''
        }
      }, { type: 'instance' });
    }
    
    console.log(`Calling Reflector oracle ${oracle.contract} for ${assetCode}`);
    
    // Build the contract call transaction for simulation
    const simulationAccount = 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV';
    const account = await rpcServer.getAccount(simulationAccount);
    
    // Try different method names that Reflector might use
    const methodNames = ['price', 'get_price', 'lastprice', 'asset_price'];
    
    for (const method of methodNames) {
      try {
        // Build transaction with proper TransactionBuilder
        const transaction = new TransactionBuilder(account, {
          fee: '100000',
          networkPassphrase: Networks.PUBLIC,
        })
        .addOperation(contract.call(method, assetParam))
        .setTimeout(30)
        .build();
          
        const simResult = await rpcServer.simulateTransaction(transaction);
        
        // Check if simulation was successful
        if ('error' in simResult) {
          console.warn(`Simulation error for ${method}:`, simResult.error);
          continue;
        }
        
        // Check for successful result
        if ('result' in simResult && simResult.result && 'retval' in simResult.result) {
          // Extract the price from the result
          const resultValue = scValToNative(simResult.result.retval);
          console.log(`Oracle ${oracle.contract} returned:`, resultValue);
          
          // Handle different return formats
          let price = 0;
          if (typeof resultValue === 'number') {
            price = resultValue;
          } else if (typeof resultValue === 'string') {
            price = parseFloat(resultValue);
          } else if (resultValue && typeof resultValue === 'object' && 'price' in resultValue) {
            price = parseFloat(resultValue.price);
          }
          
          // Apply decimals scaling
          if (price > 0) {
            const scaledPrice = price / Math.pow(10, oracle.decimals);
            console.log(`Scaled price for ${assetCode}: ${scaledPrice}`);
            return scaledPrice;
          }
        }
      } catch (methodError) {
        console.warn(`Method ${method} failed on ${oracle.contract}:`, methodError);
        continue;
      }
    }
    
    return 0;

  } catch (error) {
    console.warn(`Oracle ${oracle.contract} contract call failed for ${assetCode}:`, error);
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

export const getAssetSymbol = (assetCode?: string): string => {
  if (!assetCode) return 'XLM';
  return assetCode;
};