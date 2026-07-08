
## Goal

Full-project cleanup pass. Ship a smaller, more correct, more maintainable codebase. **No feature changes and no visible UX changes.** Every item is either a deletion, a dedup, a bug fix, or a perf fix — nothing rewrites a feature or moves it between files unnecessarily.

## Ground rules

- Behavior is preserved. Same network calls, same cached data, same rendered output.
- Every change is verified against `tsgo` and against the existing Playwright spec (`tests/fiat-switching-comprehensive.spec.ts`), plus a manual smoke run: connect wallet → dashboard → refresh prices → switch fiat → open Transaction Builder → sign & submit dry-run on testnet.
- No moving files just to move them. Renames only where a name is actively misleading.
- Skip anything that requires a design or product decision (splitting `TransactionBuilder.tsx`, moving API keys to a proxy, adding tests) — those are separate tasks.

## 1. Pricing & caching (`src/lib/reflector.ts`)

Bugs and dead code first:

- **Dead import:** `createHorizonServer` — remove.
- **Dead comments:** the ~15 `// Removed pricing logger …` carcasses and the `// Continue immediately` empty branches. Delete.
- **Dead code:** the reference to `pricing.ts` in `clearPriceCache` — no such file exists.
- **Duplicate cache layer:** `OracleClient` already has TTL + inflight dedup for `getAssets` / `getLastPrice`. Drop the outer `oracleAssetsCache` / `getOracleAssetsWithRetry` retry loop entirely (it re-implements what the client already provides) and the ad-hoc `PRICE_CACHE_MAX=200` eviction hack. Keep the *decimals-scaling* + *asset→oracle mapping* in this file; that's the only real logic that belongs here.
- **Rename for clarity:** `PRICE_CACHE_DURATION` → `FRESH_PRICE_TTL_MS` (5 min, in-memory fresh window), `CACHE_DURATION` → `STALE_PRICE_FALLBACK_MS` (24 h, on-disk fallback). Values unchanged.
- **Extract** `safeLocalStorage.get/set/setJSON` helper — the same try/catch is copied 4× in this file, once in `useAddressBook`, twice in `NetworkContext`, and 8× in `kraken.ts`. One helper, one home (`src/lib/storage.ts` — new, ~25 lines).

## 2. FX / fiat (`src/lib/fiat-currencies.ts`)

- **Bug:** `getAvailableFiatCurrencies` never re-fetches — the truthy check on `availableCurrenciesCache` shadows the intended `CURRENCIES_CACHE_DURATION` TTL. Gate it on `oracleAssetsCacheTimestamp` age like `getFxRate` already does.
- **Bug/noise:** `try { … } catch (error) { throw error }` inside `getFxRate` — remove the redundant re-throw, keep only the `finally`.
- **Dead param:** `network` on `getFxRate` / `convertFromUSD`. The FX oracle is mainnet-only (already commented in code) and the network suffix on the cache key just pollutes storage. Remove the parameter and update the two call sites in `AssetBalancePanel.tsx`.

## 3. Kraken (`src/lib/kraken.ts`)

- **Deduplicate.** `fetchFullYearForAsset` ≈ `fetchFullYearForFiatPair` (55 lines apart, differ only in pair list + `isReverse`). `ensureFreshAssetData` ≈ `ensureFreshFxData`. `getUsdRateForDateByAsset` ≈ `getHistoricalFxRate`. Collapse each pair into one generic internal helper parameterized on `{ pairs, loadCache, saveCache, getLastFetch, setLastFetch, transform }`. Public API unchanged.
- **Delete the v1→v2 migration** (`clearOldFxCaches`). It's a permanent one-shot for a schema that's already shipped.
- **Delete unused `_start` / `_end` params** on `primeUsdRatesForAsset` / `primeHistoricalFxRates`.
- **Remove the stray `console.debug`** at line 531 (still guarded by DEV, but the message is stale). Keep quiet.

Expected drop: 549 → ~280 lines, same behavior.

## 4. Reflector oracle client (`src/lib/reflector-client/oracle-client.ts`)

- **Extract simulate-and-decode** shared path from `getAssets` and `getLastPrice`. Each public method drops to ~15 lines of actual logic.
- **Kill both `as any`** casts on `resultValue` — narrow with the `in` checks already present in the block above.
- **Move the module-level rate-limiter state** (`__rpcTimestamps`, `__rpcQueue`) into a small class instance owned by the client. It's currently a global that leaks across the module and calls itself with double-underscore names for no reason — this reads as older debugging leftovers.

## 5. `useAssetPrices` hook

- Collapse the `balancesKey` + `useMemo(..., [balancesKey])` two-step into one `useMemo` returning the memoized array keyed on the join string.
- Return a stable `refetch` (already `useCallback`) — fine as-is, just verify no re-render loops after the collapse.

## 6. `AssetBalancePanel.tsx`

- Three `useState`s (`convertedTotalValue`, `convertedAssetValues`, `convertedAssetPrices`) become one `{ total, values, prices }` state — the effect already computes them together.
- Simplify `formatPriceSync` / `formatValueForAsset`: `converted[i] ?? usdValue` covers both branches, so the `quoteCurrency !== 'USD' &&` guard is redundant (the map is empty when USD).
- No visual change.

## 7. Contexts

- **`NetworkContext.tsx`** — extract `NETWORK_STORAGE_KEY` constant, use `safeLocalStorage`.
- **`FiatCurrencyContext.tsx`** — persist `quoteCurrency` to localStorage (via `safeLocalStorage`) so the user's selected quote survives reload. This *is* a small user-visible improvement but strictly additive; if you want zero UX drift I'll drop it. **Please confirm — otherwise I keep it.**

## 8. `useAddressBook.ts`

Lots of low-hanging fruit here, all safe:

- 10 `(op as any).xxx` casts → one `Payment | CreateAccount` narrow type at the top of the loop.
- The two empty `catch (error) {}` blocks in `useEffect` and `saveToStorage` — swallow *silently*, no comment needed, but keep the DEV-guarded log through the shared `safeLocalStorage` helper.
- The redundant `try { throw error } finally {}` around `syncPromise` — `finally` alone.
- `needsSync` is called eagerly on every render into `needsSync: needsSync()`; make it a `useMemo` so callers can rely on referential stability.

## 9. `useAccountHistory.ts`

Similar shape — 4 `as any` casts, a large hook that duplicates paging logic already present in `useAddressBook`. Only do the narrow types + shared paging helper if the extraction is <30 lines; otherwise leave alone. This is the one item I want to reserve judgment on until I see the file in build mode; if it needs a real refactor I'll flag and skip.

## 10. `stellar.ts`

- Delete the `// eslint-disable-next-line @typescript-eslint/no-explicit-any` above `try` in `fetchAccountData` — it's above the wrong statement and unused. Same in `submitTransaction`.
- The `error: any` narrows can become `error: unknown` with an `assertHorizonError` helper (~10 lines); this drops the two `any`s cleanly.

## 11. Global small stuff

- **`appConfig.MAINNET_SOROBAN_RPC === TESTNET_SOROBAN_RPC`** — both point to `rpc.lightsail.network`. Verified: the Lightsail endpoint auto-routes by network. Add a one-line comment saying so; no code change (avoids the next reader "fixing" it wrong).
- **`DEFAULT_BASE_FEE = 100`** in appConfig is unused; `DEFAULT_BASE_FEE_STROOPS = 100_000` is the only one referenced. Delete the former.
- **`public/sw.js`** — verify it's still registered from `service-worker.ts`; if not, that file is dead too. Check in build mode; delete if orphaned.
- **`src/lib/service-worker.ts`** — 11 lines of commented-out `console.warn` slow-resource block. Delete (git history is the archive).
- **`assets.ts` line 36** — `export const getAssetColor = generateAssetColor;` alias. Grep all call sites; if only one is used, keep that and drop the alias.

## 12. Verification checklist (run in order)

1. `tsgo` — zero errors.
2. Load app on mainnet: connect wallet → prices render → switch to EUR → refresh → switch to testnet → back to mainnet. No console output in production build.
3. Playwright: `tests/fiat-switching-comprehensive.spec.ts` still passes.
4. Devtools Network tab: exact same set of Reflector RPC + Kraken + Horizon requests as before the pass (no new ones, none removed).
5. Manual: build a payment tx, sign, submit to testnet. Manual: import an XDR via deep link. Manual: run through Airgap signer flow (open, scan a QR, sign).

## Explicitly deferred

- Splitting `TransactionBuilder.tsx` (1146 lines) / `SwapInterface.tsx` (624 lines) / `MultisigConfigBuilder.tsx` (660 lines) — worth doing but each is its own PR-sized effort and the split needs a design decision (by feature? by section?). Not part of "cleanup".
- Moving `SOROSWAP_API_KEY` / `DEFINDEX_API_KEY` behind a proxy — needs backend, out of scope.
- Test coverage expansion.
- Any UI or design work.

## Expected outcome

- ~600 net lines removed.
- Zero `as any` in `stellar.ts`, `oracle-client.ts`, `useAddressBook.ts`, `useAssetPrices.ts`.
- One `safeLocalStorage` helper, one Kraken OHLC fetcher, one FX-oracle passphrase (mainnet) documented in one place.
- `fiat-currencies.ts` 24 h TTL actually enforced.
- No user-visible changes except (optional, per §7) persisted fiat quote currency.

One question before I start: **do you want the fiat quote currency to persist across reloads?** Everything else is a pure cleanup with no user-facing effect.
