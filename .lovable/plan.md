## Bug

When editing the multisig configuration in `AccountOverview`, clicking **Sign** in the `SignerSelector` does nothing.

Root cause: `src/components/AccountOverview.tsx` (lines 540–543) wires `onSignWithSigner` to an **empty function** with only a placeholder comment ("Signing functionality integrated with TransactionBuilder"). The wallet is never invoked, no signature is added, no error is shown — silent no-op.

The equivalent flow in `TransactionBuilder.tsx` (`handleSignWithSigner`, line 611) properly calls `signWithWallet`, verifies the returned address matches the chosen signer, updates the XDR, and pushes to `signedBy`.

## Fix

In `AccountOverview.tsx`, replace the stub `onSignWithSigner` with a real handler that mirrors `TransactionBuilder`'s implementation, operating on `multisigConfigXdr`:

1. Pull `signWithWallet` from `useWalletKit()` (add to existing import/destructure if not already present).
2. Add an `isSigning` state if not already managed (it's referenced on line 544 — verify and wire if missing).
3. Implement the handler:
   - Guard on `multisigConfigXdr`.
   - `setIsSigning(true)`, call `signWithWallet(multisigConfigXdr, walletId)`.
   - Verify `address === signerKey`; if not, throw a descriptive error.
   - `setMultisigConfigXdr(signedXdr)` and append to `signedBy`.
   - Toast success / failure.
   - `finally` clear `isSigning`.

This is a small, surgical change — no other components are affected. The existing `onSigned` callback on the same `SignerSelector` (lines 530–534) already handles the free/air-gapped path correctly and stays untouched.

## Verification

- Load tansu account on mainnet via Soroban Domains.
- Open multisig edit, modify a signer/threshold, build XDR.
- Click Sign with a connected wallet → expect the wallet popup, the signature pill to appear, and weight to advance.
- Confirm wrong-account selection surfaces the address-mismatch toast instead of silently failing.

## Files

- `src/components/AccountOverview.tsx` — replace stub handler, ensure `signWithWallet` and `isSigning` are wired.
