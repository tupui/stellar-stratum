import { describe, expect, it } from 'vitest';
import { TradeType, type QuoteResponse } from '@soroswap/sdk';
import { checkQuote, checkRate, RATE_TOLERANCE_BPS, slippageFloor, swapBound, type SwapRequest } from './guards';

const XLM = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const USDC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';

describe('swapBound', () => {
  it('takes the slippage off the quoted output when selling an exact amount', () => {
    expect(swapBound('in', 2_158_096n, 50)).toBe(2_147_305n); // 2_147_305.52, rounded down
    expect(swapBound('in', 10_000n, 50)).toBe(9_950n);
  });

  it('adds the slippage to the quoted input when buying an exact amount', () => {
    expect(swapBound('out', 2_158_096n, 50)).toBe(2_168_887n); // 2_168_886.48, rounded up
    expect(swapBound('out', 10_000n, 50)).toBe(10_050n);
  });
});

describe('slippageFloor', () => {
  it('leaves one basis point of room for the API rounding', () => {
    expect(slippageFloor(10_000_000n, 100n)).toBe(9_899_000n);
    expect(slippageFloor(0n, 100n)).toBe(0n);
  });
});

const quote = (overrides: Partial<Record<keyof QuoteResponse, unknown>> = {}) =>
  ({
    assetIn: XLM,
    assetOut: USDC,
    tradeType: TradeType.EXACT_IN,
    amountIn: '10000000',
    amountOut: '2158096',
    otherAmountThreshold: '2147305',
    priceImpactPct: '0.01',
    routePlan: [],
    ...overrides,
  }) as unknown as QuoteResponse;

const sell: SwapRequest = { tokenIn: XLM, tokenOut: USDC, exact: 'in', amount: 10_000_000n, slippageBps: 50 };
const buy: SwapRequest = { tokenIn: XLM, tokenOut: USDC, exact: 'out', amount: 2_158_096n, slippageBps: 50 };
const exactOut = (threshold: string) =>
  quote({ tradeType: TradeType.EXACT_OUT, amountIn: '10000000', amountOut: '2158096', otherAmountThreshold: threshold });

describe('checkQuote', () => {
  it('uses the bound from the user’s slippage, not the API’s', () => {
    expect(checkQuote(quote(), sell)).toEqual({ amountIn: 10_000_000n, amountOut: 2_158_096n, bound: 2_147_305n });
    // An API bound tighter than the user's is fine; the app's bound is still the one enforced.
    expect(checkQuote(quote({ otherAmountThreshold: '2158000' }), sell).bound).toBe(2_147_305n);
    expect(checkQuote(exactOut('10050000'), buy)).toEqual({ amountIn: 10_000_000n, amountOut: 2_158_096n, bound: 10_050_000n });
  });

  it('refuses an API bound worse than the user’s slippage allows', () => {
    expect(() => checkQuote(quote({ otherAmountThreshold: '2147304' }), sell)).toThrow(/minimum received is worse than your 0.50%/);
    expect(() => checkQuote(quote({ otherAmountThreshold: '1' }), sell)).toThrow(/minimum received/);
    expect(() => checkQuote(exactOut('10050001'), buy)).toThrow(/maximum sold is worse than your 0.50%/);
  });

  it('refuses a quote for another trade', () => {
    expect(() => checkQuote(quote({ assetOut: XLM }), sell)).toThrow(/different pair/);
    expect(() => checkQuote(quote({ tradeType: TradeType.EXACT_OUT }), sell)).toThrow(/different kind of trade/);
    expect(() => checkQuote(quote({ amountIn: '20000000' }), sell)).toThrow(/different amount/);
    expect(() => checkQuote(exactOut('10050000'), { ...buy, amount: 1n })).toThrow(/different amount/);
    expect(() => checkQuote(quote({ amountOut: '0', otherAmountThreshold: '0' }), sell)).toThrow(/empty side/);
    expect(() => checkQuote(quote({ amountOut: 'lots' }), sell)).toThrow(/Unexpected amount/);
  });
});

describe('checkRate', () => {
  // 1 XLM at $0.30 for 0.30 USDC at $1: the oracle rate exactly.
  const xlm = (raw: bigint, price = 0.3) => ({ raw, decimals: 7, price });
  const usdc = (raw: bigint, price = 1) => ({ raw, decimals: 7, price });

  it('passes a quote close to the oracle rate', () => {
    expect(checkRate(xlm(10_000_000n), usdc(3_000_000n))).toEqual({ status: 'ok', shortfallBps: 0 });
    const better = checkRate(xlm(10_000_000n), usdc(3_300_000n));
    expect(better.status).toBe('ok');
    expect(better.status !== 'unpriced' && better.shortfallBps).toBeCloseTo(-1000);
    const slightlyWorse = checkRate(xlm(10_000_000n), usdc(2_880_000n));
    expect(slightlyWorse.status).toBe('ok');
  });

  it('flags a quote far below the oracle rate', () => {
    const skimmed = checkRate(xlm(10_000_000n), usdc(2_700_000n));
    expect(skimmed.status).toBe('off');
    expect(skimmed.status !== 'unpriced' && skimmed.shortfallBps).toBeCloseTo(1000);
    // Just past the tolerance.
    const edge = checkRate(xlm(10_000_000n), usdc(3_000_000n - 3_000_000n * BigInt(RATE_TOLERANCE_BPS + 1) / 10_000n));
    expect(edge.status).toBe('off');
  });

  it('accounts for each token’s decimals', () => {
    // 0.3 of a 9-decimal token.
    const nine = { raw: 300_000_000n, decimals: 9, price: 1 };
    expect(checkRate(xlm(10_000_000n), nine)).toEqual({ status: 'ok', shortfallBps: 0 });
    // The same raw amount read at 7 decimals would be 100 times more.
    expect(checkRate(xlm(10_000_000n), { ...nine, raw: 3_000_000n })).toMatchObject({ status: 'off' });
  });

  it('says so when a token has no independent price', () => {
    expect(checkRate(xlm(10_000_000n, 0), usdc(3_000_000n))).toEqual({ status: 'unpriced' });
    expect(checkRate(xlm(10_000_000n), usdc(3_000_000n, Number.NaN))).toEqual({ status: 'unpriced' });
    expect(checkRate(xlm(0n), usdc(3_000_000n))).toEqual({ status: 'unpriced' });
  });
});
