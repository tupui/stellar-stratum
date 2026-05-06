## Goal

Architect-level pass over the repo. Remove dead code, unused dependencies, dead config, and stale logic. Fix small but real bugs found during the review. Do **not** change anything that currently works (wallet flows, multisig, swap, defindex, history caching, deep links, airgap signer).

## Findings & fixes

### 1. Dead/empty source files

- `src/lib/orderbook-pricing.ts` — empty (0 bytes), no imports anywhere. **Delete.**
- `src/hooks/useFiatConversion.ts` — only `formatFiatAmount` is used (in `TransactionHistoryPanel`); `convertXLMToFiat`, `exchangeRate`, `isLoading`, `error` are dead. The hook also re-fetches `getFxRate` on every mount which duplicates work `convertFromUSD` already does. **Replace** the only consumer with a small inline `formatFiatAmount` (or move that pure helper into `src/lib/fiat-currencies.ts`) and delete the hook file.
- `src/lib/service-worker.ts` → `preloadCriticalResources()` prefetches hard-coded chunk paths (`/assets/vendor.js`, `/assets/stellar.js`, `/assets/ui.js`) that **do not exist** — Vite emits hashed names. The `<link rel="prefetch">` tags 404 in production. Remove `preloadCriticalResources` entirely and the call from `main.tsx`. Keep `registerServiceWorker` and `trackPerformance` (the latter is dev-only logging, harmless). `clearAppCaches` is unused → delete.
- `src/lib/reflector.ts` → `createAssetObject` and `resolveOracleAndAsset` are dead (replaced by `findAssetInMapping`). Delete both.

### 2. Unused npm dependencies

Verified by `rg` across `src/`:

- `react-hook-form` — zero imports. Remove from `package.json`.
- `react-day-picker` — only imported by `src/components/ui/calendar.tsx`, which is itself unused (only `TransactionHistoryPanel` imports it via the date filter — confirm; if used, keep both; if not, drop both). Recheck: `Calendar` **is** imported by `TransactionHistoryPanel`. Keep `react-day-picker` and `calendar.tsx`.
- All other deps verified in use.

### 3. Unused shadcn UI components

- `src/components/ui/sheet.tsx` — zero imports. Delete (and drop `@radix-ui/react-dialog`-only? no, dialog is used elsewhere, keep that dep).

All other UI files (`toggle`, `toggle-group`, `popover`, `calendar`, `skeleton`, `slider`, `switch`, `tabs`, `textarea`, `collapsible`, `tooltip`, `alert`, `checkbox`) have at least one consumer — keep.

### 4. Dead `appConfig` keys

`LAB_BASE`, `PRICE_REFETCH_INTERVAL`, `MAX_OPERATIONS_PER_TX` have **zero usages**. Delete from `src/lib/appConfig.ts`.

### 5. Hardcoded API keys in source

`SOROSWAP_API_KEY` and `DEFINDEX_API_KEY` are committed in plaintext in `src/lib/appConfig.ts`. They look like public/publishable keys (used directly from the browser SDKs), but a real principal-engineer review would call them out:

- Confirm with the user whether these are meant to be public. If yes, add a comment marking them as "public client key — safe to ship". If not, move them to env vars (`import.meta.env.VITE_*`) and rotate.
- Plan default: **leave values in place** (the app is client-side only and they're already shipped to every user via the bundle), but add a comment + rotate-instructions note. No silent change.

### 6. Bugs / bad logic

a. **`useFiatConversion.convertXLMToFiat` is wrong twice over** — calls `getAssetPrice('XLM')` (a 5-min-cached oracle call) on every conversion and ignores the network passed into the context. Since the function is unused after fix #1, removal solves it.

b. **Race in `FiatCurrencyContext.getCurrentCurrency`** — returns `availableCurrencies.find(...) || availableCurrencies[0]`. While the async `loadCurrencies` is in-flight `availableCurrencies` is `[USD]`, then it's replaced; if the user picks a non-USD currency before it loads we hand back USD silently. Low risk in practice (USD is selected by default), but fix by initializing with the static `CURRENCY_INFO` keys instead of `[USD]` so the dropdown is populated immediately and only gets pruned to oracle-supported currencies after load. Falls back to USD on error as today.

c. **`fiat-currencies.ts` ignores `network` for cache key in `getAvailableFiatCurrencies`** — `availableCurrenciesCache` is a single global, but the function takes a `network` param. If a user switches networks the cache wins and may be wrong. Either drop the param (FX oracle is mainnet-only here) or key the cache by network. Drop the param since every call site uses the default.

d. **`AccountOverview.tsx` line 10 / 27 imports `Select`/`useNetwork` etc. that are unused** — quick `noUnusedLocals` sweep. Run a lint pass and clean dead imports across `AccountOverview`, `TransactionBuilder`, `PaymentForm`, `TransactionHistoryPanel` only (the four largest files).

e. **`TransactionHistoryPanel.tsx`** still imports `useFiatConversion` only for `formatFiatAmount`; after fix #1 that helper lives in `fiat-currencies.ts`. Update the import.

f. **`reflector.ts` request dedup map leak** — `inflightPriceRequests` is cleaned in `finally`, good. But `oraclePriceCache` is module-scope and never bounded; over a long session with many issued assets it grows unbounded. Add a soft cap (e.g. drop entries older than 1h on insert when size > 200). Tiny change, prevents memory creep.

g. **`Index.tsx` deep-link branch trusts `sessionStorage.getItem('deeplink-source-account')` without validating** that it is a valid Stellar address. If sessionStorage is corrupted, `fetchAccountData` will throw and the user falls back to the connect screen — acceptable today but worth a `StrKey.isValidEd25519PublicKey` guard before fetching. Add it.

### 7. Tests

`tests/fiat-switching-comprehensive.spec.ts` is the only Playwright spec and depends on a live network. Leave as-is; no change.

### 8. Console noise

Production silence is a memory rule. After review only the following remain:
- `console.error` in error-handling (intentional, dev path)
- `console.log` in `SoroswapTab.tsx` lines 573/575 — **remove**, these are debug prints.
- `console.warn` in `horizon-utils.ts` for invalid dates — keep (legit data-quality warning) but gate behind `import.meta.env.DEV`.

## Out of scope

- No changes to caching strategy in `kraken.ts` / `reflector.ts` beyond the small dedup-map cap.
- No refactor of `TransactionBuilder.tsx` / `PaymentForm.tsx` business logic.
- No new features, no UI polish beyond removing dead imports.

## Files touched

Delete: `src/lib/orderbook-pricing.ts`, `src/hooks/useFiatConversion.ts`, `src/components/ui/sheet.tsx`.

Edit: `src/lib/service-worker.ts`, `src/main.tsx`, `src/lib/reflector.ts`, `src/lib/fiat-currencies.ts`, `src/contexts/FiatCurrencyContext.tsx`, `src/lib/appConfig.ts`, `src/components/history/TransactionHistoryPanel.tsx`, `src/components/soroswap/SoroswapTab.tsx`, `src/lib/horizon-utils.ts`, `src/pages/Index.tsx`, `src/components/AccountOverview.tsx`, `src/components/TransactionBuilder.tsx`, `src/components/payment/PaymentForm.tsx`, `package.json`.

## Verification

1. `tsc --noEmit` clean.
2. Smoke (Tansu mainnet via Soroban Domains): connect, view balances, switch USD↔EUR↔GBP, open Activity, open transaction builder (payment + swap + multisig tabs), open airgap signer route, scan-import flow surfaces correctly.
3. Network tab: no 404s for `/assets/*.js` prefetch links anymore.
4. Bundle size strictly smaller (no functional additions).
