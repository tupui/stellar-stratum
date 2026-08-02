# Fix Trezor account connection

## Diagnosis

The CSP message is only a browser warning: `frame-ancestors` has no effect in a meta-delivered policy. Trezor Connect itself initializes successfully, as confirmed by `Trezor is ready`.

The actual failure is in the account flow. `connectWallet` calls the kit's `fetchAddress()` immediately. The installed Trezor module requires a selected mnemonic path before `getAddress()` can run and throws `No mnemonic path has bee selected.` when none exists. Unlike the kit's built-in hardware flow, the app's custom wallet UI never calls `getAddresses()` and lets the user select an account before requesting the address.

## Changes

1. **Use the hardware account flow during connection**
   - Detect Ledger and Trezor in `connectWallet`.
   - Disconnect any stale hardware transport first, then call the selected module's `getAddresses(0)`.
   - Open the existing account picker and return the selected account's public key instead of calling path-dependent `fetchAddress()`.
   - Keep the current direct `fetchAddress()` behavior for extension and web wallets.

2. **Make the account picker reusable and lifecycle-safe**
   - Reuse one helper for both initial hardware connection and signing.
   - Give the dialog context-appropriate copy for connecting versus signing.
   - Ensure cancel, errors, and completion always clear the pending resolver and picker state so subsequent attempts cannot hang.

3. **Keep signing consistent with the selected account**
   - Continue the mandatory disconnect/reconnect before every Ledger/Trezor signature.
   - Pass the exact derivation path corresponding to the account selected for that signing attempt.
   - Preserve clean transaction signing with the existing fallback behavior.

4. **Remove the misleading CSP warning**
   - Remove only `frame-ancestors` from the meta CSP because browsers ignore it there; retain the `connect.trezor.io` frame permission.
   - Document that clickjacking protection must be delivered as an HTTP response header by hosting, not by HTML meta.

## Verification

- Confirm non-hardware wallet connection remains unchanged.
- Confirm clicking Trezor opens device access, fetches the first ten Stellar derivation accounts, displays the account picker, and connects with the chosen public key without calling pathless `fetchAddress()`.
- Confirm cancelling and retrying does not leave a spinner or stale promise.
- Confirm signing prompts for account selection again and uses the matching derivation path.
- Run the existing targeted checks/build and verify the production console no longer emits the meta CSP warning; final device approval must be verified with a physical Trezor.