import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Address, Networks, nativeToScVal, rpc, type Operation, type Transaction, type xdr } from '@stellar/stellar-sdk';

// Everything the module would ask the network is answered here: no RPC, Horizon or oracle call leaves the test.
const horizon = vi.hoisted(() => ({ loadAccount: vi.fn() }));
vi.mock('@/lib/stellar', () => ({
  createHorizonServer: () => horizon,
  getNetworkPassphrase: (network: string) => (network === 'testnet' ? 'Test SDF Network ; September 2015' : 'Public Global Stellar Network ; September 2015'),
}));
const reflector = vi.hoisted(() => ({ getAssetPrice: vi.fn() }));
vi.mock('@/lib/reflector', () => reflector);

import { loadAccountSequence, oraclePrice, readSoroswapPool, readTokenDecimals, readTokenSymbol } from './onchain';

const FACTORY = 'CA4HEQTL2WPEUYKYKCDOHCDNIV4QHNJ7EL4J4NQ6VADP7SYHVRYZ7AW2';
const PAIR = 'CDN3LLHWKQKSKABVUGRB5TARVRSCM7H34SWUQ4AF53PS3QO66FMZACYB';
const XLM = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const USDC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
const TOKEN = 'CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH';

/** contract:function → the value a simulation returns, or an error. */
type Answers = Record<string, xdr.ScVal | Error>;

const simulate = (answers: Answers) =>
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockImplementation(async (tx) => {
    const { func } = (tx as Transaction).operations[0] as Operation.InvokeHostFunction;
    if (func.type !== 'hostFunctionTypeInvokeContract') throw new Error('not a contract call');
    const { contractAddress, functionName } = func.invokeContract;
    const answer = answers[`${Address.fromScAddress(contractAddress).toString()}:${functionName.toString()}`];
    if (!answer) throw new Error(`unexpected read ${functionName.toString()}`);
    const response = answer instanceof Error ? { error: answer.message } : { result: { auth: [], retval: answer } };
    return response as unknown as rpc.Api.SimulateTransactionResponse;
  });

const u32 = (n: number) => nativeToScVal(n, { type: 'u32' });
const reserves = (a: bigint, b: bigint) => nativeToScVal([nativeToScVal(a, { type: 'i128' }), nativeToScVal(b, { type: 'i128' })]);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in tests'))));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('readTokenDecimals', () => {
  it('reads decimals from the token contract, on the network asked for', async () => {
    const spy = simulate({ [`${TOKEN}:decimals`]: u32(9) });
    await expect(readTokenDecimals(TOKEN, 'mainnet')).resolves.toBe(9);
    const [tx] = spy.mock.calls[0];
    expect((tx as Transaction).networkPassphrase).toBe(Networks.PUBLIC);
  });

  it('refuses an unusable answer and does not remember a failure', async () => {
    simulate({ [`${TOKEN}:decimals`]: u32(77) });
    await expect(readTokenDecimals(TOKEN, 'testnet')).rejects.toThrow(/unusable number of decimals/);
    simulate({ [`${TOKEN}:decimals`]: new Error('HostError') });
    await expect(readTokenDecimals(TOKEN, 'testnet')).rejects.toThrow(/Could not read decimals/);
    simulate({ [`${TOKEN}:decimals`]: u32(6) });
    await expect(readTokenDecimals(TOKEN, 'testnet')).resolves.toBe(6);
  });
});

describe('readTokenSymbol', () => {
  it('reads the symbol from the token contract', async () => {
    simulate({ [`${TOKEN}:symbol`]: nativeToScVal(' BLND ') });
    await expect(readTokenSymbol(TOKEN, 'mainnet')).resolves.toBe('BLND');
  });
});

describe('readSoroswapPool', () => {
  const found = (token0: string, a: bigint, b: bigint): Answers => ({
    [`${FACTORY}:pair_exists`]: nativeToScVal(true),
    [`${FACTORY}:get_pair`]: new Address(PAIR).toScVal(),
    [`${PAIR}:token_0`]: new Address(token0).toScVal(),
    [`${PAIR}:get_reserves`]: reserves(a, b),
  });

  it('reads the reserves through the pinned factory, in the order asked for', async () => {
    simulate(found(XLM, 460_000_000n, 100_000_000n));
    await expect(readSoroswapPool(XLM, USDC, 'mainnet')).resolves.toEqual({
      exists: true, pair: PAIR, reserveA: 460_000_000n, reserveB: 100_000_000n,
    });
    await expect(readSoroswapPool(USDC, XLM, 'mainnet')).resolves.toEqual({
      exists: true, pair: PAIR, reserveA: 100_000_000n, reserveB: 460_000_000n,
    });
  });

  it('reports an absent or empty pair as new', async () => {
    simulate({ [`${FACTORY}:pair_exists`]: nativeToScVal(false) });
    await expect(readSoroswapPool(XLM, USDC, 'mainnet')).resolves.toEqual({ exists: false });
    simulate(found(XLM, 0n, 0n));
    await expect(readSoroswapPool(XLM, USDC, 'mainnet')).resolves.toEqual({ exists: false });
  });

  it('fails rather than guess', async () => {
    simulate(found(TOKEN, 1n, 1n));
    await expect(readSoroswapPool(XLM, USDC, 'mainnet')).rejects.toThrow(/holds other tokens/);
    simulate({ [`${FACTORY}:pair_exists`]: new Error('HostError') });
    await expect(readSoroswapPool(XLM, USDC, 'mainnet')).rejects.toThrow(/Could not read pair_exists/);
  });
});

describe('loadAccountSequence', () => {
  it('reads the current sequence number from Horizon', async () => {
    horizon.loadAccount.mockResolvedValue({ sequence: '123456789012345678' });
    await expect(loadAccountSequence('GABC', 'mainnet')).resolves.toBe(123_456_789_012_345_678n);
  });
});

describe('oraclePrice', () => {
  it('prices XLM and classic assets from Reflector, on mainnet only', async () => {
    reflector.getAssetPrice.mockResolvedValue(0.3);
    await expect(oraclePrice('XLM', undefined, 'mainnet')).resolves.toBe(0.3);
    expect(reflector.getAssetPrice).toHaveBeenLastCalledWith(undefined, undefined);
    await expect(oraclePrice('USDC', 'GISSUER', 'mainnet')).resolves.toBe(0.3);
    expect(reflector.getAssetPrice).toHaveBeenLastCalledWith('USDC', 'GISSUER');
    reflector.getAssetPrice.mockClear();
    await expect(oraclePrice('XLM', undefined, 'testnet')).resolves.toBe(0);
    expect(reflector.getAssetPrice).not.toHaveBeenCalled();
  });

  it('is 0 when the oracle fails or does not answer in time', async () => {
    reflector.getAssetPrice.mockRejectedValue(new Error('down'));
    await expect(oraclePrice('XLM', undefined, 'mainnet')).resolves.toBe(0);
    vi.useFakeTimers();
    reflector.getAssetPrice.mockReturnValue(new Promise(() => {}));
    const pending = oraclePrice('XLM', undefined, 'mainnet');
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toBe(0);
    vi.useRealTimers();
  });
});
