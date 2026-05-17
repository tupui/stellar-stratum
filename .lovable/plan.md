# Full app review — proposed fixes

After reading the app architecture end-to-end (App/Router, NetworkContext, WalletKitContext, Index/TransactionBuilder/AccountOverview, DeepLinkHandler, AirgapSigner, lib/stellar, lib/sep7, lib/qr, lib/xdr/{parse,fingerprint}, lib/reflector + oracle client, lib/validation, vite/index.html/CSP), the code is in good shape after the prior pass. The remaining findings below are concrete and worth fixing. Nothing here changes user-visible features — only correctness, safety, and polish.

## A. Blockchain correctness (high priority)

1. **Fee math in `TransactionBuilder.handlePaymentBuild` overpays.** The `fee` passed to `new StellarTransactionBuilder(account, { fee, … })` is the **base fee per operation**; the SDK multiplies by op count. Today we set `fee = 100000 * totalOps` (and similarly for account-merge/path-payment), so the wallet effectively charges `100000 × totalOps × totalOps` stroops. Fix: pass a flat base fee (e.g. `'100000'`) regardless of op count; if we want a bump for path payments, double the base fee, not multiply by ops.

2. **Path-payment `destMin` is computed from USD oracle prices.** `estimatePathReceive` divides oracle USD prices, which is unrelated to actual DEX liquidity and can slip badly (or fail with `op_too_few_offers` / over-pay). Fix: query Horizon `strictSendPaths(sendAsset, sendAmount, [destAsset])` (already a Horizon-native endpoint, no extra dep), take the best path's `destination_amount`, apply slippage, and also populate `path` from that result instead of `[]`. Keep the oracle-based number only as a UI hint, not as on-chain `destMin`.

3. **AirgapSigner doesn't align the UI network with the loaded XDR.** When `?xdr=` is provided without an explicit `network` URL param, the fingerprint/hash uses whichever network is currently selected — which can silently mismatch the XDR and produce an invalid signature. Fix: after `tryParseTransaction(extractedXdr)` succeeds, call `setNetwork(parsed.network === 'public' ? 'mainnet' : 'testnet')` (same pattern as `DeepLinkHandler`). Do the same in `handleXdrReceived` for scanned QRs.

4. **`isValidPublicKey` uses a regex only.** It accepts strings with a valid alphabet but invalid checksum, which can route funds to a typo address that "looks" valid. Fix: delegate to `StrKey.isValidEd25519PublicKey` from `@stellar/stellar-sdk` (the regex stays as a cheap pre-check).

## B. Safety / robustness

5. **`pullFromRefractor` returns whatever the API responds with.** If the upstream returns a non-XDR payload, we still stash it in `sessionStorage` and propagate downstream. Fix: validate with `tryParseTransaction` before resolving; throw a typed error on parse failure.

6. **AirgapSigner `XMLHttpRequest` override uses `as any`.** Replace with a typed shim (`window.XMLHttpRequest = (function FakeXHR(){ throw new Error('…') }) as unknown as typeof XMLHttpRequest`) and add an early-return guard so re-mounts don't double-wrap `originalFetch`.

7. **CSP `connect-src` is wide-open (`https: wss:`).** Tighten to the actual hosts we call: Horizon (mainnet+testnet), `rpc.lightsail.network`, `api.refractor.space`, `api.soroswap.finance`, `api.defindex.io`, Kraken, Soroban Domains, and Reflector. Keep `data:` / `blob:` for QR/image decoding. This shrinks attack surface (no rogue script can exfiltrate to arbitrary domains).

## C. Code quality / consistency

8. **Duplicate `AccountData` interface** still inlined in `Index.tsx` and `TransactionBuilder.tsx` props type. Replace with the shared `AccountData` import from `@/lib/stellar` (already done in `AccountOverview`).

9. **Hard-coded `'100000'` literal fee.** Centralize in `appConfig` (e.g. `DEFAULT_BASE_FEE_STROOPS = 100_000`) and reuse across `TransactionBuilder` and `MultisigConfigBuilder`.

10. **Dead `useMemo` import in `Index.tsx`** (imported, never used). Drop it.

11. **`TransactionBuilder` imports `Memo`, `Networks`, `Horizon`** that aren't referenced. Drop unused imports (helps the `stellar` chunk tree-shake one notch better).

## D. Out of scope / explicitly NOT changing

- Visual design, tabs layout, copy.
- Lovable Cloud (disabled — and not needed; app is intentionally client-side).
- Wallet selection order, supported wallet set.
- The "mock multisig submit" — already fixed in the previous pass.

## Technical details

```text
Files touched
─────────────
src/components/TransactionBuilder.tsx   fee math (#1), path-payment destMin (#2),
                                        AccountData import (#8), fee constant (#9),
                                        unused imports (#11)
src/pages/AirgapSigner.tsx              network alignment (#3), typed XHR shim (#6)
src/lib/validation.ts                   StrKey-based pub-key check (#4)
src/lib/stellar.ts                      pullFromRefractor validation (#5)
index.html                              CSP connect-src tightening (#7)
src/pages/Index.tsx                     drop AccountData duplicate (#8), unused useMemo (#10)
src/lib/appConfig.ts                    add DEFAULT_BASE_FEE_STROOPS (#9)
```

Verification:
- Type-check via `tsc -b --noEmit` (automatic in harness).
- Manually walk: build a payment, build a 3-op batch, attempt a path payment (verify destMin comes from Horizon paths, not oracle USD), load a mainnet XDR while UI is on testnet (should auto-switch), paste an XDR with a typo in destination (should be rejected by StrKey check).

Total: ~6 files, no API/UX changes, no schema work, no dependency changes.