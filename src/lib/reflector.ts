// Price fetching via Reflector Oracles.
//
// Responsibilities of this file:
//   - map an asset (code/issuer) to the oracle that can price it
//   - apply decimals scaling to raw oracle prices
//   - maintain a small localStorage-backed stale-price fallback so the UI can
//     still render a number when the oracle is temporarily unreachable
//
// TTL + inflight deduplication for individual oracle calls lives inside
// OracleClient. Do not add another retry/cache layer here.

import { OracleClient, type OracleConfig, AssetType, type Asset } from './reflector-client';
import { xdr, Asset as StellarAsset, hash, StrKey, Networks } from '@stellar/stellar-sdk';
import { appConfig } from './appConfig';
import { safeStorage } from './storage';

// Reflector oracles are mainnet-only by design; SAC IDs are always computed
// against the public network passphrase. On testnet, callers simply miss the
// contract-id branch in `findAssetInMapping` and fall back to symbol lookups.
const computeStellarAssetContractId = (assetCode: string, assetIssuer: string): string => {
  try {
    if (!assetIssuer || assetCode === 'XLM') return '';
    const stellarAsset = new StellarAsset(assetCode, assetIssuer);
    const preimage = new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(Networks.PUBLIC)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(stellarAsset.toXDRObject()),
    });
    const envelope = xdr.HashIdPreimage.envelopeTypeContractId(preimage);
    return StrKey.encodeContract(hash(envelope.toXDR()));
  } catch {
    return '';
  }
};

const REFLECTOR_ORACLES = {
  CEX_DEX: {
    contract: 'CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN',
    base: 'USD',
    decimals: 14,
  },
  STELLAR: {
    contract: 'CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M',
    base: 'USDC',
    decimals: 14,
  },
  FX: {
    contract: appConfig.ORACLE_CONTRACT,
    base: 'USD',
    decimals: 14,
  },
} as const satisfies Record<string, OracleConfig>;

const ALL_ORACLES = [REFLECTOR_ORACLES.CEX_DEX, REFLECTOR_ORACLES.STELLAR, REFLECTOR_ORACLES.FX];

// Stale-price fallback shown only when the oracle itself fails. OracleClient
// handles the "fresh" TTL for live calls internally (60 s for prices, 24 h for
// asset lists).
const STALE_PRICE_FALLBACK_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = 'stellar_asset_prices';
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

// Asset → oracle mapping, built once by querying every oracle's asset list.
const assetOracleMapping: Record<string, { oracle: OracleConfig; asset: Asset }> = {};
let mappingPromise: Promise<void> | null = null;

const initializeAssetMapping = (): Promise<void> => {
  if (mappingPromise) return mappingPromise;

  mappingPromise = (async () => {
    try {
      const assetLists = await Promise.all(
        ALL_ORACLES.map((oracle) => getOracleClient(oracle.contract).getAssets().catch(() => [])),
      );
      ALL_ORACLES.forEach((oracle, idx) => {
        for (const assetId of assetLists[idx]) {
          if (assetId.startsWith('stellar_')) {
            const code = assetId.substring(8);
            assetOracleMapping[assetId] = { oracle, asset: { type: AssetType.Stellar, code } };
          } else {
            assetOracleMapping[assetId] = { oracle, asset: { type: AssetType.Other, code: assetId } };
          }
        }
      });
    } catch (error) {
      // Allow a retry on the next call
      mappingPromise = null;
      throw error;
    }
  })();

  return mappingPromise;
};

const findAssetInMapping = (assetCode: string, assetIssuer?: string): { oracle: OracleConfig; asset: Asset } | null => {
  const code = (assetCode || 'XLM').toUpperCase();

  if (assetOracleMapping[code]) return assetOracleMapping[code];

  if (assetIssuer) {
    const stellarKey = `stellar_${assetIssuer}`;
    if (assetOracleMapping[stellarKey]) return assetOracleMapping[stellarKey];

    const contractId = computeStellarAssetContractId(code, assetIssuer);
    if (contractId && assetOracleMapping[contractId]) return assetOracleMapping[contractId];
  }

  return null;
};

const fetchReflectorPrice = async (assetCode: string, assetIssuer?: string): Promise<number> => {
  await initializeAssetMapping();

  const resolved = findAssetInMapping(assetCode, assetIssuer);
  if (!resolved) return 0;

  try {
    const rawPrice = await getOracleClient(resolved.oracle.contract).getLastPrice(resolved.asset);
    return rawPrice > 0 ? rawPrice / Math.pow(10, resolved.oracle.decimals) : 0;
  } catch {
    return 0;
  }
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
  setLastFetchTimestamp();
};

export const setLastFetchTimestamp = (): void => {
  safeStorage.set(FETCH_TIMESTAMP_KEY, Date.now().toString());
};

export const getLastFetchTimestamp = (): Date | null => {
  const raw = safeStorage.get(FETCH_TIMESTAMP_KEY);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? new Date(n) : null;
};

// --- Public API --------------------------------------------------------------

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

  for (const key of Object.keys(assetOracleMapping)) delete assetOracleMapping[key];
  mappingPromise = null;

  // Drop cached data inside every oracle client (asset lists + prices).
  for (const client of oracleClients.values()) client.clearCache();
};
