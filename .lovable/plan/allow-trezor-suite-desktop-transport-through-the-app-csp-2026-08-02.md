# Allow Trezor Suite desktop transport through the app CSP

## What is happening

Two distinct blocks appear in your log:

1. **Ours to fix.** Trezor Connect's suite-desktop path opens `ws://127.0.0.1:21335/connect-ws`. The app's `connect-src` policy is `'self' https: data: blob:`, which does not cover `ws:` or plain-`http:` loopback, so the browser blocks the socket before Trezor Suite is ever reached.
2. **Not ours.** After the websocket fails, Connect falls back to its hosted iframe, and that iframe (origin `connect.trezor.io`) tries `http://127.0.0.1:21328/` and `:21325/`. Chrome's Local Network Access rules deny that cross-origin loopback request. That happens entirely inside Trezor's own iframe — no CSP or code on our side controls it. It resolves on the user's machine by granting Chrome's local-network permission prompt for connect.trezor.io and keeping Trezor Suite/Bridge running.

Fixing (1) lets the direct Suite desktop websocket work, which is exactly the path Safe 7 needs, and avoids depending on (2) at all.

## Change

Update the CSP meta tag in `index.html`, `connect-src` only:

```text
connect-src 'self' https: wss: data: blob:
             ws://127.0.0.1:21335 ws://localhost:21335
             http://127.0.0.1:21325 http://127.0.0.1:21328
             http://localhost:21325 http://localhost:21328;
```

- `ws://127.0.0.1:21335` — Trezor Suite desktop connect websocket (the blocked one).
- `21325` / `21328` — legacy Trezor Bridge and the newer bridge HTTP ports, so a Bridge-only setup also works from our origin.
- Loopback only; no wildcard host is added and every other directive stays as-is.

## Verification

- App loads with no CSP warnings in the console.
- With Trezor Suite desktop running, clicking Trezor no longer logs the `ws://127.0.0.1:21335` violation and proceeds to the device account list. Final confirmation needs your physical Safe 7.
- If Suite is not running, the existing guidance message ("open Trezor Suite / install Bridge") is what the user sees.
