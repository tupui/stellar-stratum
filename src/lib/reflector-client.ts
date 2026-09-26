import { PulseClient, type AssetDescriptor } from '@reflector/contract-client';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import { appConfig } from './appConfig';

export interface OracleConfig {
  contract: string;
  /** Quote asset of the prices, e.g. 'USD' or 'USDC'. */
  base: string;
  decimals: number;
}

/**
 * An oracle asset: a symbol for an external price source (e.g. 'XLM', 'EUR') or the contract
 * id of a Stellar asset. Reflector's client tells them apart the same way.
 */
export type OracleAsset = AssetDescriptor & string;

// Simple leaky bucket + serialised queue: allow up to 50 RPC calls per 10s,
// only pause once the burst limit is hit. Shared by every OracleClient
// instance so a page loading N contracts still respects the same budget.
class RateLimiter {
  private timestamps: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly windowMs: number;
  private readonly burstLimit: number;

  constructor(windowMs: number, burstLimit: number) {
    this.windowMs = windowMs;
    this.burstLimit = burstLimit;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      await this.acquire();
      return fn();
    });
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async acquire(): Promise<void> {
    this.prune();
    if (this.timestamps.length < this.burstLimit) {
      this.timestamps.push(Date.now());
      return;
    }
    const wait = Math.max(0, this.windowMs - (Date.now() - this.timestamps[0]));
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    this.prune();
    this.timestamps.push(Date.now());
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);
  }
}

const rateLimiter = new RateLimiter(10_000, 50);

/**
 * Read-only access to a Reflector Pulse price oracle through Reflector's own client
 * (@reflector/contract-client), with the caching the app needs on top: asset lists are reused
 * for a day, prices for a minute, and concurrent requests for the same value share one call.
 *
 * Reflector's price oracles are mainnet contracts, so calls are simulated on the mainnet RPC.
 */
export class OracleClient {
  private readonly client: PulseClient;
  private readonly contractId: string;

  private static readonly ASSETS_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly PRICE_TTL_MS = 60 * 1000;

  private static inflight = new Map<string, Promise<unknown>>();
  private static cache = new Map<string, { data: unknown; ts: number }>();

  constructor(contractId: string, rpcUrl: string = appConfig.MAINNET_SOROBAN_RPC, networkPassphrase: string = Networks.PUBLIC) {
    this.contractId = contractId;
    this.client = new PulseClient({
      // Reads are only simulated. Without a public key the SDK simulates from a placeholder
      // account instead of loading one first, which saves a round trip per call.
      publicKey: undefined as unknown as string,
      rpcUrl,
      contractId,
      networkPassphrase,
    });
  }

  /** Forget cached asset lists and prices, so the next read hits the oracle. */
  static clearCache(): void {
    OracleClient.cache.clear();
  }

  /** Quoted assets: symbols for external sources, contract ids for Stellar assets. */
  getAssets(): Promise<string[]> {
    return this.memoize(`${this.contractId}:assets`, OracleClient.ASSETS_TTL_MS, async () =>
      (await this.client.assets()).map((asset) => asset.values[0]),
    );
  }

  /** Latest price in the oracle's decimals, or null when the oracle has none. */
  getLastPrice(asset: OracleAsset): Promise<bigint | null> {
    return this.memoize(`${this.contractId}:price:${asset}`, OracleClient.PRICE_TTL_MS, async () => {
      const data = await this.client.lastPrice(asset);
      return data?.price ?? null;
    });
  }

  private async memoize<T>(key: string, ttl: number, fetch: () => Promise<T>): Promise<T> {
    const cached = OracleClient.cache.get(key);
    if (cached && Date.now() - cached.ts < ttl) return cached.data as T;

    const existing = OracleClient.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
      try {
        const data = await rateLimiter.run(fetch);
        OracleClient.cache.set(key, { data, ts: Date.now() });
        return data;
      } finally {
        OracleClient.inflight.delete(key);
      }
    })();
    OracleClient.inflight.set(key, promise);
    return promise;
  }
}

/** True for a Stellar asset's contract id, as opposed to an external price source symbol. */
export const isContractAsset = (asset: string) => StrKey.isValidContract(asset);
