// Kraken OHLC daily helper for XLM/USD (no API key, public REST)
// Docs: https://docs.kraken.com/api/docs/rest-api/get-ohlc-data

type DailyMap = Record<string, number>; // yyyy-mm-dd -> USD close

const CACHE_KEY = 'kraken_xlm_usd_ohlc_daily_v1';
const LAST_FETCH_TS_KEY = 'kraken_xlm_usd_last_fetch_ts';
const TTL_MS = 6 * 60 * 60 * 1000; // 6h cache for a full sweep

let inFlight: Promise<void> | null = null;

const toDateKey = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const loadCache = (): DailyMap => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as DailyMap) : {};
  } catch {
    return {};
  }
};

const saveCache = (map: DailyMap) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {}
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

// Fetch daily candles between start..now (Kraken supports `since` and returns recent candles). Interval=1440 (1D)
const fetchDaily = async (start: Date): Promise<void> => {
  const since = Math.floor(start.getTime() / 1000);
  const baseUrl = 'https://api.kraken.com/0/public/OHLC';
  const pairs = ['XLMUSD', 'XXLMZUSD']; // try both, first succeeds on most setups

  for (const pair of pairs) {
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
      const cache = loadCache();
      for (const row of arr) {
        // row: [time, open, high, low, close, vwap, volume, count]
        const ts = row[0];
        const close = Number(row[4]);
        if (!Number.isFinite(close)) continue;
        const key = toDateKey(new Date(ts * 1000));
        cache[key] = close;
      }
      saveCache(cache);
      try { localStorage.setItem(LAST_FETCH_TS_KEY, String(Date.now())); } catch {}
      return;
    } catch {
      // try next pair
    }
  }
};

export const primeXlmUsdRates = async (start: Date, end: Date): Promise<void> => {
  // Avoid re-fetching if recently populated
  try {
    const lastTs = Number(localStorage.getItem(LAST_FETCH_TS_KEY) || '0');
    if (lastTs && (Date.now() - lastTs) < TTL_MS) return;
  } catch {}
  if (inFlight) { await inFlight; return; }
  inFlight = (async () => {
    const s = new Date(start.getTime() - 2 * 24 * 3600 * 1000);
    await fetchDaily(s);
    inFlight = null;
  })();
  await inFlight;
};

export const getXlmUsdRateForDate = async (date: Date): Promise<number> => {
  const key = toDateKey(date);
  const cache = loadCache();
  if (cache[key]) return cache[key];
  await primeXlmUsdRates(new Date(date.getTime() - 365 * 24 * 3600 * 1000), new Date());
  const updated = loadCache();
  return updated[key] || 0;
};


