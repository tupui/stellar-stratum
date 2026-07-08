
# Arbitrary Soroban Contract Calls

Add a general-purpose contract invocation flow (like Stellar Lab / Scaffold / Tansu dapp): paste a contract address, load its interface from the network, pick a function, fill in typed parameters, simulate, then build an `InvokeHostFunction` XDR that flows through the existing sign / Refractor / submit pipeline.

While we're in there, reorganize the tabs so DeFi integrations live together and there's room to grow.

## Tab reorganization

Today `TransactionBuilder` has 4 flat tabs: Payment · Import · Soroswap · DeFindex.

New top-level layout:

```text
[ Payment ] [ Contract ] [ DeFi ▾ ] [ Import ]
                          └── Soroswap
                          └── DeFindex
                          └── (future: Blend, Aquarius, …)
```

- **Contract** — new, generic contract call flow.
- **DeFi** — one outer tab, inner Tabs for Soroswap/DeFindex. `SoroswapTab` and `DeFindexTab` stay untouched as leaf components.
- `initialTab` mapping in `Index.tsx` (`'payment' | 'import' | 'multisig'`) unchanged; deep-link routing keeps working.
- The tab-reset effect in `TransactionBuilder` is extended to clear contract state when leaving the Contract tab.

## Contract Call feature

### UX (progressive, single screen)

1. **Contract address input** — `C…` StrKey, validated with `StrKey.isValidContract`. Recents (top 5 per network) persisted with existing `safeLocalStorage`.
2. **Load** → fetch spec, show a summary line (address + optional name from spec meta) and a **function selector**.
3. **Function form** — one input per parameter, typed against the spec:
   - `Address` → text input, `StrKey` validation (`G…` or `C…`).
   - `U32 / I32 / U64 / I64 / U128 / I128 / U256 / I256` → numeric input, wide types parsed via `BigInt`.
   - `Bool` → `Switch`.
   - `Symbol / String` → text input.
   - `Bytes / BytesN` → hex input, length-checked for `BytesN`.
   - `Vec<T>` → dynamic list of `T` rows.
   - `Map<K,V>` → dynamic key/value rows.
   - `Option<T>` → "provide value" toggle + inner input.
   - `Enum` / `Struct` (udt) → nested form generated from the spec's udt entries.
   - Return type displayed read-only.
4. **Simulate** — runs the invocation via Soroban RPC, shows decoded return value and resource fee estimate; errors surface through `ErrorHandlers`.
5. **Build** — assembles the transaction (auth + resource fees applied) and emits XDR via the existing `handleSdkBuild(xdr)` path, so sign / Refractor / submit / air-gap all keep working with zero changes.

### Loading and encoding

Use the SDK's contract module (already a dep, no new install):

```ts
import { contract } from '@stellar/stellar-sdk';

const client = await contract.Client.from({
  contractId,
  networkPassphrase: getNetworkPassphrase(network),
  rpcUrl: network === 'testnet' ? appConfig.TESTNET_SOROBAN_RPC : appConfig.MAINNET_SOROBAN_RPC,
  publicKey: sourceAccount,
});
// client.spec is a contract.Spec — funcs(), getFunc(name), funcArgsToScVals(name, obj), funcResToNative(name, scval)
```

Spec cached in memory per `${network}:${contractId}` for the session (WASM rarely changes; a "Refresh" button forces reload). No `localStorage` caching of specs.

Assembly: `client.<fn>(argsObj)` returns an `AssembledTransaction`; `.simulate()` for preview, `.toXDR()` to hand off to `handleSdkBuild`. Fee-bump, source-account override, signer selection, multisig, and Refractor coordination all continue to work because they run after the XDR is produced.

### New files

```text
src/components/contract/
  ContractCallTab.tsx        // orchestrator: address → function → form → simulate → build
  ContractAddressInput.tsx   // address input + recents + load button
  ContractFunctionForm.tsx   // renders inputs from a function spec
  ContractValueInput.tsx     // recursive input for one ScSpecTypeDef (Vec/Map/Option/udt)
src/lib/contract/
  spec.ts                    // loadContractSpec(contractId, network) + in-memory cache
  form-values.ts             // FormValue ↔ ScVal via spec helpers; ScVal → readable string
  recent-contracts.ts        // localStorage recents via safeLocalStorage
```

### Networks and edge cases

- Both mainnet and testnet supported. Only DeFindex keeps its mainnet-only guard.
- Contract not found → inline error, no crash.
- SAC assets (`transfer`, `balance`, …) work out of the box since their spec loads normally — nice free coverage.
- Source/signer flow unchanged; multisig via Refractor unchanged.

## Testing plan (on testnet, self-driven)

I'll drive Playwright against the local preview to exercise the whole flow end-to-end. Session credentials for testnet are not required — the app is client-side and uses the existing wallet flow; I'll use a locally-generated Stellar keypair funded via Friendbot for building/simulating, and stop short of broadcasting signatures I don't own.

Steps:

1. Generate a testnet keypair with the SDK, fund via `https://friendbot.stellar.org`.
2. Switch preview to Testnet, connect using that key (via the app's existing "enter public key" path or a wallet stub; if only wallet-based connect is available, use the source-account editor to point at the funded account).
3. Load a well-known testnet contract — start with the native XLM SAC (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`) and call `balance(Address)` and `decimals()` — both are read-only, safe to simulate/build.
4. Load the Tansu testnet contract (address pulled from the linked repo's config) and simulate one of its read functions to confirm udt/enum rendering works.
5. Deploy a tiny custom test contract only if the above two don't cover Vec/Map/Option/BytesN — otherwise skip.
6. Build a state-changing call (e.g. an increment counter contract or a Tansu write function that only affects the funded test account), sign with the connected wallet path in the sandbox, and submit to Soroban testnet RPC. Verify hash on StellarExpert.
7. Regression pass: Payment / Import / Soroswap / DeFindex tabs still build and submit unchanged; Refractor coordination unchanged.
8. `tsgo` clean, existing Playwright specs pass.

Any test-only helpers (scripts under `/tmp/browser/`) stay outside the project tree.

## Out of scope

- Persisted spec cache across reloads.
- Named contract bookmarks with labels (recents only).
- Contract deployment / WASM upload.
- Batching a contract call with a classic op in the same tx.
- Custom decoding for every Soroban host error (existing generic handler).
