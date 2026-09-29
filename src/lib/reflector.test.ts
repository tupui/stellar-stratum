import { describe, expect, it, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { appConfig } from './appConfig';

// Oracle prices have 14 decimals: XLM at $0.20, USDC at $1.
const requested: string[] = [];
vi.mock('./reflector-client', () => ({
  OracleClient: class {
    async getAssets() {
      return ['XLM', 'USDC'];
    }
    async getLastPrice(asset: string) {
      requested.push(asset);
      return asset === 'XLM' ? 20_000_000_000_000n : asset === 'USDC' ? 100_000_000_000_000n : null;
    }
  },
}));

const { getAssetPrice } = await import('./reflector');

describe('getAssetPrice on testnet', () => {
  it('values XLM and Circle testnet USDC at their mainnet price', async () => {
    expect(await getAssetPrice('XLM', undefined, 'testnet')).toBeCloseTo(0.2);
    expect(await getAssetPrice('USDC', appConfig.USDC_ISSUER_TESTNET, 'testnet')).toBeCloseTo(1);
  });

  it('gives other testnet assets no price, whatever their code', async () => {
    requested.length = 0;
    const issuer = Keypair.random().publicKey();
    expect(await getAssetPrice('USDC', issuer, 'testnet')).toBe(0);
    expect(await getAssetPrice('FOO', issuer, 'testnet')).toBe(0);
    expect(requested).toEqual([]);
  });
});
