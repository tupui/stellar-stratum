import { SupportedAssetLists } from '@soroswap/sdk';
import { SupportedNetworks } from '@defindex/sdk';
import { soroswapSDK } from '@/lib/soroswap-client';
import { defindexSDK } from '@/lib/defindex-client';
import { safeStorage } from '@/lib/storage';
import { checkListedToken, getBuiltinToken, shortenAddress, type TokenMeta } from './tokens';
import { readTokenDecimals, readTokenSymbol } from './onchain';
import { findKnownVault, type NetworkId } from './registry';

/**
 * Online lookups that put names on the addresses in a Soroban invocation.
 * Everything here is best-effort: the summary renders without it, and the
 * air-gapped signer never calls any of it.
 */

// Older versions kept the whole token list, decimals included, in localStorage for a day:
// a list read while the API was compromised would outlive the compromise. Drop it.
safeStorage.remove('stratum_protocol_tokens_v1_mainnet');
safeStorage.remove('stratum_protocol_tokens_v1_testnet');

const tokenRequests = new Map<NetworkId, Promise<Map<string, TokenMeta>>>();

/**
 * Contract address → token metadata, from the Soroswap token list. Only entries
 * the app can vouch for are kept: Stellar Asset Contracts whose code and issuer
 * derive to the listed address, at 7 decimals. What the list says about any
 * other contract is not used. Kept in memory for the session only.
 */
export const loadTokenDirectory = (network: NetworkId): Promise<Map<string, TokenMeta>> => {
  const inflight = tokenRequests.get(network);
  if (inflight) return inflight;

  const request = (async () => {
    const list = await soroswapSDK.getAssetList(SupportedAssetLists.SOROSWAP);
    const assets = 'assets' in list ? list.assets : [];

    const tokens = new Map<string, TokenMeta>();
    for (const asset of assets) {
      const checked = checkListedToken(asset, network);
      if (!checked?.sac) continue;
      tokens.set(checked.contract, {
        code: checked.code,
        decimals: checked.decimals,
        icon: asset.icon,
        issuer: checked.issuer,
        known: true,
      });
    }
    return tokens;
  })().catch(() => new Map<string, TokenMeta>());

  tokenRequests.set(network, request);
  return request;
};

/**
 * A token's decimals and symbol as its own contract reports them; null when they
 * cannot be read. Anyone can deploy a token whose symbol is "USDC", so the
 * symbol is shown with the address it belongs to.
 */
export const loadOnchainToken = async (contract: string, network: NetworkId): Promise<TokenMeta | null> => {
  try {
    const [decimals, symbol] = await Promise.all([
      readTokenDecimals(contract, network),
      readTokenSymbol(contract, network),
    ]);
    return { code: `${symbol} · ${shortenAddress(contract, 4, 4)}`, decimals, known: true };
  } catch {
    return null;
  }
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
 * decimals would misstate the amount by orders of magnitude. Then come Stellar
 * Asset Contracts from the list, whose code and issuer were checked against the
 * address (with the list's logo), then what the contract itself reported.
 * Anything else is undefined: shown as an address, at an assumed precision.
 */
export const resolveToken = (
  contract: string,
  network: NetworkId,
  directory: ReadonlyMap<string, TokenMeta>,
  onchain: ReadonlyMap<string, TokenMeta> = new Map(),
): TokenMeta | undefined => {
  const builtin = getBuiltinToken(contract, network);
  const listed = directory.get(contract);
  if (builtin) return { ...builtin, icon: listed?.icon };
  return listed ?? onchain.get(contract);
};
