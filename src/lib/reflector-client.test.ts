import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = { assets: 0, lastPrice: 0 };
vi.mock('@reflector/contract-client', () => ({
  PulseClient: class {
    async assets() {
      calls.assets += 1;
      return [{ tag: 'Other', values: ['XLM'] }, { tag: 'Stellar', values: ['CAWH4XMRQL7AJZCXEJVRHHMT6Y7ZPFCQCSKLIFJL3AVIQNC5TSVWKQOR'] }];
    }
    async lastPrice(asset: string) {
      calls.lastPrice += 1;
      return asset === 'XLM' ? { price: 21_000_000_000_000n, timestamp: 1n } : undefined;
    }
  },
}));

const { OracleClient } = await import('./reflector-client');

describe('OracleClient', () => {
  beforeEach(() => {
    OracleClient.clearCache();
    calls.assets = 0;
    calls.lastPrice = 0;
  });

  it('returns symbols and contract ids, and caches them', async () => {
    const client = new OracleClient('CONTRACT');
    expect(await client.getAssets()).toEqual(['XLM', 'CAWH4XMRQL7AJZCXEJVRHHMT6Y7ZPFCQCSKLIFJL3AVIQNC5TSVWKQOR']);
    await client.getAssets();
    expect(calls.assets).toBe(1);
  });

  it('shares concurrent price requests and reports missing prices as null', async () => {
    const client = new OracleClient('CONTRACT');
    const [a, b] = await Promise.all([client.getLastPrice('XLM'), client.getLastPrice('XLM')]);
    expect(a).toBe(21_000_000_000_000n);
    expect(b).toBe(a);
    expect(calls.lastPrice).toBe(1);
    expect(await client.getLastPrice('EUR')).toBeNull();
  });
});
