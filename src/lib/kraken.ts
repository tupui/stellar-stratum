// Kraken OHLC daily helper for multi-asset USD rates and fiat pairs.
// Public REST API, no key required. Docs: https://docs.kraken.com/api/docs/rest-api/get-ohlc-data
//
// One year of daily closes is cached per asset (or per fiat pair) in
// localStorage under a versioned key. `ensureFresh*` re-fetches only when the
// cache is older than 24 h or when today's close is missing.

import { safeStorage } from './storage';

type DailyMap = Record<string, number>; // yyyy-mm-dd (UTC) -> close price

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const KRAKEN_OHLC_URL = 'https://api.kraken.com/0/public/OHLC';
const KRAKEN_PAIRS_URL = 'https://api.kraken.com/0/public/AssetPairs';

const toDateKey = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const todayKeyUTC = (): string => toDateKey(new Date());

// Rate limiter (~20 requests / minute) shared across the module.
const WINDOW_MS = 60_000;
const LIMIT = 20;
let stamps: number[] = [];
let chain: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const acquire = async () => {
  const now = Date.now();
  stamps = stamps.filter((t) => now - t < WINDOW_MS);
  if (stamps.length < LIMIT) {
    stamps.push(now);
    return;
  }
  const wait = Math.max(0, WINDOW_MS - (now - stamps[0]));
  if (wait > 0) await sleep(wait);
  stamps = stamps.filter((t) => Date.now() - t < WINDOW_MS);
  stamps.push(Date.now());
};
const runLimited = <T>(fn: () => Promise<T>): Promise<T> => {
  const task = chain.then(async () => {
    await acquire();
    return fn();
  });
  chain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
};

const inflight = new Map<string, Promise<void>>();

// --- Supported pairs (from Kraken /AssetPairs) -------------------------------

const SUPPORTED_PAIRS_KEY = 'kraken_supported_pairs_v1';
const SUPPORTED_PAIRS_TS_KEY = 'kraken_supported_pairs_timestamp_v1';
let supportedPairsCache: Set<string> | null = null;

const getSupportedPairs = async (): Promise<Set<string>> => {
  if (supportedPairsCache) return supportedPairsCache;

  const cachedList = safeStorage.getJSON<string[] | null>(SUPPORTED_PAIRS_KEY, null);
  const cachedTs = Number(safeStorage.get(SUPPORTED_PAIRS_TS_KEY) ?? 0);
  if (cachedList && Date.now() - cachedTs < CACHE_TTL_MS) {
    supportedPairsCache = new Set(cachedList);
    return supportedPairsCache;
  }

  try {
    const resp = await runLimited(() => fetch(KRAKEN_PAIRS_URL, { mode: 'cors' }));
    if (!resp.ok) throw new Error(`Kraken pairs HTTP ${resp.status}`);
    const json = (await resp.json()) as { result?: Record<string, unknown> };
    if (!json?.result) throw new Error('Invalid AssetPairs response');
    const pairs = new Set(Object.keys(json.result));
    safeStorage.setJSON(SUPPORTED_PAIRS_KEY, [...pairs]);
    safeStorage.set(SUPPORTED_PAIRS_TS_KEY, String(Date.now()));
    supportedPairsCache = pairs;
    return pairs;
  } catch {
    // Fall back to whatever we had cached; empty set if that failed too.
    supportedPairsCache = new Set(cachedList ?? []);
    return supportedPairsCache;
  }
};

// --- Generic cache-per-pair fetcher ------------------------------------------

interface OhlcSpec {
  /** Ordered list of `{pair, isReverse}` candidates to try against Kraken. */
  candidates: Array<{ pair: string; isReverse: boolean }>;
  cacheKey: string;
  lastFetchKey: string;
  inflightKey: string;
}

const loadDaily = (spec: OhlcSpec): DailyMap => safeStorage.getJSON<DailyMap>(spec.cacheKey, {});
const saveDaily = (spec: OhlcSpec, map: DailyMap): void => safeStorage.setJSON(spec.cacheKey, map);
const getLastFetch = (spec: OhlcSpec): number => Number(safeStorage.get(spec.lastFetchKey) ?? 0);
const setLastFetch = (spec: OhlcSpec, ts: number): void => safeStorage.set(spec.lastFetchKey, String(ts));

const fetchFullYear = async (spec: OhlcSpec): Promise<void> => {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const since = Math.floor(oneYearAgo.getTime() / 1000);

  const supported = await getSupportedPairs();
  const valid = spec.candidates.filter((c) => supported.has(c.pair));
  if (valid.length === 0) return;

  for (const { pair, isReverse } of valid) {
    try {
      const url = `${KRAKEN_OHLC_URL}?pair=${encodeURIComponent(pair)}&interval=1440&since=${since}`;
      const resp = await runLimited(() => fetch(url, { mode: 'cors' }));
      if (!resp.ok) continue;

      const json = (await resp.json()) as { result?: Record<string, unknown> };
      if (!json?.result || typeof json.result !== 'object') continue;

      const keys = Object.keys(json.result).filter((k) => k !== 'last');
      if (keys.length === 0) continue;
      const rows = json.result[keys[0]];
      if (!Array.isArray(rows)) continue;

      const cache = loadDaily(spec);
      for (const row of rows as unknown[][]) {
        // row = [time, open, high, low, close, vwap, volume, count]
        const ts = Number(row[0]);
        let close = Number(row[4]);
        if (!Number.isFinite(close) || close === 0) continue;
        if (isReverse) close = 1 / close;
        cache[toDateKey(new Date(ts * 1000))] = close;
      }
      saveDaily(spec, cache);
      setLastFetch(spec, Date.now());
      return;
    } catch {
      // try next pair
    }
  }
};

const ensureFresh = async (spec: OhlcSpec): Promise<void> => {
  const existing = inflight.get(spec.inflightKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const last = getLastFetch(spec);
      const today = todayKeyUTC();
      const cache = loadDaily(spec);
      if (last && Date.now() - last < CACHE_TTL_MS && cache[today]) return;
      await fetchFullYear(spec);
    } finally {
      inflight.delete(spec.inflightKey);
    }
  })();

  inflight.set(spec.inflightKey, promise);
  return promise;
};

const getRateForDate = async (spec: OhlcSpec, date: Date, cacheOnly: boolean): Promise<number> => {
  const key = toDateKey(date);
  const cache = loadDaily(spec);
  if (cache[key]) return cache[key];
  if (cacheOnly) return 0;

  await ensureFresh(spec);
  const updated = loadDaily(spec);
  if (updated[key]) return updated[key];

  // If today is still missing, force one more round-trip.
  if (key === todayKeyUTC()) {
    setLastFetch(spec, 0);
    await ensureFresh(spec);
    const refetched = loadDaily(spec);
    if (refetched[key]) return refetched[key];
  }
  return 0;
};

// --- Asset (crypto → USD) specialisation -------------------------------------

const assetSpec = (asset: string): OhlcSpec => {
  const code = (asset || 'XLM').toUpperCase();
  return {
    candidates: [`${code}USD`, `${code}ZUSD`, `X${code}ZUSD`, `${code}XUSD`, `XX${code}ZUSD`].map((pair) => ({
      pair,
      isReverse: false,
    })),
    cacheKey: `kraken_${code}_usd_ohlc_daily_v1`,
    lastFetchKey: `kraken_${code}_last_fetch_v1`,
    inflightKey: `ensure_${code}`,
  };
};

export const primeUsdRatesForAsset = (asset: string): Promise<void> => ensureFresh(assetSpec(asset));
export const getUsdRateForDateByAsset = (asset: string, date: Date, cacheOnly = false): Promise<number> =>
  getRateForDate(assetSpec(asset), date, cacheOnly);

// --- Fiat pair specialisation ------------------------------------------------

const FIAT_CACHE_VERSION = 'v2';

const fiatSpec = (fromCurrency: string, toCurrency: string): OhlcSpec => {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  const pair = `${from}${to}`;
  return {
    candidates: [
      { pair: `${from}${to}`, isReverse: false },
      { pair: `Z${from}Z${to}`, isReverse: false },
      { pair: `${from}Z${to}`, isReverse: false },
      { pair: `Z${from}${to}`, isReverse: false },
      // Kraken publishes EURUSD/GBPUSD etc. as target→USD; invert when needed.
      { pair: `${to}${from}`, isReverse: true },
      { pair: `Z${to}Z${from}`, isReverse: true },
      { pair: `${to}Z${from}`, isReverse: true },
      { pair: `Z${to}${from}`, isReverse: true },
    ],
    cacheKey: `kraken_fx_${pair}_ohlc_daily_${FIAT_CACHE_VERSION}`,
    lastFetchKey: `kraken_fx_${pair}_last_fetch_${FIAT_CACHE_VERSION}`,
    inflightKey: `ensure_fx_${from}_${to}`,
  };
};

export const primeHistoricalFxRates = (fromCurrency: string, toCurrency: string): Promise<void> =>
  ensureFresh(fiatSpec(fromCurrency, toCurrency));

export const getHistoricalFxRate = (
  fromCurrency: string,
  toCurrency: string,
  date: Date,
  cacheOnly = false,
): Promise<number> => getRateForDate(fiatSpec(fromCurrency, toCurrency), date, cacheOnly);
