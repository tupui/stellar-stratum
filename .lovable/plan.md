# Trezor wallet icon + curated USDC / EURC / BLND asset icons

## 1. Trezor icon

Today `getWalletIcon` in `src/components/WalletConnect.tsx` shows the official
Ledger PNG (`/ledger-logo.png`) for Ledger and a generic USB glyph for Trezor.

- Add an official Trezor logo image to `public/trezor-logo.png` (same treatment
  as Ledger: served from `public/`, referenced by literal path).
- Branch on `trezor` in `getWalletIcon` and render it with the same sizing and
  `onError` fallback to the USB glyph, so nothing regresses if the file fails.
- Remove the now-unused `src/assets/ledger-logo-official.svg` (nothing imports
  it; the app uses the `public/` PNG).

## 2. Asset icons for USDC, EURC, BLND

`src/lib/assets.ts` already has an `ASSET_FALLBACKS` map that short-circuits
before any TOML fetch. It contains USDC and EURC pointing at third-party IPFS
gateway URLs (`stellar.myfilebase.com`), which is why they render
inconsistently, and has no BLND entry at all.

Changes, mirroring what the Wallet Aggregator Hub project does with its curated
icon registry:

- Keep the curated-first ordering (`ASSET_FALLBACKS` checked before TOML), but
  make the three entries keyed by `CODE:ISSUER` on mainnet issuers:
  - USDC `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
  - EURC `GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2`
  - BLND `GDJEHTBE6ZHUXSWFI642DCGLUOECLHPF3KSXHPXTSTJ7E3JF6MQ5EZYY` (new)
- Point each at a locally bundled image instead of a remote gateway, so the
  icons never depend on an issuer CDN, IPFS gateway, or CORS policy:
  `public/images/assets/usdc.png`, `eurc.png`, `blnd.png`.
- Leave every other asset on the existing TOML path untouched, and leave the
  24h caching, in-flight dedup, and `resolveImageUrl` logic as-is.

## 3. Trezor connection failure

Trezor Connect works by loading an iframe/popup from `https://connect.trezor.io`.
The CSP meta tag in `index.html` currently allows only
`frame-src 'self' https://hot-labs.org`, so that iframe is blocked outright and
the connect call never resolves — this is the most likely cause of "Trezor
connection does not work".

- Add `https://connect.trezor.io` to `frame-src` (and keep everything else in
  the CSP as-is).
- Surface the real failure instead of swallowing it: in
  `WalletKitContext.connectWallet`, the hardware branch rewrites some errors but
  otherwise wraps them; add a dev-only log of the underlying error and a
  clearer message when the Trezor popup/iframe is blocked or closed.
- Re-check the Trezor module init in `src/lib/walletKit.ts` (manifest fields are
  already set) and confirm the `@trezor/utils/libESM/bigNumber` alias shim still
  resolves after the change.
- Because a physical device cannot be exercised in the sandbox, verification is
  limited to: the connect modal listing Trezor, the Trezor Connect iframe/popup
  actually loading (no CSP violation in the console), and no unhandled errors.
  Final confirmation of a full device connect is on your side.

## 4. Memory note

Project memory currently says "only XLM metadata is hardcoded; all other assets
must use TOML fetching". This change intentionally widens that to a small
curated set (USDC, EURC, BLND) because those issuers do not publish a usable
SEP-1 image. The memory entry will be updated to reflect the new rule.

## Technical notes

- Files touched: `src/components/WalletConnect.tsx`, `src/lib/assets.ts`,
  `index.html` (CSP), `src/contexts/WalletKitContext.tsx`, new images under
  `public/`, deletion of the unused Ledger SVG.

- No changes to wallet connection logic, signing, pricing, or caching.
- Verification: build + type check, and a Playwright pass on the connect modal
  and a balance list containing USDC/EURC/BLND to confirm the icons render.
