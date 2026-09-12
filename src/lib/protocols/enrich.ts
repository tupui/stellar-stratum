import { SupportedAssetLists } from '@soroswap/sdk';
import { SupportedNetworks } from '@defindex/sdk';
import { soroswapSDK } from '@/lib/soroswap-client';
import { defindexSDK } from '@/lib/defindex-client';
import { safeStorage } from '@/lib/storage';
import { getBuiltinToken, type TokenMeta } from './tokens';
import { findKnownVault, type NetworkId } from './registry';

/**
 * Online lookups that put names on the addresses in a Soroban invocation.
 * Everything here is best-effort: the summary renders without it, and the
 * air-gapped signer never calls any of it.
 */

const TOKEN_CACHE_KEY = 'stratum_protocol_tokens_v1';
const TOKEN_TTL = 24 * 60 * 60 * 1000;

interface CachedTokens {
  at: number;
  tokens: Record<string, { code: string; decimals: number; icon?: string; issuer?: string }>;
}

const tokenRequests = new Map<NetworkId, Promise<Map<string, TokenMeta>>>();

const readTokenCache = (network: NetworkId): Map<string, TokenMeta> | null => {
  const cached = safeStorage.getJSON<CachedTokens | null>(`${TOKEN_CACHE_KEY}_${network}`, null);
  if (!cached || Date.now() - cached.at > TOKEN_TTL) return null;
  return new Map(Object.entries(cached.tokens).map(([contract, meta]) => [contract, { ...meta, known: true }]));
};

/**
 * Contract address → token metadata, from the Soroswap token list.
 * Cached in memory and in localStorage for a day.
 */
export const loadTokenDirectory = (network: NetworkId): Promise<Map<string, TokenMeta>> => {
  const inflight = tokenRequests.get(network);
  if (inflight) return inflight;

  const request = (async () => {
    const cached = readTokenCache(network);
    if (cached) return cached;

    const list = await soroswapSDK.getAssetList(SupportedAssetLists.SOROSWAP);
    const assets = 'assets' in list ? list.assets : [];

    const tokens = new Map<string, TokenMeta>();
    const serializable: CachedTokens['tokens'] = {};

    for (const asset of assets) {
      if (!asset.contract || !asset.code) continue;
      const meta = {
        code: asset.code,
        decimals: asset.decimals ?? 7,
        icon: asset.icon,
        issuer: asset.issuer,
      };
      tokens.set(asset.contract, { ...meta, known: true });
      serializable[asset.contract] = meta;
    }

    safeStorage.setJSON(`${TOKEN_CACHE_KEY}_${network}`, { at: Date.now(), tokens: serializable });
    return tokens;
  })().catch(() => new Map<string, TokenMeta>());

  tokenRequests.set(network, request);
  return request;
};

export interface VaultMeta {
  name: string;
  symbol?: string;
  /** Underlying asset contracts, in the order the vault's amount vectors use. */
  assets: string[];
  /** True when the DeFindex API confirmed this address is a real vault. */
  verified: boolean;
}

const vaultRequests = new Map<string, Promise<VaultMeta | null>>();

/**
 * Ask DeFindex whether an address is one of its vaults, and what it holds.
 * A non-vault contract makes the API error, which is exactly the signal we want.
 */
export const loadVaultMeta = (address: string, network: NetworkId): Promise<VaultMeta | null> => {
  const key = `${network}:${address}`;
  const inflight = vaultRequests.get(key);
  if (inflight) return inflight;

  const request = (async (): Promise<VaultMeta | null> => {
    const pinned = findKnownVault(address, network);
    if (pinned) return { name: pinned.name, assets: pinned.assets, verified: true };
    if (network !== 'mainnet') return null;

    const info = await defindexSDK.getVaultInfo(address, SupportedNetworks.MAINNET);
    return {
      name: info.name,
      symbol: info.symbol,
      assets: (info.assets ?? []).map((a) => a.address).filter(Boolean),
      verified: true,
    };
  })().catch(() => null);

  vaultRequests.set(key, request);
  return request;
};

/**
 * Best available metadata for a token contract, without waiting on the network.
 *
 * Pinned values win on the numbers that change how an amount reads — a wrong
 * decimals would misstate the amount by orders of magnitude — while the fetched
 * list contributes the logo it has and covers every token we don't ship.
 */
export const resolveToken = (
  contract: string,
  network: NetworkId,
  directory: ReadonlyMap<string, TokenMeta>,
): TokenMeta | undefined => {
  const builtin = getBuiltinToken(contract, network);
  const listed = directory.get(contract);
  if (!builtin) return listed;
  return { ...builtin, icon: listed?.icon };
};
