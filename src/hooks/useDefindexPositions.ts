import { useState, useEffect, useCallback } from 'react';
import { defindexSDK } from '@/lib/defindex-client';
import { SupportedNetworks } from '@defindex/sdk';
import { appConfig } from '@/lib/appConfig';

export interface DefindexPosition {
  vaultAddress: string;
  vaultName: string;
  assetCode: string;
  assetIssuer: string;
  /** Underlying asset amount deposited, as a decimal string (e.g. "12.5000000") */
  balance: string;
  dfTokens: number;
  apy?: number;
}

/**
 * Fetches the account's DeFindex vault positions (mainnet only).
 * Returns the deposited underlying balances so they can be shown alongside
 * regular wallet assets and counted in the total portfolio value.
 */
export const useDefindexPositions = (
  accountPublicKey: string | undefined,
  network: 'mainnet' | 'testnet'
) => {
  const [positions, setPositions] = useState<DefindexPosition[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!accountPublicKey || network !== 'mainnet') {
      setPositions([]);
      return;
    }
    setLoading(true);
    try {
      const balance = await defindexSDK.getVaultBalance(
        appConfig.DEFINDEX_VAULT_ADDRESS,
        accountPublicKey,
        SupportedNetworks.MAINNET
      );
      // Vault info is optional (name/APY enrichment) — don't fail the position on it
      const info = await defindexSDK
        .getVaultInfo(appConfig.DEFINDEX_VAULT_ADDRESS, SupportedNetworks.MAINNET)
        .catch(() => null);

      const underlying = (balance.underlyingBalance?.[0] ?? 0) / 10_000_000;
      setPositions(
        underlying > 0
          ? [{
              vaultAddress: appConfig.DEFINDEX_VAULT_ADDRESS,
              vaultName: info?.name || appConfig.DEFINDEX_VAULT_NAME,
              assetCode: 'USDC',
              assetIssuer: appConfig.USDC_ISSUER_MAINNET,
              balance: underlying.toFixed(7),
              dfTokens: balance.dfTokens,
              apy: info?.apy,
            }]
          : []
      );
    } catch {
      // Keep previous positions on transient errors; they refresh on next fetch
    } finally {
      setLoading(false);
    }
  }, [accountPublicKey, network]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { positions, loading, refetch };
};
