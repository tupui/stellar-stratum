# Pricing Flow Review — Issues & Fixes

After tracing the full pricing pipeline (Reflector oracle → `useAssetPrices` → fiat conversion via FX oracle → Kraken historical → UI panels), here are the concrete problems and the fix for each.

## 1. `useAssetPrices` seeds fake data (`src/hooks/useAssetPrices.ts`)

Lines 88–104 inject a hardcoded `0.2201` USD price for XLM as the initial state ("matching live version"). This shows misleading numbers for a flash before the real oracle resolves, and on stale-cache + oracle failure it lingers.

**Fix:** Initialize with `priceUSD: 0`, `valueUSD: 0` and let the oracle/localStorage cache populate. Remove the literal price.

## 2. Dead `-1` loading-pill branch in `AssetBalancePanel.tsx`

Lines 271 and 284 render `<LoadingPill>` when `asset.priceUSD === -1`, but nothing in `useAssetPrices` ever sets `-1`. Loading UI is unreachable.

**Fix:** Use the hook's `loading` flag for per-row skeleton, or seed `priceUSD: -1` while pending and drop it after resolution. Pick one — preference: seed `-1` in the hook so per-row pill works.

## 3. `AssetBalancePanel.tsx` hardcoded future "last update" timestamp

Line 43: `useState<Date | null>(new Date('2025-12-10T12:00:00Z'))`. `getLastFetchTimestamp` and `clearPriceCache` are imported but never used.

**Fix:** Initialize with `getLastFetchTimestamp()`; on `refetch` set to `new Date()`; remove unused `clearPriceCache` import.

## 4. Manual refresh does not bust the 5-min price cache

`useAssetPrices.refetch` re-runs `getAssetPrice`, but the reflector module returns cached values for 5 min. User pressing the refresh button within that window gets stale data.

**Fix:** In `refetch`, call `clearPriceCache()` (or a narrower "invalidate in-memory cache" helper) before refetching so the user sees a real round-trip.

## 5. `computeStellarAssetContractId` is mainnet-only (`src/lib/reflector.ts`)

Line 15 hashes `Networks.PUBLIC` regardless of network. On testnet the resulting SAC ID is wrong, so issued-asset oracle lookups by contract ID silently fail.

**Fix:** The Reflector oracle is mainnet-only by design, so either (a) early-return `''` on testnet to avoid wasted lookups, or (b) accept a network arg. Choose (a) — keeps current "mainnet prices everywhere" behavior explicit and adds a comment.

## 6. `convertFromUSD` loop is sequential (`AssetBalancePanel.tsx`)

Lines 101–121 `await` per-asset conversion inside a `for` loop. Each FX call is cached/deduped, but the sequencing still serializes promise microtasks unnecessarily.

**Fix:** Build the work as a `Promise.all` over `assetsWithPrices.map(...)`. Also add `network` to the effect dep array.

## 7. `useAssetPrices` memoizes balances via `JSON.stringify` deps

Line 21: `useMemo(() => balances, [JSON.stringify(balances)])`. Stringifies the whole balances array on every render.

**Fix:** Replace with a cheap structural key, e.g. `useMemo(() => balances, [balances.map(b => \`${b.asset_code}:${b.asset_issuer}:${b.balance}\`).join('|')])`, or just depend on `balances` and trust upstream identity.

## 8. `fiat-currencies.ts` cache shape inconsistency

`getAvailableFiatCurrencies` stores `availableAssets` as-returned in `oracleAssetsCache` (line ~100), but `getFxRate` later (line ~147) overwrites with uppercased entries. The `includes(upperCurrency)` check then depends on which path warmed the cache.

**Fix:** Normalize once on write — always store uppercase in `oracleAssetsCache`. Drop the `(OracleClient as any)` casts (the export is a value, not a type).

## 9. `OracleClient` always uses `Networks.PUBLIC` and mainnet RPC

`src/lib/reflector-client/oracle-client.ts` builds simulation TXs with `Networks.PUBLIC` and `createOracleRpcServer` defaults to mainnet regardless of the `network` constructor arg. Simulations don't enforce the passphrase, but the inconsistency hides intent.

**Fix:** Either honor the `network` parameter end-to-end (passphrase + RPC) or remove the parameter and document that Reflector is mainnet-only. Recommend the second (matches reality).

## 10. Stale-price fallback window too short (`reflector.ts`)

`PRICE_CACHE_DURATION` and the localStorage `CACHE_DURATION` are both 5 min. If the oracle fails for >5 min, the UI flips to "N/A" instead of showing the last-known price. Other crypto wallets keep a stale price for hours and just flag it.

**Fix:** Extend localStorage fallback to 24h (display only on oracle failure); keep the in-memory 5-min TTL for "fresh enough". `getCachedPrice` becomes the safety net, not the primary cache.

## 11. Minor

- `src/lib/defindex-client.ts` / `soroswap-client.ts`: API keys ship in the browser (already flagged previously). Not addressed unless requested.
- `useAssetPrices` exports `error` but the conversion loop in `AssetBalancePanel` swallows errors — fine; documenting.

## Out of scope (no change)

- Two parallel `useAssetPrices` instances (in `AccountOverview` and `AssetBalancePanel`) are deduped by the inflight map; acceptable.
- `primeUsdRatesForAsset(_start, _end)` ignoring the date range is intentional (always pulls 1y, cached).

## Files to change

- `src/hooks/useAssetPrices.ts`
- `src/components/AssetBalancePanel.tsx`
- `src/lib/reflector.ts`
- `src/lib/fiat-currencies.ts`
- `src/lib/reflector-client/oracle-client.ts` (optional; tag #9)
