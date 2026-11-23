import { Decimal } from 'decimal.js';
import { SupportedPlatforms, TradeType, type QuoteResponse } from '@soroswap/sdk';
import { apiAmount } from './api';

/**
 * Bounds the app computes itself for what it asks the Soroswap and DeFindex
 * APIs to build. The APIs are a third party: the least a user receives or the
 * most they pay must follow from their own inputs, not from numbers the API chose.
 */

const BPS = 10_000n;

/**
 * Soroswap's protocol fee, in basis points. The app asks for no fee of its own,
 * but the aggregator always takes this one (its `config` reads `protocol_bps: 10`):
 * out of the amount sold inside the contract on its own routes, and as a payment
 * beside the path payment on SDEX routes.
 */
export const SOROSWAP_PROTOCOL_FEE_BPS = 10n;

/**
 * The slippage bound of a swap, from the quoted amount and the user's slippage:
 * the least to receive when selling an exact amount (`in`), the most to sell
 * when buying one (`out`). Rounded towards the looser side, so an API rounding
 * the same bound the other way by one unit is not refused.
 */
export const swapBound = (exact: 'in' | 'out', quoted: bigint, slippageBps: number): bigint => {
  const bps = BigInt(slippageBps);
  return exact === 'in' ? (quoted * (BPS - bps)) / BPS : (quoted * (BPS + bps) + BPS - 1n) / BPS;
};

/**
 * The least a liquidity leg or a vault withdrawal may settle for. One basis
 * point more than the slippage sent to the API leaves room for its rounding.
 */
export const slippageFloor = (amount: bigint, slippageBps: bigint): bigint =>
  (amount * (BPS - slippageBps - 1n)) / BPS;

export interface SwapRequest {
  tokenIn: string;
  tokenOut: string;
  exact: 'in' | 'out';
  /** The amount the user typed: sold for `in`, bought for `out`. */
  amount: bigint;
  slippageBps: number;
}

export interface CheckedQuote {
  amountIn: bigint;
  amountOut: bigint;
  /**
   * Minimum received (`in`) or maximum sold (`out`), from the user's slippage.
   * The maximum sold through SDEX includes Soroswap's protocol fee on it.
   */
  bound: bigint;
}

/**
 * Read a quote and check it is for the swap the user asked for; throws when it
 * is not, or when the API's own bound is worse than the user's slippage allows.
 */
export const checkQuote = (quote: QuoteResponse, request: SwapRequest): CheckedQuote => {
  const exactIn = request.exact === 'in';
  if (quote.assetIn !== request.tokenIn || quote.assetOut !== request.tokenOut) {
    throw new Error('The Soroswap quote is for a different pair of tokens. Not building it.');
  }
  if (quote.tradeType !== (exactIn ? TradeType.EXACT_IN : TradeType.EXACT_OUT)) {
    throw new Error('The Soroswap quote is for a different kind of trade. Not building it.');
  }
  const amountIn = apiAmount(quote.amountIn);
  const amountOut = apiAmount(quote.amountOut);
  if ((exactIn ? amountIn : amountOut) !== request.amount) {
    throw new Error('The Soroswap quote is for a different amount. Not building it.');
  }
  if (amountIn <= 0n || amountOut <= 0n) throw new Error('The Soroswap quote has an empty side. Not building it.');

  const slipped = swapBound(request.exact, exactIn ? amountOut : amountIn, request.slippageBps);
  const threshold = apiAmount(quote.otherAmountThreshold);
  if (exactIn ? threshold < slipped : threshold > slipped) {
    const pct = (request.slippageBps / 100).toFixed(2);
    throw new Error(
      `The Soroswap quote's ${exactIn ? 'minimum received' : 'maximum sold'} is worse than your ${pct}% slippage allows. Not building it.`,
    );
  }
  // Buying through SDEX, the API pays the fee beside a path payment that may already
  // sell the whole slippage bound, so the most sold is that bound and the fee on it
  const sdexFee = !exactIn && quote.platform === SupportedPlatforms.SDEX
    ? (slipped * SOROSWAP_PROTOCOL_FEE_BPS + BPS - 1n) / BPS
    : 0n;
  return { amountIn, amountOut, bound: slipped + sdexFee };
};

/**
 * How far a quote may fall below the oracle rate before it is refused, in basis
 * points. Wide enough for oracle lag (and the up to a day old price the app
 * falls back to when the oracle does not answer), fees and normal price impact.
 */
export const RATE_TOLERANCE_BPS = 500;

export type RateCheck =
  /** No independent price for one of the tokens: the rate is the API's word alone. */
  | { status: 'unpriced' }
  /** `shortfallBps`: how much less the output is worth than the input (negative when the quote beats the oracle). */
  | { status: 'ok' | 'off'; shortfallBps: number };

export interface PricedLeg {
  raw: bigint;
  decimals: number;
  /** USD price per unit, 0 when there is none. */
  price: number;
}

/** Compare a quote's rate with independent USD prices of both tokens. */
export const checkRate = (sell: PricedLeg, buy: PricedLeg): RateCheck => {
  const priced = (leg: PricedLeg) => Number.isFinite(leg.price) && leg.price > 0;
  if (!priced(sell) || !priced(buy)) return { status: 'unpriced' };
  const value = (leg: PricedLeg) => new Decimal(leg.raw.toString()).div(new Decimal(10).pow(leg.decimals)).mul(leg.price);
  const valueIn = value(sell);
  if (valueIn.lte(0)) return { status: 'unpriced' };
  const shortfallBps = new Decimal(1).minus(value(buy).div(valueIn)).mul(10_000).toNumber();
  return { status: shortfallBps > RATE_TOLERANCE_BPS ? 'off' : 'ok', shortfallBps };
};
