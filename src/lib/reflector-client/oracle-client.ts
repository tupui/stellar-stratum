import { Contract, rpc, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { buildAssetScVal, type Asset } from './xdr-helper';

export interface OracleConfig {
  contract: string;
  base: string;
  decimals: number;
}

// Adaptive rate limiter: allow up to 50 RPC calls per 10s with burst, only wait when exceeded
const WINDOW_MS = 10_000;
const BURST_LIMIT = 50;
let __rpcTimestamps: number[] = [];
let __rpcQueue: Promise<any> = Promise.resolve();
const __sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function __cleanupTimestamps() {
  const now = Date.now();
  __rpcTimestamps = __rpcTimestamps.filter((t) => now - t < WINDOW_MS);
}

async function __acquireToken() {
  __cleanupTimestamps();
  const now = Date.now();
  if (__rpcTimestamps.length < BURST_LIMIT) {
    __rpcTimestamps.push(now);
    return;
  }
  const oldest = __rpcTimestamps[0];
  const wait = Math.max(0, WINDOW_MS - (now - oldest));
  if (wait > 0) {
    // Only sleep when we exceed the burst limit
    // [silenced] console.debug(`[oracle-client] Rate limit reached: sleeping ${wait}ms`);
    await __sleep(wait);
  }
  __cleanupTimestamps();
  __rpcTimestamps.push(Date.now());
}

function __runLimited<T>(fn: () => Promise<T>): Promise<T> {
  const task = __rpcQueue.then(async () => {
    await __acquireToken();
    const result = await fn();
    return result;
  });
  // keep the chain, but don't block on previous errors
  __rpcQueue = task.then(() => undefined).catch(() => undefined);
  return task;
}

export class OracleClient {
  private contract: Contract;
  private rpcServer: rpc.Server;
  private contractId: string;

  // Global in-memory memoization across instances to dedupe identical requests
  private static inflightAssets = new Map<string, Promise<string[]>>();
  private static inflightLastPrice = new Map<string, Promise<number>>();
  private static cacheAssets = new Map<string, { data: string[]; ts: number }>();
  private static cacheLastPrice = new Map<string, { data: number; ts: number }>();
  private static ASSETS_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  private static PRICE_TTL_MS = 60 * 1000; // 60s

  constructor(contractId: string, rpcUrl: string = 'https://mainnet.sorobanrpc.com') {
    this.contractId = contractId;
    this.contract = new Contract(contractId);
    this.rpcServer = new rpc.Server(rpcUrl);
  }

  /**
   * Get available assets from the oracle
   */
  async getAssets(): Promise<string[]> {
    // Cache hit
    const cached = OracleClient.cacheAssets.get(this.contractId);
    if (cached && Date.now() - cached.ts < OracleClient.ASSETS_TTL_MS) {
      return cached.data;
    }

    // Inflight dedupe
    const existing = OracleClient.inflightAssets.get(this.contractId);
    if (existing) return existing;

    const promise = (async () => {
      const simulationAccount = 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV';
      const account = await __runLimited(() => this.rpcServer.getAccount(simulationAccount));
      const transaction = new TransactionBuilder(account, {
        fee: '100000',
        networkPassphrase: Networks.PUBLIC,
      })
        .addOperation(this.contract.call('assets'))
        .setTimeout(30)
        .build();

      const simResult = await __runLimited(() => this.rpcServer.simulateTransaction(transaction));
      if ('error' in simResult) throw new Error(`Assets fetch failed: ${simResult.error}`);

      if ('result' in simResult && simResult.result && 'retval' in simResult.result) {
        const { scValToNative } = await import('@stellar/stellar-sdk');
        const resultValue = scValToNative(simResult.result.retval);
        const assetSymbols: string[] = [];
        if (Array.isArray(resultValue)) {
          for (const asset of resultValue) {
            if (Array.isArray(asset) && asset.length === 2) {
              const [type, value] = asset;
              if (type === 'Other' && value) assetSymbols.push(String(value));
              else if (type === 'Stellar' && value) assetSymbols.push(`stellar_${value}`);
            }
          }
        }
        OracleClient.cacheAssets.set(this.contractId, { data: assetSymbols, ts: Date.now() });
        return assetSymbols;
      }
      return [];
    })();

    OracleClient.inflightAssets.set(this.contractId, promise);
    try {
      return await promise;
    } finally {
      OracleClient.inflightAssets.delete(this.contractId);
    }
  }

  /**
   * Get last price for an asset
   */
  async getLastPrice(asset: Asset): Promise<number> {
    const key = `${this.contractId}:${asset.type}-${asset.code}`;

    // Cache hit
    const cached = OracleClient.cacheLastPrice.get(key);
    if (cached && Date.now() - cached.ts < OracleClient.PRICE_TTL_MS) {
      return cached.data;
    }

    // Inflight dedupe
    const existing = OracleClient.inflightLastPrice.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const simulationAccount = 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV';
      const account = await __runLimited(() => this.rpcServer.getAccount(simulationAccount));
      const assetParam = buildAssetScVal(asset);
      const transaction = new TransactionBuilder(account, {
        fee: '100000',
        networkPassphrase: Networks.PUBLIC,
      })
        .addOperation(this.contract.call('lastprice', assetParam))
        .setTimeout(30)
        .build();

      const simResult = await __runLimited(() => this.rpcServer.simulateTransaction(transaction));
      if ('error' in simResult) throw new Error(`Price fetch failed: ${simResult.error}`);

      if ('result' in simResult && simResult.result && 'retval' in simResult.result) {
        const { scValToNative } = await import('@stellar/stellar-sdk');
        const resultValue = scValToNative(simResult.result.retval);
        let price = 0;
        if (resultValue && typeof resultValue === 'object') {
          if ('Some' in resultValue && resultValue.Some && typeof resultValue.Some === 'object' && 'price' in resultValue.Some) {
            price = parseFloat(String(resultValue.Some.price));
          } else if ('price' in resultValue) {
            price = parseFloat(String(resultValue.price));
          } else if (typeof (resultValue as any) === 'number' || typeof (resultValue as any) === 'string') {
            price = parseFloat(String(resultValue as any));
          }
        }
        OracleClient.cacheLastPrice.set(key, { data: price, ts: Date.now() });
        return price;
      }
      return 0;
    })();

    OracleClient.inflightLastPrice.set(key, promise);
    try {
      return await promise;
    } finally {
      OracleClient.inflightLastPrice.delete(key);
    }
  }
}