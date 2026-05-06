## Issue

[#16](https://github.com/tupui/stellar-stratum/issues/16): Stellar protocol allows the source and destination of a payment to be the same address (other wallets permit it, e.g. for testing/self-transfers). Stratum currently blocks it with a hard validation error.

## Root cause

`src/components/payment/PaymentForm.tsx` has three guards that prevent self-payments:

- **Line 723–725** (`isFormValid`): early-returns `false` when `destination === accountPublicKey`, disabling the Build button.
- **Line 1082–1087**: renders a destructive Alert "Source and destination addresses cannot be the same."
- **Line 486** (merge flow) and **line 732** (`willCloseAccount` branch) and **line 1233** (Merge button visibility): correctly block account-merge to self — **these must stay**, since merging an account into itself is invalid at the protocol level (and already toasted at line 365 of `TransactionBuilder.tsx`).

## Fix

In `src/components/payment/PaymentForm.tsx`:

1. Remove the `destination === accountPublicKey` early-return in `isFormValid` (lines 722–725) so a regular payment to self is buildable.
2. Remove the destructive Alert block at lines 1081–1087.
3. Leave all merge-related guards intact (lines 486, 732, 1233) — self-merge stays blocked.

No other components reference these checks; the Stellar SDK and Horizon will accept the resulting payment op.

## Files

- `src/components/payment/PaymentForm.tsx`
