import { Account, Address, BASE_FEE, Operation, TransactionBuilder, contract, rpc, scValToNative, type xdr } from '@stellar/stellar-sdk';
import { appConfig } from '@/lib/appConfig';
import { getAssetPrice } from '@/lib/reflector';
import { createHorizonServer, getNetworkPassphrase } from '@/lib/stellar';
import { KNOWN_CONTRACTS, type NetworkId } from './registry';
import { shortenAddress } from './tokens';

/**
 * What the app reads from the network itself to check the Soroswap and DeFindex
 * APIs: token decimals, pool reserves, the account's sequence number and oracle
 * prices. Contract reads are simulated on the app's own Soroban RPC; nothing is signed.
 */

const rpcUrl = (network: NetworkId) =>
  network === 'testnet' ? appConfig.TESTNET_SOROBAN_RPC : appConfig.MAINNET_SOROBAN_RPC;

/** Simulate a read-only contract call and return its result as a native value. */
export const readContract = async (
  network: NetworkId,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<unknown> => {
  // A read needs no real source account: the SDK's placeholder is enough to simulate.
  const tx = new TransactionBuilder(new Account(contract.NULL_ACCOUNT, '0'), {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(network),
  })
    .addOperation(Operation.invokeContractFunction({ contract: contractId, function: method, args }))
    .setTimeout(30)
    .build();
  const simulation = await new rpc.Server(rpcUrl(network)).simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation) || !simulation.result) {
    throw new Error(`Could not read ${method} of ${shortenAddress(contractId)} from the network.`);
  }
  return scValToNative(simulation.result.retval);
};

/** Token precision above this cannot hold even one unit in an i128. */
const MAX_DECIMALS = 38;

const decimalsRequests = new Map<string, Promise<number>>();

/** A token's decimals as its own contract reports them. Kept for the session only. */
export const readTokenDecimals = (contractId: string, network: NetworkId): Promise<number> => {
  const key = `${network}:${contractId}`;
  const inflight = decimalsRequests.get(key);
  if (inflight) return inflight;

  const request = readContract(network, contractId, 'decimals').then((value) => {
    const decimals = typeof value === 'number' || typeof value === 'bigint' ? Number(value) : NaN;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
      throw new Error(`${shortenAddress(contractId)} reports an unusable number of decimals.`);
    }
    return decimals;
  });
  // A failed read is tried again next time rather than remembered.
  request.catch(() => decimalsRequests.delete(key));
  decimalsRequests.set(key, request);
  return request;
};

const symbolRequests = new Map<string, Promise<string>>();

/** A token's symbol as its own contract reports it. Kept for the session only. */
export const readTokenSymbol = (contractId: string, network: NetworkId): Promise<string> => {
  const key = `${network}:${contractId}`;
  const inflight = symbolRequests.get(key);
  if (inflight) return inflight;

  const request = readContract(network, contractId, 'symbol').then((value) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${shortenAddress(contractId)} has no symbol.`);
    return value.trim().slice(0, 32);
  });
  request.catch(() => symbolRequests.delete(key));
  symbolRequests.set(key, request);
  return request;
};

export type PoolState =
  /** No pair yet, or one without reserves: the first deposit sets the price. */
  | { exists: false }
  | { exists: true; pair: string; reserveA: bigint; reserveB: bigint };

/**
 * A Soroswap pair's reserves in the order the tokens are given, found through
 * the pinned factory (never an address from the API) and read from the pair.
 */
export const readSoroswapPool = async (tokenA: string, tokenB: string, network: NetworkId): Promise<PoolState> => {
  const factory = KNOWN_CONTRACTS.find((c) => c.protocol === 'soroswap' && c.role === 'Factory' && c.network === network);
  if (!factory) throw new Error(`No Soroswap factory is pinned for ${network}.`);
  const tokens = [new Address(tokenA).toScVal(), new Address(tokenB).toScVal()];

  if ((await readContract(network, factory.address, 'pair_exists', tokens)) !== true) return { exists: false };
  const pair = await readContract(network, factory.address, 'get_pair', tokens);
  if (typeof pair !== 'string') throw new Error('The Soroswap factory returned no pair address.');

  const [token0, reserves] = await Promise.all([
    readContract(network, pair, 'token_0'),
    readContract(network, pair, 'get_reserves'),
  ]);
  if (!Array.isArray(reserves) || reserves.length !== 2 || !reserves.every((r) => typeof r === 'bigint')) {
    throw new Error('The Soroswap pair returned unreadable reserves.');
  }
  const [reserve0, reserve1] = reserves as [bigint, bigint];
  const oriented =
    token0 === tokenA ? { reserveA: reserve0, reserveB: reserve1 }
      : token0 === tokenB ? { reserveA: reserve1, reserveB: reserve0 }
        : null;
  if (!oriented) throw new Error('The Soroswap pair read from the network holds other tokens.');
  if (oriented.reserveA <= 0n || oriented.reserveB <= 0n) return { exists: false };
  return { exists: true, pair, ...oriented };
};

/** The account's current sequence number, from the app's primary Horizon. */
export const loadAccountSequence = async (account: string, network: NetworkId): Promise<bigint> =>
  BigInt((await createHorizonServer(network).loadAccount(account)).sequence);

const PRICE_TIMEOUT_MS = 8_000;

/**
 * USD price of XLM (no issuer) or a classic asset from the Reflector oracles, or
 * 0 when they have none or do not answer in time. Mainnet only.
 */
export const oraclePrice = async (code: string, issuer: string | undefined, network: NetworkId): Promise<number> => {
  if (network !== 'mainnet') return 0;
  const timeout = new Promise<number>((resolve) => setTimeout(() => resolve(0), PRICE_TIMEOUT_MS));
  try {
    return await Promise.race([getAssetPrice(issuer ? code : undefined, issuer), timeout]);
  } catch {
    return 0;
  }
};
