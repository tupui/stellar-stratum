// Kraken OHLC daily helper for multi-asset USD rates (no API key, public REST)
// Docs: https://docs.kraken.com/api/docs/rest-api/get-ohlc-data

type DailyMap = Record<string, number>; // yyyy-mm-dd -> USD close

const TTL_MS = 6 * 60 * 60 * 1000; // 6h cache for a full sweep
const PAIRS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h cache for supported pairs

const toDateKey = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

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
      if (Date.now() - timestamp < PAIRS_CACHE_TTL_MS) {
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
    lastKey: `kraken_${code}_usd_last_fetch_ts`
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

// Generic fetcher per asset - now checks supported pairs first
const fetchDailyForAsset = async (asset: string, start: Date): Promise<void> => {
  const since = Math.floor(start.getTime() / 1000);
  const baseUrl = 'https://api.kraken.com/0/public/OHLC';
  const code = (asset || 'XLM').toUpperCase();
  
  // Get supported pairs from Kraken
  const supportedPairs = await getSupportedPairs();
  
  // Generate potential pairs and filter by what's actually supported
  const potentialPairs = generatePotentialPairs(code);
  const validPairs = potentialPairs.filter(pair => supportedPairs.has(pair));
  
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
      if (!resp.ok) continue;
      const json: any = await resp.json();
      if (!json?.result || typeof json.result !== 'object') continue;
      const keys = Object.keys(json.result).filter(k => k !== 'last');
      if (keys.length === 0) continue;
      const arr: any[] = json.result[keys[0]];
      if (!Array.isArray(arr)) continue;
      const cache = loadCacheFor(code);
      for (const row of arr) {
        // row: [time, open, high, low, close, vwap, volume, count]
        const ts = row[0];
        const close = Number(row[4]);
        if (!Number.isFinite(close)) continue;
        const key = toDateKey(new Date(ts * 1000));
        cache[key] = close;
      }
      saveCacheFor(code, cache);
      try { const { lastKey } = getAssetCacheKeys(code); localStorage.setItem(lastKey, String(Date.now())); } catch {}
      return;
    } catch {
      // try next pair
    }
  }
};


export const primeUsdRatesForAsset = async (asset: string, start: Date, end: Date): Promise<void> => {
  const code = (asset || 'XLM').toUpperCase();
  const { lastKey } = getAssetCacheKeys(code);
  
  try {
    const lastTs = Number(localStorage.getItem(lastKey) || '0');
    if (lastTs && (Date.now() - lastTs) < TTL_MS) return;
  } catch {
    // Ignore localStorage errors (private mode, quota exceeded)
  }
  
  // Request deduplication - if same asset data is being fetched, await the existing request
  if (inflightKrakenRequests.has(code)) {
    await inflightKrakenRequests.get(code);
    return;
  }
  
  const fetchPromise = (async () => {
    const s = new Date(start.getTime() - 2 * 24 * 3600 * 1000);
    await fetchDailyForAsset(code, s);
  })();
  
  inflightKrakenRequests.set(code, fetchPromise);
  
  try {
    await fetchPromise;
  } finally {
    inflightKrakenRequests.delete(code);
  }
};

export const getUsdRateForDateByAsset = async (asset: string, date: Date): Promise<number> => {
  const code = (asset || 'XLM').toUpperCase();
  const key = toDateKey(date);
  const cache = loadCacheFor(code);
  if (cache[key]) return cache[key];
  await primeUsdRatesForAsset(code, new Date(date.getTime() - 365 * 24 * 3600 * 1000), new Date());
  const updated = loadCacheFor(code);
  return updated[key] || 0;
};

// Backwards-compatible XLM wrappers
export const primeXlmUsdRates = async (start: Date, end: Date): Promise<void> => {
  await primeUsdRatesForAsset('XLM', start, end);
};

export const getXlmUsdRateForDate = async (date: Date): Promise<number> => {
  return getUsdRateForDateByAsset('XLM', date);
};



