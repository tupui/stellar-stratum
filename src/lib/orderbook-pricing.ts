// Orderbook-based asset pricing using Horizon API
import { createHorizonServer } from './stellar';
import { pricingLogger } from './pricing-logger';
import { getAssetPrice } from './reflector';

interface OrderbookEntry {
  price: string;
  amount: string;
}

interface OrderbookResponse {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
}

// Cache for orderbook prices (same pattern as reflector.ts)
const orderbookPriceCache: Record<string, { price: number; timestamp: number }> = {};
const ORDERBOOK_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes (same as oracle prices)

// Request deduplication for orderbook fetches
const inflightOrderbookRequests = new Map<string, Promise<number>>();

/**
 * Get asset price from orderbook mid-market price
 * Returns 0 if no valid orderbook data is available
 */
export const getOrderbookPrice = async (
  assetCode?: string, 
  assetIssuer?: string, 
  network: 'mainnet' | 'testnet' = 'mainnet'
): Promise<number> => {
  const assetKey = assetIssuer ? `${assetCode}:${assetIssuer}:orderbook` : `${assetCode || 'XLM'}:orderbook`;
  
  // Request deduplication
  if (inflightOrderbookRequests.has(assetKey)) {
    pricingLogger.log({ type: 'cache_hit', asset: assetKey });
    return inflightOrderbookRequests.get(assetKey)!;
  }

  const pricePromise = (async (): Promise<number> => {
    try {
      // Check cache first
      const cached = orderbookPriceCache[assetKey];
      if (cached && (Date.now() - cached.timestamp) < ORDERBOOK_CACHE_DURATION) {
        pricingLogger.log({ type: 'cache_hit', asset: assetKey, price: cached.price });
        return cached.price;
      }

      // Handle native XLM - get price from oracle directly
      if (!assetCode || assetCode === 'XLM') {
        pricingLogger.log({ type: 'cache_miss', asset: assetKey, error: 'XLM should use oracle price' });
        return 0;
      }

      // Get orderbook data for ASSET/XLM pair
      const midMarketPrice = await fetchOrderbookMidPrice(assetCode, assetIssuer, network);
      
      if (midMarketPrice <= 0) {
        pricingLogger.log({ type: 'cache_miss', asset: assetKey, error: 'No valid orderbook data' });
        return 0;
      }

      // Get XLM/USD price to convert to USD
      const xlmUsdPrice = await getAssetPrice('XLM');
      if (xlmUsdPrice <= 0) {
        pricingLogger.log({ type: 'oracle_error', asset: assetKey, error: 'Failed to get XLM/USD price' });
        return 0;
      }

      // Calculate USD price: ASSET/XLM * XLM/USD = ASSET/USD
      const usdPrice = midMarketPrice * xlmUsdPrice;
      
      // Cache the result
      orderbookPriceCache[assetKey] = {
        price: usdPrice,
        timestamp: Date.now()
      };

      pricingLogger.log({ 
        type: 'price_fetch', 
        asset: assetKey, 
        price: usdPrice,
        oracle: 'orderbook' 
      });

      return usdPrice;

    } catch (error) {
      pricingLogger.log({ 
        type: 'oracle_error', 
        asset: assetKey, 
        error: error instanceof Error ? error.message : 'Unknown orderbook error' 
      });
      return 0;
    } finally {
      inflightOrderbookRequests.delete(assetKey);
    }
  })();

  inflightOrderbookRequests.set(assetKey, pricePromise);
  return pricePromise;
};

/**
 * Fetch orderbook data from Horizon and calculate mid-market price
 */
const fetchOrderbookMidPrice = async (
  assetCode: string,
  assetIssuer?: string,
  network: 'mainnet' | 'testnet' = 'mainnet'
): Promise<number> => {
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
      return 0; // No orderbook data available
    }

    const bidPrice = parseFloat(bestBid.price);
    const askPrice = parseFloat(bestAsk.price);

    if (bidPrice <= 0 || askPrice <= 0 || bidPrice >= askPrice) {
      return 0; // Invalid price data
    }

    // Calculate mid-market price (simple average of bid and ask)
    const midPrice = (bidPrice + askPrice) / 2;

    return midPrice;

  } catch (error) {
    // Don't log here as it will be logged by the caller
    return 0;
  }
};

/**
 * Clear orderbook price cache (for refresh functionality)
 */
export const clearOrderbookCache = (): void => {
  Object.keys(orderbookPriceCache).forEach(key => delete orderbookPriceCache[key]);
  inflightOrderbookRequests.clear();
  pricingLogger.log({ type: 'cache_miss', asset: 'orderbook_cache_cleared' });
};