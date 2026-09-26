import { contract } from '@stellar/stellar-sdk';
import { appConfig } from '@/lib/appConfig';
import { getNetworkPassphrase } from '@/lib/stellar';

export type NetworkType = 'mainnet' | 'testnet';

export interface LoadedContract {
  contractId: string;
  network: NetworkType;
  spec: contract.Spec;
  /** Function names in declaration order, excluding reserved ones such as `__constructor` and `__check_auth`. */
  functions: string[];
}

const cache = new Map<string, LoadedContract>();

const cacheKey = (network: NetworkType, contractId: string) => `${network}:${contractId}`;

const rpcUrlFor = (network: NetworkType): string =>
  network === 'testnet' ? appConfig.TESTNET_SOROBAN_RPC : appConfig.MAINNET_SOROBAN_RPC;

/** Message of an Error, or of the plain `{ code, message }` objects the SDK rejects RPC failures with. */
export const errorMessage = (e: unknown, fallback: string): string => {
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
};

/**
 * Load a contract's spec from Soroban RPC: parsed from its WASM, or the SDK's built-in spec for a
 * Stellar Asset Contract. Cached in memory per (network, contractId). Pass `force` to bypass the cache.
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

  let spec: contract.Spec;
  try {
    ({ spec } = await contract.Client.from({
      contractId,
      rpcUrl: rpcUrlFor(network),
      networkPassphrase: getNetworkPassphrase(network),
    }));
  } catch (e) {
    const where = network === 'testnet' ? 'Testnet' : 'Mainnet';
    throw new Error(`Failed to load contract from ${where}: ${errorMessage(e, String(e))}`, { cause: e });
  }

  const functions = spec
    .funcs()
    .map((fn) => fn.name.toString())
    .filter((name) => !name.startsWith('__'));

  const loaded: LoadedContract = { contractId, network, spec, functions };
  cache.set(key, loaded);
  return loaded;
};

export const invocationRpcOptions = (loaded: LoadedContract, publicKey: string) => ({
  contractId: loaded.contractId,
  networkPassphrase: getNetworkPassphrase(loaded.network),
  rpcUrl: rpcUrlFor(loaded.network),
  publicKey,
});
