# Fix Trezor Safe 7 connection ("not supported by Connect Popup")

## What is happening

This is not a bug in the app's account flow — it is Trezor's own policy. Verified in the installed libraries:

- The wallet kit's Trezor module starts Trezor Connect with `coreMode` defaulting to `auto` (our code passes no `coreMode`).
- In `@trezor/connect-web` 9.7.2, `auto` first tries the local Trezor Suite desktop connection, then the hosted iframe, and finally falls back to **core-in-popup** when the iframe reports `Transport_Missing` / blocked.
- Trezor blocks Safe 7 and newer devices in core-in-popup, which produces exactly the message you saw.

So the connection lands in the one mode Safe 7 refuses. Safe 7 works only when the core runs locally: Trezor Suite desktop running, or the hosted iframe with a working WebUSB/Bridge transport.

## Changes

1. **Pin the core mode away from the popup** in `src/lib/walletKit.ts`
   - Pass `coreMode: 'auto'` explicitly and enable WebUSB transport so the iframe path can talk to the device directly.
   - Keep the existing manifest and `lazyLoad`.
   - Because the popup fallback is what rejects Safe 7, prefer the suite-desktop → iframe route and never end in core-in-popup.

2. **Give a real error instead of a dead end** in `src/contexts/WalletKitContext.tsx`
   - Detect the Trezor transport/popup errors (`Transport_Missing`, `Init_IframeBlocked`, "not supported by Connect Popup") and surface a clear message: open Trezor Suite (desktop) or install Trezor Bridge, then retry.
   - Keep the current cancelled / no-device messages.

3. **Document the requirement in the wallet picker**
   - Small helper line under the Trezor entry: "Safe 7 requires Trezor Suite running."

## Technical notes

- WebUSB requires the page to be served over HTTPS and the browser to expose `navigator.usb` (Chrome/Edge/Brave; not Firefox/Safari). On unsupported browsers the honest outcome is the guidance message, not a silent popup fallback.
- No change to the derivation-path picker, signing flow, or non-hardware wallets.
- Upgrading `@trezor/connect-web` to 9.7.3 does not change this: the Safe 7 popup restriction is a Trezor product policy, not a version bug. No dependency override is proposed.

## Verification

- App builds and the wallet modal still lists Trezor.
- Extension/web wallet connection unchanged.
- With Trezor Suite running, clicking Trezor should reach the device and return the ten Stellar accounts; without it, the user sees the actionable guidance message instead of the popup rejection. Final confirmation needs your physical Safe 7.
