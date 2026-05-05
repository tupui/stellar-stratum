## Fixes

### 1. Activity transaction list rates not updating

**Where:** `src/components/history/TransactionHistoryPanel.tsx`

**Issue:** USD amounts are computed once per transaction set and cached against `lastTransactionIdsRef`. When the user switches asset / fiat or new prices arrive, `usdAmounts` is not recomputed because `hasNewTransactions` is false, so the FX step has stale (often zero) inputs and the list shows wrong/empty fiat. The fallback FX rate is also inverted vs Kraken convention, producing wrong values when historical rates miss.

**Fix:**
- Drop the "skip if no new tx ids" guard so the USD step re-runs whenever transactions, selected asset filter, or network change. Keep the prime-once optimization by only re-priming Kraken caches for assets we have not seen yet (track in a ref).
- When `getUsdRateForDateByAsset` returns 0 for a recent date, fall back to the live oracle price already used in `useAssetPrices` rather than zero.
- Use `getFxRate` consistently: `getFxRate` returns USD-per-target, so `targetAmount = usdAmount / fxRate`. Remove the `1 / fallbackFxRate` inversion that conflicts with `convertFromUSD`. Verify against `useFiatConversion` so chart, list, and totals all use the same convention.
- Show a small `LoadingPill` per row while `fiatLoading` is true instead of a stale "0".

### 2. Operation Thresholds badge order in multisig

**Where:** `src/components/AccountOverview.tsx` (lines 354–376) and the matching read-only display in `MultisigConfigBuilder` if any.

**Issue:** Badges currently render `{currentWeight}/{threshold}` (e.g. `0/M`). The user wants `{required}/{have}` style — i.e. how many more weights are needed vs the M signers we have. Today the order is confusing because the left number is "have" and right is "required" but the visual reads as a fraction.

**Fix:** Render as `Required {threshold} · Have {currentWeight}` with two distinct chips (or swap the order to `{threshold}/{currentWeight}` with a tooltip "required / available"). Apply the same change anywhere `{currentWeight}/{requiredWeight}` is shown for clarity (`SignerSelector` line 172, `TransactionSubmitter`). Color the badge green only when `have >= required`.

### 3. Merge Account button on Payment ops

**Where:** `src/components/payment/PaymentForm.tsx` (`canCloseAccount`, button at line 1221, `handleMergeAccount` line 484, build path line 755).

**Issue:** `canCloseAccount()` returns true whenever the account has only XLM (no other trustlines), regardless of whether the user has actually entered an amount that drains the account or whether a valid destination exists. Clicking with an unset/invalid destination crashes downstream when `accountMerge` is built with empty strings.

**Fix:**
- Only render the Merge Account button when ALL of:
  - source account has zero non-XLM trustlines AND no other planned outflows would leave residue,
  - a valid destination is entered (`isValidStellarAddress(paymentData.destination)`) and it differs from `accountPublicKey`,
  - the destination account exists on-chain (`recipientExists === true`),
  - selected asset is XLM and no path-payment / receiveAsset is selected.
- In `handleMergeAccount` and `handleBuild` (line 755), guard against empty destination — if invalid, show a toast instead of calling `onBuild`. Wrap the merge build in a try/catch surfaced via the existing error toast so a malformed XDR never crashes the page.
- Add a tooltip on the disabled state explaining why it is unavailable.

### 4. Wallet logos cropped / padding

**Where:** `src/components/WalletConnect.tsx` (`getWalletIcon`, lines 71–95 and the wrapping `<div className="w-8 h-8 flex items-center justify-center">` at lines 385/420/457).

**Issue:** Some wallet icons (Ledger SVG, Soroban Domains) are full-bleed inside a fixed 32×32 box that sits flush against the bottom of a 56–64 px row, so glyphs touch the row border.

**Fix:** Bump the icon container to `w-9 h-9` with `p-1` (or wrap each `<img>` in `object-contain p-0.5`), and ensure the row's flex alignment is `items-center` (it already is) but add `py-2` inside the button so the icon never touches the bottom edge. Verify Ledger PNG and Soroban Domains PNG render with consistent padding across mainnet/testnet panes.

## Verification

Use Tansu account on mainnet (`https://github.com/Consulting-Manao/tansu`) connected via Soroban Domains:
1. Open Activity tab — confirm fiat amounts populate, switch USD ↔ EUR ↔ GBP and confirm values recompute correctly.
2. Open Multisig tab — confirm threshold badges read naturally (required vs have).
3. Build a payment — confirm Merge Account button only appears when applicable; clicking it with no destination no longer crashes.
4. Open wallet picker — confirm Ledger and other wallet logos have visible padding and are not clipped.
