## Goal

Bring every dependency to its latest version and adapt the codebase to the breaking changes. The biggest item is **Stellar Wallets Kit v1 → v2** (a full rewrite). The rest is mostly version bumps + a couple of small type fixes.

---

## 1. Stellar Wallets Kit v1.9.5 → v2.1.0 (breaking)

The package itself moved. v2 is published on **JSR** under `@creit-tech/...` (dash) instead of `@creit.tech/...` (dot). Tansu uses the same setup we'll use:

```json
"@creit-tech/stellar-wallets-kit": "npm:@jsr/creit-tech__stellar-wallets-kit@^2.1.0"
```

Other v2 changes affecting our code:

- **Subpath imports** (no more single barrel):
  - `@creit-tech/stellar-wallets-kit/sdk` → `StellarWalletsKit`
  - `@creit-tech/stellar-wallets-kit/modules/utils` → `defaultModules`, `allowAllModules`, `sep43Modules`
  - `@creit-tech/stellar-wallets-kit/modules/ledger` → `LedgerModule`
  - `@creit-tech/stellar-wallets-kit/modules/walletconnect` → `WalletConnectModule`, `WalletConnectAllowedMethods`
  - `@creit-tech/stellar-wallets-kit/modules/trezor` → `TrezorModule`
  - `@creit-tech/stellar-wallets-kit/state` → types like `ISupportedWallet`, `WalletNetwork`
- **Singleton API**: `StellarWalletsKit` is no longer instantiated with `new`. Use `StellarWalletsKit.init({ modules: [...] })` once at module load (Tansu pattern).
- `openModal` was removed → replaced by `authModal()` (returns the picked wallet/address as a promise).
- Network is set per-call via `signTransaction(xdr, { networkPassphrase, address })` rather than baked into the constructor; we need to pass `networkPassphrase` from our `NetworkContext` whenever we sign.
- New `subscribe(...)` event API exists; we don't need it — current code only reads address on demand.

### Refactor of `src/contexts/WalletKitContext.tsx`

- Move kit creation to a tiny module `src/lib/walletKit.ts` (mirrors Tansu's `stellar-wallets-kit.ts`):
  ```ts
  import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk';
  import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils';
  import { LedgerModule } from '@creit-tech/stellar-wallets-kit/modules/ledger';
  import { WalletConnectModule, WalletConnectAllowedMethods } from '@creit-tech/stellar-wallets-kit/modules/walletconnect';
  import { TrezorModule } from '@creit-tech/stellar-wallets-kit/modules/trezor';

  const modules: any[] = [...defaultModules(), new LedgerModule()];
  // optional WalletConnect / Trezor pushed exactly as today
  StellarWalletsKit.init({ modules });
  export { StellarWalletsKit };
  ```
- The provider becomes a thin wrapper:
  - `wallets`: from `StellarWalletsKit.getSupportedWallets()` (still async, same API)
  - `connectWallet(id)`:
    - `StellarWalletsKit.setWallet(id)`
    - `const { address } = await StellarWalletsKit.getAddress();`
    - For Freighter etc. v2 may throw if `authModal` was never used; we keep the existing try/catch around `connect()` and handle the error path by calling `StellarWalletsKit.authModal()` as a fallback for wallets that need explicit auth.
  - `signWithWallet(xdr, id)`:
    - `StellarWalletsKit.setWallet(id)`
    - `await StellarWalletsKit.signTransaction(xdr, { networkPassphrase: getNetworkPassphrase(network), address })`
    - The Ledger fallback (calling `selectedModule.signTransaction` directly) is no longer needed — v2 routes signing through the module correctly. We can drop `signWithLedgerModule`.
  - `disconnectWallet()`: call `StellarWalletsKit.disconnect()` (new in v2) then clear local state.
- Network change effect: just re-fetch the wallet list; passphrase is now passed at signing time, no kit re-creation.

### Type imports in consumers

- `src/components/WalletConnect.tsx` and `src/components/SignerSelector.tsx`:
  ```ts
  import type { ISupportedWallet } from '@creit-tech/stellar-wallets-kit/state';
  ```

---

## 2. Other dependency upgrades

Bumping to the current latest on npm (verified via `npm view`):

| Package | From | To |
|---|---|---|
| `@stellar/stellar-sdk` | `^14.6.1` | `^15.0.1` |
| `@tanstack/react-query` | `^5.100.5` | `^5.100.9` |
| `@soroswap/sdk` | `^0.4.0-alpha.1` | `^0.4.0` |
| `@defindex/sdk` | `^0.3.0-alpha.1` | `^0.3.0` |
| `lucide-react` | `^1.11.0` | `^1.14.0` |
| `recharts` | `^3.8.1` | `^3.8.1` (already latest) |
| `react-day-picker` | `^9.14.0` | `^9.14.0` (already latest) |
| `tailwindcss` | `^4.1.18` | `^4.2.4` |
| `eslint` | `^9.39.2` | `^10.2.1` |
| `vite` | `^8.0.10` | `^8.0.10` (already latest) |
| All Radix `@radix-ui/*` | current | latest minor (`npm view` per-package, then bump) |

`@stellar/stellar-sdk` v15 is API-compatible with our usage (`Horizon.Server`, `TransactionBuilder.fromXDR`, `Networks.*`) — Tansu also runs on 15.0.1. No code changes expected; if a deprecation surfaces during `tsc -b`, fix in place.

`@creit.tech/sorobandomains-sdk` (`^0.1.6`) — already latest, kept as-is. Note this still uses the dot package; that's a separate library.

---

## 3. Build error fix in `vite.config.ts`

Vite 8 / Rollup 4 tightened the `manualChunks` types when `output` is an object. Fix without changing behaviour by switching to the function form (this is the recommended Rollup 4 idiom):

```ts
output: {
  manualChunks(id) {
    if (id.includes('react-dom') || id.match(/\/node_modules\/react\//)) return 'vendor';
    if (id.includes('@stellar/stellar-sdk') || id.includes('node_modules/buffer/')) return 'stellar';
    if (id.includes('stellar-wallets-kit')) return 'wallets';
    if (id.includes('qrcode') || id.includes('jsqr') || id.includes('@zxing')) return 'qr';
    if (id.includes('@radix-ui')) return 'ui';
    if (id.includes('@tanstack/react-query')) return 'query';
    if (id.includes('recharts')) return 'charts';
    if (id.includes('clsx') || id.includes('class-variance-authority') || id.includes('date-fns')) return 'utils';
  },
},
```

This satisfies the `ManualChunksFunction` type that the new build complains about and produces the same chunks.

---

## 4. Files to change

- `package.json` — version bumps + wallets-kit JSR alias.
- `src/lib/walletKit.ts` — new singleton init module.
- `src/contexts/WalletKitContext.tsx` — refactor to use the singleton + v2 API.
- `src/components/WalletConnect.tsx` — update `ISupportedWallet` import path.
- `src/components/SignerSelector.tsx` — update `ISupportedWallet` import path.
- `vite.config.ts` — `manualChunks` as a function.
- `bun.lock` — regenerated by install.

No changes needed in `src/lib/walletConfig.ts`, `src/lib/stellar.ts`, `src/lib/soroban-domains.ts` (uses sorobandomains-sdk, not wallets-kit).

---

## 5. Verification

After install:
1. `tsc -b` passes (the harness will run the build).
2. Landing page → "Connect wallet" lists Freighter/xBull/Ledger/Lobstr/Hot/Albedo as today.
3. Connect with Freighter end-to-end on testnet (smoke test by user).
4. Sign a transaction (multisig flow) — confirms the new `signTransaction({ networkPassphrase, address })` path.
5. Hardware wallet (Ledger) modal still opens — uses kit's built-in modal in v2.
