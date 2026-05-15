## Full-app review — findings and fixes

I audited the architecture (client-side React/Vite app, no backend; Stellar SDK + WalletKit + Refractor + Reflector + Soroswap/DeFindex; deep links; service worker). Below are concrete issues found and the fixes I'll apply in one batch. All changes are behavior-preserving except where called out as bug fixes.

### 1. Correctness bugs

- **`AccountOverview.handleSubmitToNetwork` is mocked** (returns `'mock-hash-' + Date.now()` after a fake 2s delay). Users get a fake "success" for multisig-config network submissions.
  - **Fix:** call the real `submitTransaction(multisigConfigXdr, currentNetwork)` (already imported pattern) and surface the real hash; on error show a destructive toast instead of swallowing.
- **`fetchAccountData` swallows non-404 errors** as a generic `"Failed to load account data from Horizon"`, hiding rate-limit / network info.
  - **Fix:** preserve the original error message for non-404 cases.
- **`submitTransaction` swallows Horizon error details** (`op_*` codes inside `extras.result_codes`).
  - **Fix:** extract `error.response?.data?.extras?.result_codes` and include in the thrown message; remove `: any` return.
- **`DeepLinkHandler` parses XDR by trying both passphrases but never switches the UI network** to match. If the user is on testnet but the deep-linked XDR is mainnet (or vice-versa), the import looks fine then signing/submission fails confusingly.
  - **Fix:** detect which passphrase parsed successfully and call `setNetwork(...)` accordingly (via context) before notifying parent.
- **`TransactionBuilder` uses `as any` on the SDK builder**, hiding type errors and making future Stellar-SDK updates dangerous.
  - **Fix:** remove the cast (the SDK's `TransactionBuilder` is fully typed).

### 2. Security & metadata

- **Duplicate / stale `<head>` tags in `index.html`:** a second block of `og:title`, `og:description`, `og:type`, `twitter:card` after the CSP meta overrides the canonical ones with weaker copy ("Stellar Multisig Wallet — Secure Multi-Signature Management"). Also `canonical` and `og:url` point to `https://stratum.app/` which is **not** the deployed domain (`stellar-stratum.xyz` / `stellar-stratum.lovable.app`).
  - **Fix:** remove the duplicate OG/Twitter block; update `canonical` + `og:url` to `https://stellar-stratum.xyz/`; update JSON-LD `url` to match.
- **CSP allows `'unsafe-eval'`** site-wide. Stellar-SDK does not require it; it's likely a leftover.
  - **Fix:** drop `'unsafe-eval'` from `script-src`. If a runtime regression appears I'll restore it (verified during build/QA).
- **`viewport` has `maximum-scale=1.0, user-scalable=no`** — accessibility issue (blocks pinch-zoom) and not needed.
  - **Fix:** remove those two tokens.

### 3. Production console silence (project core rule: console must be silent in prod)

Currently leaks logs in production from: `pages/Index.tsx` (3×), `pages/NotFound.tsx`, `lib/error-handling.ts`, `lib/xdr/fingerprint.ts` (2×), `lib/soroban-domains.ts`, `lib/horizon-utils.ts` (2×), `lib/kraken.ts` (1× debug), `components/AccountOverview.tsx`, `components/shared/ErrorBoundary.tsx`.

- **Fix:** wrap each `console.*` call (except `ErrorBoundary` which is already DEV-grade signal — gate it too) with `if (import.meta.env.DEV)` so they're stripped from production bundles. Keep messages identical for dev debugging.

### 4. Code quality / dead code

- Knip + manual review confirms these are still unused after the previous cleanup:
  - `AccountData` interface in `src/lib/stellar.ts` (the same shape is redeclared inline in `Index.tsx` and `TransactionBuilder.tsx`).
    - **Fix:** export and reuse `AccountData` from `stellar.ts` in both consumers — removes duplication and keeps a single source of truth.
  - shadcn ui orphans (`AlertTitle`, `badgeVariants`/`BadgeProps`, `CardFooter`, `DialogPortal/Overlay/Close/Trigger/Footer`, `SelectGroup/Label/Separator/ScrollUp/ScrollDownButton`, `ToastAction`, `Toggle`, `ButtonProps`, `CalendarProps`, `TextareaProps`).
    - **Decision:** **keep** these intact. Removing shadcn primitive sub-exports breaks the "drop-in shadcn" pattern and offers no runtime benefit (tree-shaken anyway). Documented as intentional.
- **`vite.config.ts` `manualChunks`** still references `qrcode.react` (removed package). Harmless but stale.
  - **Fix:** drop the `qrcode.react` reference (keep `qrcode`/`jsqr`/`@zxing`).
- **`TransactionBuilder` re-renders:** `loadPrices` effect depends on `memoizedBalances` which already memoizes by reference, but `assetPrices` are stored in state then read inside `estimatePathReceive` (closure), causing a stale-price risk for the destMin computation across rapid edits. Low impact because user re-clicks Build, but worth noting — **no code change** to avoid scope creep.

### 5. Performance

- `index.html` preconnects 5 origins. Good. No change.
- Lazy loading already in place for `AccountOverview` and `TransactionBuilder`. No change.
- `service-worker.ts`: `STATIC_ASSETS` includes `/favicon.ico` but the project ships `favicon.png`. The install step will reject the cache addAll silently in some browsers and skip future caching.
  - **Fix:** use `/favicon.png` (matches `index.html`).

### 6. Out of scope (surfaced, not changed)

- Path-payment slippage default of 0.5% with naïve price-ratio destMin (no DEX quote) — meaningful but a product/UX decision; not silently changing trade math.
- `TransactionBuilder` is 1100+ lines and could be split, but a refactor that big risks regressions; not in this batch.
- Replacing wrapped error sanitization across all call sites with `validation.sanitizeError` — broad change, deferred.

### Verification

- After edits: `bunx tsc -b --noEmit`, `vite build`, then manually load the app to confirm landing → connect → dashboard still renders, deep link with `?r=` still imports, network toggle switches.

### Files touched

`index.html`, `vite.config.ts`, `public/sw.js`, `src/lib/stellar.ts`, `src/lib/service-worker.ts`, `src/lib/xdr/fingerprint.ts`, `src/lib/soroban-domains.ts`, `src/lib/horizon-utils.ts`, `src/lib/kraken.ts`, `src/lib/error-handling.ts`, `src/components/AccountOverview.tsx`, `src/components/DeepLinkHandler.tsx`, `src/components/TransactionBuilder.tsx`, `src/components/shared/ErrorBoundary.tsx`, `src/pages/Index.tsx`, `src/pages/NotFound.tsx`.
