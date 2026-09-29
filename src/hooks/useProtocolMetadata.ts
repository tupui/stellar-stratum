import { useEffect, useMemo, useState } from 'react';
import type { AnalyzedCall } from '@/lib/protocols/detect';
import type { NetworkId } from '@/lib/protocols/registry';
import { loadOnchainToken, loadTokenDirectory, loadVaultMeta, resolveToken, type VaultMeta } from '@/lib/protocols/enrich';
import { findKnownVault } from '@/lib/protocols/registry';
import { ASSUMED_DECIMALS, formatTokenAmount, getBuiltinToken, shortenAddress, type TokenMeta } from '@/lib/protocols/tokens';

const EMPTY: ReadonlyMap<string, TokenMeta> = new Map();

export interface ProtocolMetadata {
  /** Token metadata for a contract address, or undefined if still unknown. */
  token: (contract: string) => TokenMeta | undefined;
  /** `"1.8179"` — falls back to 7 decimals when the token is unknown. */
  amount: (raw: string, contract: string) => string;
  /** Display symbol for a token contract. */
  symbol: (contract: string) => string;
  /** True when the amount above had to assume a decimal precision. */
  isAssumed: (contract: string) => boolean;
  vault: (address: string) => VaultMeta | undefined;
  /** True while some referenced token is still only an address. */
  resolving: boolean;
}

/**
 * Puts human names on the contract addresses inside decoded calls.
 *
 * Renders immediately from the built-in table, then fills in from the Stellar
 * Asset Contracts on the Soroswap token list, the other tokens' own contracts
 * (read on the app's RPC) and the DeFindex vault API. Disabled entirely when `enabled` is
 * false, which is how the air-gapped signer stays offline.
 */
export const useProtocolMetadata = (
  calls: AnalyzedCall[],
  network: NetworkId,
  enabled = true,
): ProtocolMetadata => {
  const [directory, setDirectory] = useState<Map<string, TokenMeta> | null>(null);
  // Tokens the list cannot vouch for, as their own contracts describe them.
  const [onchain, setOnchain] = useState<Map<string, TokenMeta>>(new Map());
  const [vaults, setVaults] = useState<Map<string, VaultMeta>>(new Map());

  // Stable keys so the effects don't re-run on every re-render.
  const tokenKey = useMemo(
    () => [...new Set(calls.flatMap((c) => c.tokens))].sort().join(','),
    [calls],
  );
  const vaultKey = useMemo(
    () =>
      [...new Set(
        calls
          .filter((c) => c.intent === 'vault-deposit' || c.intent === 'vault-withdraw')
          .map((c) => c.contractId),
      )].sort().join(','),
    [calls],
  );

  useEffect(() => {
    if (!enabled || !tokenKey) return;

    // Everything already covered by the built-in table? Skip the round-trip.
    const needed = tokenKey.split(',').filter((c) => !getBuiltinToken(c, network));
    if (!needed.length) return;

    let active = true;
    loadTokenDirectory(network).then(async (result) => {
      if (!active) return;
      setDirectory(result);
      // The rest are read from the contracts themselves: the list's decimals are not trusted.
      const unlisted = needed.filter((c) => !result.has(c));
      const read = await Promise.all(unlisted.map(async (c) => [c, await loadOnchainToken(c, network)] as const));
      const found = read.filter((entry): entry is readonly [string, TokenMeta] => entry[1] !== null);
      if (active && found.length) setOnchain(new Map(found));
    });
    return () => {
      active = false;
    };
  }, [enabled, tokenKey, network]);

  useEffect(() => {
    if (!vaultKey) return;
    const addresses = vaultKey.split(',');
    let active = true;

    Promise.all(
      addresses.map(async (address) => {
        const pinned = findKnownVault(address, network);
        if (pinned) {
          return [address, { name: pinned.name, assets: pinned.assets, verified: true }] as const;
        }
        if (!enabled) return null;
        const meta = await loadVaultMeta(address, network);
        return meta ? ([address, meta] as const) : null;
      }),
    ).then((entries) => {
      if (!active) return;
      const resolved = entries.filter((e): e is readonly [string, VaultMeta] => e !== null);
      if (resolved.length) setVaults(new Map(resolved));
    });

    return () => {
      active = false;
    };
  }, [enabled, vaultKey, network]);

  return useMemo(() => {
    const token = (contract: string) => resolveToken(contract, network, directory ?? EMPTY, onchain);
    const referenced = tokenKey ? tokenKey.split(',') : [];
    const awaitingDirectory =
      enabled && directory === null && referenced.some((c) => !getBuiltinToken(c, network));
    // Decimals only count once pinned, derived from a Stellar Asset Contract, or read on chain.
    const confirmed = (contract: string) => {
      const meta = token(contract);
      return meta?.known ? meta : undefined;
    };

    return {
      token: confirmed,
      vault: (address: string) => vaults.get(address),
      symbol: (contract: string) => confirmed(contract)?.code ?? shortenAddress(contract, 4, 4),
      isAssumed: (contract: string) => !confirmed(contract),
      amount: (raw: string, contract: string) =>
        formatTokenAmount(raw, confirmed(contract)?.decimals ?? ASSUMED_DECIMALS),
      resolving: awaitingDirectory,
    };
  }, [directory, onchain, vaults, network, tokenKey, enabled]);
};
