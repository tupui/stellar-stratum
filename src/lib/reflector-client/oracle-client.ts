import { Contract, rpc, Networks, TransactionBuilder, scValToNative, xdr } from '@stellar/stellar-sdk';
import { buildAssetScVal, type Asset } from './xdr-helper';
import { createOracleRpcServer } from '../rpc-client';

export interface OracleConfig {
  contract: string;
  base: string;
  decimals: number;
}

// A well-known funded mainnet account used only to build simulation
// transactions. Simulation does not validate the account's actual state.
const SIMULATION_ACCOUNT = 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV';

// Simple leaky bucket + serialised queue: allow up to 50 RPC calls per 10s,
// only pause once the burst limit is hit. Shared by every OracleClient
// instance so a page loading N contracts still respects the same budget.
class RateLimiter {
  private timestamps: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly windowMs: number,
    private readonly burstLimit: number,
  ) {}

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

// Reflector oracles are mainnet-only contracts. `network` only affects which
// Soroban RPC URL is used for simulation; the simulation transaction itself
// always uses Networks.PUBLIC because that is the contract's deployed network.
export class OracleClient {
  private readonly contract: Contract;
  private readonly rpcServer: rpc.Server;
  private readonly contractId: string;

  private static readonly ASSETS_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly PRICE_TTL_MS = 60 * 1000;

  private static inflightAssets = new Map<string, Promise<string[]>>();
  private static inflightLastPrice = new Map<string, Promise<number>>();
  private static cacheAssets = new Map<string, { data: string[]; ts: number }>();
  private static cacheLastPrice = new Map<string, { data: number; ts: number }>();

  constructor(contractId: string, network: 'mainnet' | 'testnet' = 'mainnet') {
    this.contractId = contractId;
    this.contract = new Contract(contractId);
    this.rpcServer = createOracleRpcServer(network);
  }

  /** Drop this client's contribution to the module-level caches. */
  clearCache(): void {
    OracleClient.cacheAssets.delete(this.contractId);
    for (const key of Array.from(OracleClient.cacheLastPrice.keys())) {
      if (key.startsWith(`${this.contractId}:`)) OracleClient.cacheLastPrice.delete(key);
    }
  }

  async getAssets(): Promise<string[]> {
    return this.memoize(
      this.contractId,
      OracleClient.cacheAssets,
      OracleClient.inflightAssets,
      OracleClient.ASSETS_TTL_MS,
      async () => {
        const retval = await this.simulate('assets');
        const decoded = scValToNative(retval);
        const symbols: string[] = [];
        if (Array.isArray(decoded)) {
          for (const asset of decoded) {
            if (Array.isArray(asset) && asset.length === 2) {
              const [type, value] = asset;
              if (type === 'Other' && value) symbols.push(String(value));
              else if (type === 'Stellar' && value) symbols.push(`stellar_${value}`);
            }
          }
        }
        return symbols;
      },
    );
  }

  async getLastPrice(asset: Asset): Promise<number> {
    const key = `${this.contractId}:${asset.type}-${asset.code}`;
    return this.memoize(
      key,
      OracleClient.cacheLastPrice,
      OracleClient.inflightLastPrice,
      OracleClient.PRICE_TTL_MS,
      async () => {
        const retval = await this.simulate('lastprice', buildAssetScVal(asset));
        const decoded = scValToNative(retval) as unknown;
        if (decoded && typeof decoded === 'object') {
          const obj = decoded as Record<string, unknown>;
          if ('Some' in obj && obj.Some && typeof obj.Some === 'object' && 'price' in (obj.Some as object)) {
            return parseFloat(String((obj.Some as { price: unknown }).price));
          }
          if ('price' in obj) return parseFloat(String(obj.price));
        }
        if (typeof decoded === 'number' || typeof decoded === 'string') {
          return parseFloat(String(decoded));
        }
        return 0;
      },
    );
  }

  private async simulate(method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal> {
    const account = await rateLimiter.run(() => this.rpcServer.getAccount(SIMULATION_ACCOUNT));
    const transaction = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: Networks.PUBLIC,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await rateLimiter.run(() => this.rpcServer.simulateTransaction(transaction));
    if ('error' in sim) throw new Error(`${method} failed: ${sim.error}`);
    if ('result' in sim && sim.result && 'retval' in sim.result) {
      return sim.result.retval;
    }
    throw new Error(`${method} returned no result`);
  }

  private async memoize<T>(
    key: string,
    cache: Map<string, { data: T; ts: number }>,
    inflight: Map<string, Promise<T>>,
    ttl: number,
    fetch: () => Promise<T>,
  ): Promise<T> {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < ttl) return cached.data;

    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const data = await fetch();
        cache.set(key, { data, ts: Date.now() });
        return data;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, promise);
    return promise;
  }
}
