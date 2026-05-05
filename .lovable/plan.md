## Problem

In `src/components/history/TransactionHistoryPanel.tsx` the fiat conversion is split into two `useEffect`s coordinated through `usdAmountsRef` / `rateInfoRef` plus an early-exit guard that compares transaction ids. Symptoms:

- After the first paint the rates often stick (Step 1's guard `!hasNewTransactions && usdAmounts.size >= transactions.length` skips recomputation, so when an asset list arrives later or `selectedAsset` changes nothing recalculates).
- Switching USD → EUR → USD sometimes leaves stale per-row rates because Step 2 reads `rateInfoRef.current` while Step 1 is still writing it (race during async `for` loops).
- The "per asset" rate label (`assetRate * fxRate`) inconsistently uses fallback `1/fallbackFxRate` from `getFxRate` (Reflector oracle), conflicting with Kraken's already-inverted historical pair, producing different numbers per refresh.
- For old transactions where Kraken has no daily close (>1y back) we render `N/A` correctly, but the rate caption still appears for some rows because `rateInfo` is written even when `usdPrice === 0`.

The two-effect / two-ref design is also more complex than needed.

## Fix

Collapse the logic into a single derivation: one `useEffect` that, whenever `transactions` or `quoteCurrency` change, primes caches and writes `fiatAmounts` + `rateInfo` in one shot. Caching stays exactly where it is (Kraken localStorage, 24h TTL, supported-pairs cache, in-flight dedupe) — we do not add new caches.

### Changes in `src/components/history/TransactionHistoryPanel.tsx`

1. Delete `usdAmounts` state, `usdAmountsRef`, `rateInfoRef`, `lastTransactionIdsRef`, and both existing `useEffect`s (Step 1 + Step 2).
2. Add one `useEffect` keyed on `[transactions, quoteCurrency, network]` that:
   - Returns early if `transactions.length === 0`.
   - Builds the unique asset set from the current `transactions` (XLM + every `assetCode` + swap from/to codes).
   - Primes once: `Promise.all([...assets].map(primeUsdRatesForAsset))` and, when `quoteCurrency !== 'USD'`, `primeHistoricalFxRates('USD', quoteCurrency)`. These are already deduped and read from localStorage on hit, so we are at most 1 fetch per asset + 1 per FX pair per 24h.
   - Iterates transactions synchronously over the now-warm cache using `getUsdRateForDateByAsset(asset, date, true)` (cache-only) and `getHistoricalFxRate('USD', quoteCurrency, date, true)` (cache-only). No per-row awaits.
   - Computes `fiatAmount = usdPrice * amount * fxRate` where `fxRate = 1` for USD or the cached Kraken value (already stored as target-per-USD by `fetchFullYearForFiatPair`).
   - Only writes `rateInfo` for rows where `usdPrice > 0` (so the "per asset" caption never appears when we will render `N/A`).
   - Sets `fiatAmounts`, `rateInfo`, and `setFiatLoading(false)` at the end.
3. Remove the fallback-inversion branch entirely. If a date has no Kraken FX rate, the row falls back to USD-only display via the existing `showNA` path — we no longer mix Reflector (oracle) FX with Kraken historical FX in the same calculation, which was the source of inconsistent values.
4. Drop the now-unused import of `getFxRate` and `getAssetPrice` from this file (they are still used elsewhere). Keep `convertFromUSD` for the portfolio-value effects (those are correct already and only depend on `totalPortfolioValueUSD` + `quoteCurrency`).

### No changes needed in

- `src/lib/kraken.ts` — caching is already optimal (1y of daily OHLC per asset + per FX pair, 24h TTL, localStorage, supported-pairs cache, in-flight dedupe, 20 req/min limiter).
- `src/lib/fiat-currencies.ts` — Reflector oracle FX path stays as-is for `useFiatConversion` / portfolio totals.
- `src/components/history/GroupedTransactionItem.tsx` — already gates the rate caption on `rateInfo.has(id)` and `!showNA`; once we stop populating `rateInfo` for zero-price rows it will be correct automatically.

## Verification (mainnet, Tansu account via Soroban Domains)

1. Open Activity, observe rates appear once (no flicker, no stale 0).
2. Switch quote currency USD → EUR → GBP → USD and back; values for the same row recompute deterministically and the per-asset caption matches `formatFiatAmount(row) / amount`.
3. Spot check three transactions at different dates (e.g. one from this week, one ~3 months old, one ~10 months old) — all show non-zero values with consistent rates across currency switches. Anything older than the 1-year Kraken window shows `N/A` and no caption.
4. Network tab: at most one `OHLC` request per asset and one per FX pair per 24h; subsequent currency toggles are pure cache reads.

## Out of scope

No new caches, no refactor of `useAccountHistory`, no oracle changes.
