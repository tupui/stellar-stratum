// Orderbook-based asset pricing using Horizon API
import { createHorizonServer } from './stellar';
import { getAssetPrice } from './reflector';

interface OrderbookEntry {
  price: string;
  amount: string;
}

interface OrderbookResponse {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
}

// Cache for orderbook prices
const orderbookPriceCache: Record<string, { price: number; timestamp: number }> = {};
const ORDERBOOK_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Request deduplication for orderbook fetches
const inflightOrderbookRequests = new Map<string, Promise<number>>();

/**
 * Get asset price from orderbook mid-market price
 */
export const getOrderbookPrice = async (
  assetCode?: string, 
  assetIssuer?: string, 
  network: 'mainnet' | 'testnet' = 'mainnet'
): Promise<number> => {
  const assetKey = assetIssuer ? `${assetCode}:${assetIssuer}:orderbook` : `${assetCode || 'XLM'}:orderbook`;
  
  // Request deduplication
  if (inflightOrderbookRequests.has(assetKey)) {
    return inflightOrderbookRequests.get(assetKey)!;
  }

  const pricePromise = (async (): Promise<number> => {
    try {
      // Check cache first
      const cached = orderbookPriceCache[assetKey];
      if (cached && (Date.now() - cached.timestamp) < ORDERBOOK_CACHE_DURATION) {
        return cached.price;
      }

      // Handle native XLM - get price from oracle directly
      if (!assetCode || assetCode === 'XLM') {
        return 0;
      }

      // Get orderbook data for ASSET/XLM pair
      const result = await fetchOrderbookMidPrice(assetCode, assetIssuer, network);
      
      if (!result || result.midPrice <= 0) {
        return 0;
      }

      // Get XLM/USD price to convert to USD
      const xlmUsdPrice = await getAssetPrice('XLM');
      if (xlmUsdPrice <= 0) {
        return 0;
      }

      // Check if spread is too wide (>10%) - if so, use last trade price instead
      if (result.spreadPercent > 10) {
        const tradePrice = await fetchLastTradePrice(assetCode, assetIssuer, network);
        if (tradePrice > 0) {
          const usdPrice = tradePrice * xlmUsdPrice;
          orderbookPriceCache[assetKey] = { price: usdPrice, timestamp: Date.now() };
          return usdPrice;
        }
      }

      // Calculate USD price: ASSET/XLM * XLM/USD = ASSET/USD
      const usdPrice = result.midPrice * xlmUsdPrice;
      
      // Cache the result
      orderbookPriceCache[assetKey] = {
        price: usdPrice,
        timestamp: Date.now()
      };

      return usdPrice;

    } catch (error) {
      return 0;
    } finally {
      inflightOrderbookRequests.delete(assetKey);
    }
  })();

  inflightOrderbookRequests.set(assetKey, pricePromise);
  return pricePromise;
};

/**
 * Fetch orderbook data from Horizon and calculate mid-market price with spread info
 */
const fetchOrderbookMidPrice = async (
  assetCode: string,
  assetIssuer?: string,
  network: 'mainnet' | 'testnet' = 'mainnet'
): Promise<{ midPrice: number; spreadPercent: number } | null> => {
  const server = createHorizonServer(network);
  
  try {
    // Build Stellar SDK Asset objects
    const { Asset } = await import('@stellar/stellar-sdk');
    const sellingAsset = assetIssuer 
      ? new Asset(assetCode, assetIssuer)
      : Asset.native();
    
    const buyingAsset = Asset.native(); // XLM

    // Query orderbook endpoint
    const orderbook = await server
      .orderbook(sellingAsset, buyingAsset)
      .limit(1) // We only need the best bid/ask
      .call() as OrderbookResponse;

    // Extract best bid and ask
    const bestBid = orderbook.bids?.[0];
    const bestAsk = orderbook.asks?.[0];

    if (!bestBid || !bestAsk) {
      return null; // No orderbook data available
    }

    const bidPrice = parseFloat(bestBid.price);
    const askPrice = parseFloat(bestAsk.price);

    if (bidPrice <= 0 || askPrice <= 0 || bidPrice >= askPrice) {
      return null; // Invalid price data
    }

    // Calculate mid-market price and spread
    const midPrice = (bidPrice + askPrice) / 2;
    const spreadPercent = ((askPrice - bidPrice) / midPrice) * 100;

    return { midPrice, spreadPercent };

  } catch (error) {
    return null;
  }
};

/**
 * Fetch last executed trade price (for assets with wide spreads)
 */
const fetchLastTradePrice = async (
  assetCode: string,
  assetIssuer?: string,
  network: 'mainnet' | 'testnet' = 'mainnet'
): Promise<number> => {
  const server = createHorizonServer(network);
  
  try {
    const { Asset } = await import('@stellar/stellar-sdk');
    const baseAsset = assetIssuer ? new Asset(assetCode, assetIssuer) : Asset.native();
    const counterAsset = Asset.native(); // XLM

    // Get recent trades
    const tradesResponse = await server
      .trades()
      .forAssetPair(baseAsset, counterAsset)
      .order('desc')
      .limit(10)
      .call();

    const trades = tradesResponse.records || [];
    if (trades.length === 0) return 0;

    // Calculate volume-weighted average from last 5 trades
    let totalVolume = 0;
    let weightedPriceSum = 0;
    
    for (const trade of trades.slice(0, 5)) {
      const priceN = typeof trade.price.n === 'string' ? parseInt(trade.price.n) : trade.price.n;
      const priceD = typeof trade.price.d === 'string' ? parseInt(trade.price.d) : trade.price.d;
      const tradePrice = priceN / priceD;
      const volume = parseFloat(trade.base_amount);
      
      if (tradePrice > 0 && volume > 0) {
        weightedPriceSum += tradePrice * volume;
        totalVolume += volume;
      }
    }
    
    if (totalVolume === 0) return 0;
    return weightedPriceSum / totalVolume;

  } catch (error) {
    return 0;
  }
};

/**
 * Clear orderbook price cache (for refresh functionality)
 */
export const clearOrderbookCache = (): void => {
  Object.keys(orderbookPriceCache).forEach(key => delete orderbookPriceCache[key]);
  inflightOrderbookRequests.clear();
};
