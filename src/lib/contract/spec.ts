import { contract, rpc } from '@stellar/stellar-sdk';
import { appConfig } from '@/lib/appConfig';
import { getNetworkPassphrase } from '@/lib/stellar';

export type NetworkType = 'mainnet' | 'testnet';

export interface LoadedContract {
  contractId: string;
  network: NetworkType;
  spec: contract.Spec;
  /** Function names in declaration order, excluding `__constructor`. */
  functions: string[];
}

const cache = new Map<string, LoadedContract>();

const cacheKey = (network: NetworkType, contractId: string) => `${network}:${contractId}`;

const rpcUrlFor = (network: NetworkType): string =>
  network === 'testnet' ? appConfig.TESTNET_SOROBAN_RPC : appConfig.MAINNET_SOROBAN_RPC;

/**
 * Fetch a contract's WASM from Soroban RPC and parse its spec.
 * Cached in memory per (network, contractId). Pass `force` to bypass the cache.
 */
export const loadContractSpec = async (
  contractId: string,
  network: NetworkType,
  { force = false }: { force?: boolean } = {},
): Promise<LoadedContract> => {
  const key = cacheKey(network, contractId);
  if (!force) {
    const cached = cache.get(key);
    if (cached) return cached;
  }

  const server = new rpc.Server(rpcUrlFor(network));

  let wasm: Buffer;
  try {
    wasm = await server.getContractWasmByContractId(contractId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // SACs (Stellar Asset Contracts) have no WASM — the RPC returns a native
    // executable and the SDK can't fetch bytecode for them.
    if (/executable|not.*wasm|stellar.*asset/i.test(msg)) {
      throw new Error('This looks like a Stellar Asset Contract (SAC), which has no on-chain WASM. Custom contract calls only work for WASM-backed contracts.');
    }
    throw new Error(`Failed to load contract: ${msg}`);
  }
  const spec = await contract.Spec.fromWasm(wasm);

  const functions = spec
    .funcs()
    .map((fn) => fn.name().toString())
    .filter((name) => name !== '__constructor');

  const loaded: LoadedContract = { contractId, network, spec, functions };
  cache.set(key, loaded);
  return loaded;
};

export const clearContractSpecCache = () => cache.clear();

/**
 * Options for building/simulating a contract invocation with the SDK's
 * `AssembledTransaction`. Kept small and stable so callers don't touch the SDK.
 */
export interface InvocationContext {
  loaded: LoadedContract;
  publicKey: string;
}

export const invocationRpcOptions = (loaded: LoadedContract, publicKey: string) => ({
  contractId: loaded.contractId,
  networkPassphrase: getNetworkPassphrase(loaded.network),
  rpcUrl: rpcUrlFor(loaded.network),
  publicKey,
});
