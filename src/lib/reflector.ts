// Price fetching via Reflector Oracles.
//
// Responsibilities of this file:
//   - map an asset (code/issuer) to the oracle entry that prices that exact asset
//   - apply decimals scaling and convert USDC quotes to USD
//   - maintain a small localStorage-backed stale-price fallback so the UI can
//     still render a number when the oracle is temporarily unreachable
//
// Reflector oracles only exist on mainnet, so these are mainnet prices: do not
// use them to value testnet balances.
//
// TTL + inflight deduplication for individual oracle calls lives inside
// OracleClient (a wrapper around Reflector's client). Do not add another retry/cache layer here.

import { OracleClient, type OracleAsset, type OracleConfig } from './reflector-client';
import { Asset as StellarAsset, Networks } from '@stellar/stellar-sdk';
import { appConfig } from './appConfig';
import { safeStorage } from './storage';

const REFLECTOR_ORACLES = {
  // Prices symbols (BTC, XLM, USDC, EURC, ...) in USD.
  CEX_DEX: {
    contract: 'CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN',
    base: 'USD',
    decimals: 14,
  },
  // Prices Stellar assets by contract id, in Circle USDC.
  STELLAR: {
    contract: 'CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M',
    base: 'USDC',
    decimals: 14,
  },
} as const satisfies Record<string, OracleConfig>;

// A symbol price says nothing about the issuer, so it is only used for native XLM
// and these exact classic assets. Any other credit asset is priced through its
// SAC contract id in the STELLAR oracle; a look-alike code from another issuer
// then gets no price instead of the real asset's.
const SYMBOL_PRICED_ASSETS: Record<string, string> = {
  [`USDC:${appConfig.USDC_ISSUER_MAINNET}`]: 'USDC',
  'EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2': 'EURC',
};

// Stale-price fallback shown only when the oracle itself fails. OracleClient
// handles the "fresh" TTL for live calls internally (60 s for prices, 24 h for
// asset lists).
const STALE_PRICE_FALLBACK_MS = 24 * 60 * 60 * 1000;
// v2: entries under the old key were priced by asset code alone, drop them.
const CACHE_KEY = 'stellar_asset_prices_v2';
safeStorage.remove('stellar_asset_prices');
const FETCH_TIMESTAMP_KEY = 'stellar_price_fetch_timestamp';

// Per-asset request deduplication across concurrent callers.
const inflightPriceRequests = new Map<string, Promise<number>>();

// Client cache — one instance per contract.
const oracleClients = new Map<string, OracleClient>();
const getOracleClient = (contractId: string): OracleClient => {
  let client = oracleClients.get(contractId);
  if (!client) {
    client = new OracleClient(contractId);
    oracleClients.set(contractId, client);
  }
  return client;
};

// The oracles run on mainnet, so the SAC id is always derived for the public network.
const mainnetContractId = (assetCode: string, assetIssuer: string): string | null => {
  try {
    return new StellarAsset(assetCode, assetIssuer).contractId(Networks.PUBLIC);
  } catch {
    return null;
  }
};

const findPriceSource = async (
  assetCode: string,
  assetIssuer?: string,
): Promise<{ oracle: OracleConfig; asset: OracleAsset } | null> => {
  const symbol = assetIssuer ? SYMBOL_PRICED_ASSETS[`${assetCode}:${assetIssuer}`] : assetCode === 'XLM' ? 'XLM' : undefined;
  if (symbol) return { oracle: REFLECTOR_ORACLES.CEX_DEX, asset: symbol };
  if (!assetIssuer) return null;

  const contractId = mainnetContractId(assetCode, assetIssuer);
  if (!contractId) return null;
  const listed = await getOracleClient(REFLECTOR_ORACLES.STELLAR.contract).getAssets();
  if (!listed.includes(contractId)) return null;
  return { oracle: REFLECTOR_ORACLES.STELLAR, asset: contractId };
};

const readOraclePrice = async (oracle: OracleConfig, asset: OracleAsset): Promise<number> => {
  const rawPrice = await getOracleClient(oracle.contract).getLastPrice(asset);
  return rawPrice && rawPrice > 0n ? Number(rawPrice) / 10 ** oracle.decimals : 0;
};

const fetchReflectorPrice = async (assetCode: string, assetIssuer?: string): Promise<number> => {
  const source = await findPriceSource(assetCode, assetIssuer);
  if (!source) return 0;

  const price = await readOraclePrice(source.oracle, source.asset);
  if (source.oracle.base !== 'USDC' || price === 0) return price;
  const usdcInUsd = await readOraclePrice(REFLECTOR_ORACLES.CEX_DEX, 'USDC');
  return price * usdcInUsd;
};

// --- Stale-price fallback (localStorage) -------------------------------------

interface PriceCacheEntry {
  price: number;
  timestamp: number;
}
type PriceCache = Record<string, PriceCacheEntry>;

const loadPriceCache = (): PriceCache => safeStorage.getJSON<PriceCache>(CACHE_KEY, {});
const savePriceCache = (cache: PriceCache): void => safeStorage.setJSON(CACHE_KEY, cache);

const getCachedPrice = (assetKey: string): number => {
  const cache = loadPriceCache();
  const cached = cache[assetKey];
  if (!cached) return 0;

  if (Date.now() - cached.timestamp < STALE_PRICE_FALLBACK_MS) {
    return cached.price;
  }

  // Expired — drop it.
  delete cache[assetKey];
  savePriceCache(cache);
  return 0;
};

const setCachedPrice = (assetKey: string, price: number): void => {
  if (price <= 0) return;
  const cache = loadPriceCache();
  cache[assetKey] = { price, timestamp: Date.now() };
  savePriceCache(cache);
  safeStorage.set(FETCH_TIMESTAMP_KEY, Date.now().toString());
};

/** When a live oracle price was last received. */
export const getLastFetchTimestamp = (): Date | null => {
  const raw = safeStorage.get(FETCH_TIMESTAMP_KEY);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? new Date(n) : null;
};

// --- Public API --------------------------------------------------------------

/**
 * USD price of a mainnet asset, or 0 when no oracle prices that exact asset.
 * Native XLM is `assetCode` 'XLM' (or undefined) without an issuer.
 */
export const getAssetPrice = async (assetCode?: string, assetIssuer?: string): Promise<number> => {
  const assetKey = assetIssuer ? `${assetCode}:${assetIssuer}` : (assetCode || 'XLM');

  const existing = inflightPriceRequests.get(assetKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const price = await fetchReflectorPrice(assetCode || 'XLM', assetIssuer);
      if (price > 0) {
        setCachedPrice(assetKey, price);
        return price;
      }
      return getCachedPrice(assetKey);
    } catch {
      return getCachedPrice(assetKey);
    } finally {
      inflightPriceRequests.delete(assetKey);
    }
  })();

  inflightPriceRequests.set(assetKey, promise);
  return promise;
};

// Clear every layer so a manual refresh actually re-hits the oracle.
export const clearPriceCache = async (): Promise<void> => {
  inflightPriceRequests.clear();
  safeStorage.remove(CACHE_KEY);

  // Drop cached asset lists and prices of every oracle client.
  OracleClient.clearCache();
};
