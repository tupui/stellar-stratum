// Kraken OHLC daily helper for multi-asset USD rates (no API key, public REST)
// Docs: https://docs.kraken.com/api/docs/rest-api/get-ohlc-data

type DailyMap = Record<string, number>; // yyyy-mm-dd -> USD close

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hour TTL for all cache data

const toDateKey = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const todayKeyUTC = (): string => toDateKey(new Date());

// Lightweight minute limiter (~20/min)
const WINDOW_MS = 60_000;
const LIMIT = 20;
let stamps: number[] = [];
let q: Promise<any> = Promise.resolve();
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
function cleanup() { const now = Date.now(); stamps = stamps.filter(t => now - t < WINDOW_MS); }
async function acquire() { cleanup(); const now = Date.now(); if (stamps.length < LIMIT) { stamps.push(now); return; } const wait = Math.max(0, WINDOW_MS - (now - stamps[0])); if (wait > 0) await sleep(wait); cleanup(); stamps.push(Date.now()); }
function runLimited<T>(fn: () => Promise<T>): Promise<T> { const task = q.then(async () => { await acquire(); return await fn(); }); q = task.then(() => undefined).catch(() => undefined); return task; }

// Request deduplication for Kraken fetches
const inflightKrakenRequests = new Map<string, Promise<void>>();

// Cache for supported Kraken pairs
const SUPPORTED_PAIRS_CACHE_KEY = 'kraken_supported_pairs_v1';
const SUPPORTED_PAIRS_TIMESTAMP_KEY = 'kraken_supported_pairs_timestamp_v1';
let supportedPairsCache: Set<string> | null = null;

// Fetch supported pairs from Kraken API
const fetchSupportedPairs = async (): Promise<Set<string>> => {
  try {
    // Check if we have cached pairs and they're still fresh
    const cachedTimestamp = localStorage.getItem(SUPPORTED_PAIRS_TIMESTAMP_KEY);
    const cachedPairs = localStorage.getItem(SUPPORTED_PAIRS_CACHE_KEY);
    
    if (cachedTimestamp && cachedPairs) {
      const timestamp = Number(cachedTimestamp);
      if (Date.now() - timestamp < CACHE_TTL_MS) {
        try {
          const pairs = new Set(JSON.parse(cachedPairs) as string[]);
          supportedPairsCache = pairs;
          return pairs;
        } catch {
          // Invalid cached data, continue to fetch fresh
        }
      }
    }

    // Fetch fresh data from Kraken
    const resp = await runLimited(() => 
      fetch('https://api.kraken.com/0/public/AssetPairs', { mode: 'cors' as RequestMode })
    );
    
    if (!resp.ok) {
      // Fallback to cached data if API fails
      if (cachedPairs) {
        try {
          const pairs = new Set(JSON.parse(cachedPairs) as string[]);
          supportedPairsCache = pairs;
          return pairs;
        } catch {
          // Invalid cached data, return empty set
        }
      }
      throw new Error(`Failed to fetch supported pairs: ${resp.status}`);
    }

    const json: any = await resp.json();
    if (!json?.result) {
      throw new Error('Invalid response from Kraken AssetPairs API');
    }

    const pairs = new Set(Object.keys(json.result));
    
    // Cache the results
    try {
      localStorage.setItem(SUPPORTED_PAIRS_CACHE_KEY, JSON.stringify([...pairs]));
      localStorage.setItem(SUPPORTED_PAIRS_TIMESTAMP_KEY, String(Date.now()));
    } catch {
      // Ignore localStorage errors
    }
    
    supportedPairsCache = pairs;
    return pairs;
  } catch (error) {
    console.warn('Failed to fetch Kraken supported pairs:', error);
    // Return empty set on error to avoid trying invalid pairs
    return new Set<string>();
  }
};

// Get supported pairs (with caching)
const getSupportedPairs = async (): Promise<Set<string>> => {
  if (supportedPairsCache) {
    return supportedPairsCache;
  }
  return await fetchSupportedPairs();
};

// Generic helpers for per-asset caching
const getAssetCacheKeys = (asset: string) => {
  const code = (asset || 'XLM').toUpperCase();
  return {
    cacheKey: `kraken_${code}_usd_ohlc_daily_v1`,
    lastFetchKey: `kraken_${code}_last_fetch_v1`
  };
};

const loadCacheFor = (asset: string): DailyMap => {
  try {
    const { cacheKey } = getAssetCacheKeys(asset);
    const raw = localStorage.getItem(cacheKey);
    return raw ? (JSON.parse(raw) as DailyMap) : {};
  } catch {
    return {};
  }
};

const saveCacheFor = (asset: string, map: DailyMap) => {
  try {
    const { cacheKey } = getAssetCacheKeys(asset);
    localStorage.setItem(cacheKey, JSON.stringify(map));
  } catch {
    // ignore
  }
};

const getLastFetchTime = (asset: string): number => {
  try {
    const { lastFetchKey } = getAssetCacheKeys(asset);
    const raw = localStorage.getItem(lastFetchKey);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
};

const setLastFetchTime = (asset: string, timestamp: number) => {
  try {
    const { lastFetchKey } = getAssetCacheKeys(asset);
    localStorage.setItem(lastFetchKey, String(timestamp));
  } catch {
    // ignore
  }
};

// Generate potential pair names for an asset
const generatePotentialPairs = (asset: string): string[] => {
  const code = asset.toUpperCase();
  return [
    `${code}USD`,
    `${code}ZUSD`,
    `X${code}ZUSD`,
    `${code}XUSD`,
    `XX${code}ZUSD`
  ];
};

// Fetch full year of OHLC data for an asset
const fetchFullYearForAsset = async (asset: string): Promise<void> => {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const since = Math.floor(oneYearAgo.getTime() / 1000);
  
  const baseUrl = 'https://api.kraken.com/0/public/OHLC';
  const code = (asset || 'XLM').toUpperCase();
  
  if (import.meta.env.DEV) {
    console.debug(`Kraken: Fetching full year of data for ${code}`);
  }
  
  // Get supported pairs from Kraken
  const supportedPairs = await getSupportedPairs();
  
  // Generate potential pairs and filter by what's actually supported
  const potentialPairs = generatePotentialPairs(code);
  const validPairs = potentialPairs.filter(pair => supportedPairs.has(pair));
  
  if (import.meta.env.DEV && validPairs.length > 0) {
    console.debug(`Kraken: Using pair ${validPairs[0]} for ${code}`);
  }
  
  // If no valid pairs found, skip this asset
  if (validPairs.length === 0) {
    if (import.meta.env.DEV) {
      console.warn(`No supported Kraken pairs found for asset: ${code}`);
    }
    return;
  }

  for (const pair of validPairs) {
    try {
      const url = `${baseUrl}?pair=${encodeURIComponent(pair)}&interval=1440&since=${since}`;
      const resp = await runLimited(() => fetch(url, { mode: 'cors' as RequestMode }));
      
      if (!resp.ok) {
        if (import.meta.env.DEV) {
          console.warn(`Kraken API ${resp.status} for ${pair}`);
        }
        continue;
      }
      
      const json: any = await resp.json();
      if (!json?.result || typeof json.result !== 'object') {
        continue;
      }
      
      const keys = Object.keys(json.result).filter(k => k !== 'last');
      if (keys.length === 0) continue;
      const arr: any[] = json.result[keys[0]];
      if (!Array.isArray(arr)) continue;
      
      const cache = loadCacheFor(code);
      let dataPoints = 0;
      for (const row of arr) {
        // row: [time, open, high, low, close, vwap, volume, count]
        const ts = row[0];
        const close = Number(row[4]);
        if (!Number.isFinite(close)) continue;
        const key = toDateKey(new Date(ts * 1000));
        cache[key] = close;
        dataPoints++;
      }
      saveCacheFor(code, cache);
      setLastFetchTime(code, Date.now());
      
      if (import.meta.env.DEV) {
        console.debug(`Kraken: Cached ${dataPoints} data points for ${code}`);
      }
      
      return;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(`Kraken fetch error for ${pair}:`, error);
      }
    }
  }
};


// Ensure we have fresh data for an asset (24h TTL or missing today's data)
const ensureFreshAssetData = async (asset: string): Promise<void> => {
  const code = (asset || 'XLM').toUpperCase();
  const key = `ensure_${code}`;
  
  // Deduplicate concurrent requests
  if (inflightKrakenRequests.has(key)) {
    await inflightKrakenRequests.get(key);
    return;
  }
  
  const promise = (async () => {
    try {
      const lastFetch = getLastFetchTime(code);
      const now = Date.now();
      const cache = loadCacheFor(code);
      const today = todayKeyUTC();
      
      // If we have fresh data (within 24h) AND today's data exists, skip
      if (lastFetch && (now - lastFetch < CACHE_TTL_MS) && cache[today]) {
        return;
      }
      
      if (import.meta.env.DEV) {
        if (!lastFetch || (now - lastFetch >= CACHE_TTL_MS)) {
          console.debug(`Kraken: Cache expired for ${code}, refreshing...`);
        } else {
          console.debug(`Kraken: Today's data missing for ${code}, refreshing...`);
        }
      }
      
      // Fetch full year of data
      await fetchFullYearForAsset(code);
    } finally {
      inflightKrakenRequests.delete(key);
    }
  })();
  
  inflightKrakenRequests.set(key, promise);
  await promise;
};

export const primeUsdRatesForAsset = async (asset: string, _start?: Date, _end?: Date): Promise<void> => {
  await ensureFreshAssetData(asset);
};

export const getUsdRateForDateByAsset = async (asset: string, date: Date, cacheOnly: boolean = false): Promise<number> => {
  const code = (asset || 'XLM').toUpperCase();
  const key = toDateKey(date);
  
  // Check cache first
  const cache = loadCacheFor(code);
  if (cache[key]) {
    return cache[key];
  }
  
  // If cacheOnly mode, return 0 immediately on cache miss
  if (cacheOnly) {
    return 0;
  }
  
  // Ensure we have fresh data
  await ensureFreshAssetData(code);
  
  // Check cache again after fetch
  const updated = loadCacheFor(code);
  if (updated[key]) {
    return updated[key];
  }
  
  // If today's data is still missing, force a second fetch
  if (key === todayKeyUTC()) {
    if (import.meta.env.DEV) {
      console.debug(`Kraken: Today's data still missing for ${code}, forcing refresh...`);
    }
    
    // Force a fresh fetch by clearing the TTL
    setLastFetchTime(code, 0);
    await ensureFreshAssetData(code);
    
    const refetched = loadCacheFor(code);
    if (refetched[key]) {
      return refetched[key];
    }
  }
  
  // No data available
  return 0;
};

// XLM helpers removed - use getUsdRateForDateByAsset('XLM', ...) directly

// Fiat pair helpers
const getFiatCacheKeys = (fromCurrency: string, toCurrency: string) => {
  const pair = `${fromCurrency}${toCurrency}`.toUpperCase();
  return {
    cacheKey: `kraken_fx_${pair}_ohlc_daily_v1`,
    lastFetchKey: `kraken_fx_${pair}_last_fetch_v1`
  };
};

const loadFiatCache = (fromCurrency: string, toCurrency: string): DailyMap => {
  try {
    const { cacheKey } = getFiatCacheKeys(fromCurrency, toCurrency);
    const raw = localStorage.getItem(cacheKey);
    return raw ? (JSON.parse(raw) as DailyMap) : {};
  } catch {
    return {};
  }
};

const saveFiatCache = (fromCurrency: string, toCurrency: string, map: DailyMap) => {
  try {
    const { cacheKey } = getFiatCacheKeys(fromCurrency, toCurrency);
    localStorage.setItem(cacheKey, JSON.stringify(map));
  } catch {
    // ignore
  }
};

const getFiatLastFetchTime = (fromCurrency: string, toCurrency: string): number => {
  try {
    const { lastFetchKey } = getFiatCacheKeys(fromCurrency, toCurrency);
    const raw = localStorage.getItem(lastFetchKey);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
};

const setFiatLastFetchTime = (fromCurrency: string, toCurrency: string, timestamp: number) => {
  try {
    const { lastFetchKey } = getFiatCacheKeys(fromCurrency, toCurrency);
    localStorage.setItem(lastFetchKey, String(timestamp));
  } catch {
    // ignore
  }
};

// Generate potential fiat pair names
const generateFiatPairs = (fromCurrency: string, toCurrency: string): string[] => {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  return [
    `${from}${to}`,
    `Z${from}Z${to}`,
    `${from}Z${to}`,
    `Z${from}${to}`
  ];
};

// Fetch full year of OHLC data for a fiat pair
const fetchFullYearForFiatPair = async (fromCurrency: string, toCurrency: string): Promise<void> => {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const since = Math.floor(oneYearAgo.getTime() / 1000);
  
  const baseUrl = 'https://api.kraken.com/0/public/OHLC';
  
  if (import.meta.env.DEV) {
    console.debug(`Kraken: Fetching full year of FX data for ${fromCurrency}/${toCurrency}`);
  }
  
  const supportedPairs = await getSupportedPairs();
  const potentialPairs = generateFiatPairs(fromCurrency, toCurrency);
  const validPairs = potentialPairs.filter(pair => supportedPairs.has(pair));
  
  if (import.meta.env.DEV && validPairs.length > 0) {
    console.debug(`Kraken: Using FX pair ${validPairs[0]} for ${fromCurrency}/${toCurrency}`);
  }
  
  if (validPairs.length === 0) {
    if (import.meta.env.DEV) {
      console.warn(`No supported Kraken FX pairs found for: ${fromCurrency}/${toCurrency}`);
    }
    return;
  }

  for (const pair of validPairs) {
    try {
      const url = `${baseUrl}?pair=${encodeURIComponent(pair)}&interval=1440&since=${since}`;
      const resp = await runLimited(() => fetch(url, { mode: 'cors' as RequestMode }));
      
      if (!resp.ok) {
        if (import.meta.env.DEV) {
          console.warn(`Kraken API ${resp.status} for FX pair ${pair}`);
        }
        continue;
      }
      
      const json: any = await resp.json();
      if (!json?.result || typeof json.result !== 'object') {
        continue;
      }
      
      const keys = Object.keys(json.result).filter(k => k !== 'last');
      if (keys.length === 0) continue;
      const arr: any[] = json.result[keys[0]];
      if (!Array.isArray(arr)) continue;
      
      const cache = loadFiatCache(fromCurrency, toCurrency);
      let dataPoints = 0;
      for (const row of arr) {
        const ts = row[0];
        const close = Number(row[4]);
        if (!Number.isFinite(close)) continue;
        const key = toDateKey(new Date(ts * 1000));
        cache[key] = close;
        dataPoints++;
      }
      saveFiatCache(fromCurrency, toCurrency, cache);
      setFiatLastFetchTime(fromCurrency, toCurrency, Date.now());
      
      if (import.meta.env.DEV) {
        console.debug(`Kraken: Cached ${dataPoints} FX data points for ${fromCurrency}/${toCurrency}`);
      }
      
      return;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(`Kraken FX fetch error for ${pair}:`, error);
      }
    }
  }
};

// Ensure we have fresh FX data (24h TTL or missing today's data)
const ensureFreshFxData = async (fromCurrency: string, toCurrency: string): Promise<void> => {
  const key = `ensure_fx_${fromCurrency}_${toCurrency}`;
  
  // Deduplicate concurrent requests
  if (inflightKrakenRequests.has(key)) {
    await inflightKrakenRequests.get(key);
    return;
  }
  
  const promise = (async () => {
    try {
      const lastFetch = getFiatLastFetchTime(fromCurrency, toCurrency);
      const now = Date.now();
      const cache = loadFiatCache(fromCurrency, toCurrency);
      const today = todayKeyUTC();
      
      // If we have fresh data (within 24h) AND today's data exists, skip
      if (lastFetch && (now - lastFetch < CACHE_TTL_MS) && cache[today]) {
        return;
      }
      
      if (import.meta.env.DEV) {
        if (!lastFetch || (now - lastFetch >= CACHE_TTL_MS)) {
          console.debug(`Kraken: FX cache expired for ${fromCurrency}/${toCurrency}, refreshing...`);
        } else {
          console.debug(`Kraken: Today's FX data missing for ${fromCurrency}/${toCurrency}, refreshing...`);
        }
      }
      
      // Fetch full year of data
      await fetchFullYearForFiatPair(fromCurrency, toCurrency);
    } finally {
      inflightKrakenRequests.delete(key);
    }
  })();
  
  inflightKrakenRequests.set(key, promise);
  await promise;
};

export const primeHistoricalFxRates = async (fromCurrency: string, toCurrency: string, _start?: Date, _end?: Date): Promise<void> => {
  await ensureFreshFxData(fromCurrency, toCurrency);
};

// Get historical FX rate for a specific date
export const getHistoricalFxRate = async (fromCurrency: string, toCurrency: string, date: Date, cacheOnly: boolean = false): Promise<number> => {
  const key = toDateKey(date);
  
  // Check cache first
  const cache = loadFiatCache(fromCurrency, toCurrency);
  if (cache[key]) {
    return cache[key];
  }
  
  // If cacheOnly mode, return 0 immediately on cache miss
  if (cacheOnly) {
    return 0;
  }
  
  // Ensure we have fresh data
  await ensureFreshFxData(fromCurrency, toCurrency);
  
  // Check cache again after fetch
  const updated = loadFiatCache(fromCurrency, toCurrency);
  if (updated[key]) {
    return updated[key];
  }
  
  // If today's data is still missing, force a second fetch
  if (key === todayKeyUTC()) {
    if (import.meta.env.DEV) {
      console.debug(`Kraken: Today's FX data still missing for ${fromCurrency}/${toCurrency}, forcing refresh...`);
    }
    
    // Force a fresh fetch by clearing the TTL
    setFiatLastFetchTime(fromCurrency, toCurrency, 0);
    await ensureFreshFxData(fromCurrency, toCurrency);
    
    const refetched = loadFiatCache(fromCurrency, toCurrency);
    if (refetched[key]) {
      return refetched[key];
    }
  }
  
  // No data available
  return 0;
};



