# Independent review — findings & proposed fixes

Re-read the app end-to-end (router, contexts, Index, TransactionBuilder, AccountOverview, MultisigConfigBuilder, AirgapSigner, DeepLinkHandler, lib/stellar, lib/validation, lib/appConfig, vite/index.html). The previous pass landed cleanly; the items below are **new** findings.

## A. Correctness bugs (real, ship-blockers for one flow)

1. **AccountOverview multisig signature detection is hardcoded to mainnet.** `getExistingSignedKeys` in `src/components/AccountOverview.tsx` (line 107) parses the multisig-config XDR with `Networks.PUBLIC` regardless of `currentNetwork`. On testnet, signature verification fails for every signer, so `currentWeight` always reports 0 and "Submit to network" never enables — even with valid signatures. Fix: pull `getNetworkPassphrase(currentNetwork)` from `@/lib/stellar` and use that in `StellarTransactionBuilder.fromXDR` and the subsequent `transaction.hash()` call.

2. **TransactionBuilder uses signature `hint()` matching with `as any` casts.** `getExistingSignedKeys` in `src/components/TransactionBuilder.tsx` (line 756–784) matches hints (last 4 bytes of public key). Two signers whose addresses collide in their last 4 bytes are indistinguishable and both get counted. Fix: switch to the same `Keypair.verify(tx.hash(), sig.signature())` approach already used in `AccountOverview` (handles fee-bump inner tx via `parsed.innerTransaction ?? parsed`). This also lets us drop the `as any` casts.

## B. Dead code / redundancies

3. **Unused `fingerprint` constant in `AirgapSigner`** (line 138 of `src/pages/AirgapSigner.tsx`) — computed every render, never referenced. The render path computes a fresh fingerprint inside `onShowOfflineModal` anyway. Delete.

4. **NetworkContext double-persists.** `setNetwork` writes to `localStorage` and a `useEffect` then writes again on every state change. Drop the `useEffect`, keep the explicit write inside `setNetwork`.

5. **Unused `Transaction` and `Horizon` imports in `MultisigConfigBuilder.tsx`** (lines 24, 28). Drop them.

6. **WalletKit address-lookup order inconsistent.** `connectWallet` tries `fetchAddress` → `getAddress`; `signWithWallet` tries `getAddress` → `fetchAddress`. Standardize to the `signWithWallet` order (`getAddress` first, which doesn't re-prompt for hardware wallets that are already unlocked).

7. **`canSubmitToRefractor` (AccountOverview line 158–160) returns `string | boolean`.** Wrap in `Boolean(...)` so the function signature actually returns `boolean`.

## C. Question to confirm (no code change yet)

8. **`SOROSWAP_API_KEY` and `DEFINDEX_API_KEY` in `src/lib/appConfig.ts` start with `sk_`.** The inline comment says "public client API key — safe to ship in browser bundle," but the `sk_` prefix is the conventional marker for *secret* keys (Stripe-style). I will **not** touch these without confirmation — if they are publishable, fine; if they're actually secret, shipping them in the SPA bundle leaks them to every visitor (anyone can scrape `/assets/*.js`) and they need to be rotated and either re-issued as public keys or fronted by a tiny proxy. Could you confirm with Soroswap/DeFindex what the `sk_` prefix means for their APIs? Until then I'll leave them as-is.

## D. Explicitly NOT changing

- CSP `connect-src 'self' https: data: blob:` stays as-is. Tightening to an explicit allowlist of Stellar/Soroban/Refractor/Soroswap/DeFindex/Kraken/Reflector hosts was attempted in the previous pass and you accepted the current form. Won't re-litigate.
- Visual design, tabs, copy, wallet list, fiat list, asset metadata fetching strategy (per project memory: only XLM is hardcoded), USB shim, production-console silence.

## Technical details

```text
Files touched
─────────────
src/components/AccountOverview.tsx       fix #1 (network-aware sig check), fix #7
src/components/TransactionBuilder.tsx    fix #2 (Keypair.verify, drop `as any`)
src/pages/AirgapSigner.tsx               fix #3 (drop dead fingerprint)
src/contexts/NetworkContext.tsx          fix #4 (drop redundant useEffect)
src/components/MultisigConfigBuilder.tsx fix #5 (prune imports)
src/contexts/WalletKitContext.tsx        fix #6 (standardize address lookup)
```

Verification: `tsc -b --noEmit` (automatic). Manual: switch to testnet, build a multisig config change, sign with two test signers, confirm "Submit to network" enables once threshold met (regression test for #1).

Scope: 6 files, no API/UX changes, no dependency changes, no schema work.