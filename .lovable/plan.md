# Wallet support, clean signing, account creation fix, Soroban Domains removal

## 1. Fix "creating a wallet" (funding a new account) transactions

Confirmed issues in `src/components/TransactionBuilder.tsx`:

- The **batch/bundle path** (any payment added via "Add Operation", and every multi-op bundle) always emits `Operation.payment`. Sending XLM to an unfunded address that way fails on-chain with `op_no_destination`. Only the single-payment path checks existence and switches to `Operation.createAccount`.
- `checkAccountExists` calls `ErrorHandlers.accountNotFound(...)` whenever the destination is not found, so a perfectly valid account-creation flow pops a red "account not found" error toast.

Fix:

- Extract a single `resolveDestinationKind(destination)` helper (exists / does not exist) with no side-effect toast, and use it for both the single and batch payment paths.
- In the batch loop, emit `Operation.createAccount({ destination, startingBalance: amount })` when the destination does not exist, and keep `Operation.payment` otherwise.
- Apply the same guards per batch operation as the single path: non-XLM assets to a non-existent account are rejected with a clear message, and the starting balance must cover the minimum reserve.
- Only surface an error toast for genuine lookup failures (network errors), not for "account does not exist".

## 2. Wallet support and ordering

`src/lib/walletKit.ts`

- Add `TrezorModule` (already bundled with the wallets kit; the project already has the Buffer polyfill it requires) alongside the existing Ledger module, configured with the app name/URL/contact manifest Trezor Connect requires.
- ForDefi is already included by `defaultModules()`, so no new module is needed — only placement.

Ordering (used by `src/contexts/WalletKitContext.tsx` sort and `src/components/WalletConnect.tsx` display):

```text
xBull, Trezor, Ledger          <- primary (visible)
Lobstr, HOT, Albedo, ForDefi, Freighter   <- "See more wallets"
```

- xBull above Freighter, Trezor above Ledger, ForDefi in "see more", Freighter last.
- Trezor gets the existing hardware-wallet handling in `WalletConnect` (modal close/reopen, setup tooltip) — that code already keys off `trezor`.

## 3. Clean signing (send the transaction, not just the hash)

`src/contexts/WalletKitContext.tsx`

- Ledger's module supports `nonBlindTx: true`, which signs the transaction's signature base (device shows the operations) instead of a blind hash. Pass it through for Ledger/Trezor-style hardware signing.
- Fall back automatically to hash signing if the device rejects the full-transaction payload (Soroban or oversized transactions cannot be clear-signed on-device), so nothing that works today stops working.

## 3b. Always reset the hardware connection before signing

Today the kit caches the transport and the derivation path (`mnemonicPath` / `hardwareWalletPaths`), so a second signature reuses whatever account was picked the first time — with no chance to choose a different path.

In `signWithWallet`, when the selected wallet is Ledger or Trezor:

- Close the existing connection first (Ledger module's `disconnect()` closes the WebUSB transport; Trezor Connect is torn down the same way) and clear the cached path/address state.
- Re-open the wallet's account-selection step so the user is prompted for the derivation path on every signature.
- Sign with the freshly selected path, and verify the returned signer address matches the signer the user chose — mismatch shows a clear toast instead of silently attaching the wrong signature.

This runs on every hardware signature, not just the first.


## 4. Remove Soroban Domains completely

Delete `src/lib/soroban-domains.ts`, drop `@creit.tech/sorobandomains-sdk` from `package.json`, remove `SOROBAN_DOMAINS` from `src/lib/appConfig.ts`, and remove `isValidDomain` from `src/lib/validation.ts` once unused.

Call sites to clean:

- `src/components/WalletConnect.tsx` — remove the "Soroban Domains" connect card, its state and handler.
- `src/components/payment/PaymentForm.tsx` — destination becomes address-only: drop domain resolution, suggestions dropdown, and domain-aware validation/labels.
- `src/components/AddressAutocomplete.tsx` — drop domain resolution, spinner, and the "Domain" badge in suggestions.
- `src/components/SourceAccountSelector.tsx` — drop domain resolution and the "Resolves to / Use Address" block.
- `src/hooks/useAddressBook.ts` — drop the `sorobanDomain` field and its search branch.
- Remove the now-unused Soroban Domains logo asset reference.

## Verification

Type check plus a headless run of the payment form: build a payment to an unfunded testnet address (single and bundled) and confirm the XDR contains `createAccount`, and that the wallet list renders in the requested order with no Soroban Domains entry.
