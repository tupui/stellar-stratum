# Stellar Stratum

A dapp to manage Stellar multisig accounts. How it is used, screen by screen, is in
[USER_FLOWS.md](USER_FLOWS.md). How it works and how it is tested is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Commands and deployment are in [README.md](README.md).

## Rules

- Tests and scripts use testnet only. The end-to-end tests fail on any request to a mainnet endpoint,
  and no script reads from mainnet either.
- Design, code and docs change together. A change to what a screen shows or says updates its board
  on the design canvas (below) in the same commit. A change to a flow also updates `USER_FLOWS.md`,
  and a change to how the app works updates `docs/ARCHITECTURE.md`.

## Design

The design is one Claude Design canvas, [Stratum design](https://claude.ai/artifact/F2JMyGiBkqQoGu2LUAMVvM).
It is private to its owner until it is shared from its Share menu. Read it with the Artifact tool:
`read` on that URL, then `project/canvas.json` for the boards.

A board is the spec for what its screen shows and says. The structure and the strings are binding.
The addresses, amounts and hashes are examples from throwaway testnet accounts.

The boards are drawn from the running app by `scripts/design/`, so their markup is what the components
render. They link the app's compiled stylesheet, an upload named in `scripts/design/uploads.json`, so
their classes are the Tailwind classes in `src/`. Fiat values read N/A because mainnet prices are not
read; the app shows Reflector prices there. The app has one theme, dark.

The look is "acid", drawn on the canvas page Acid redesign, whose System board is the reference:
black, white and one acid yellow. Acid marks only the action to take (one primary per screen, the
last button when side by side), a signature given, the Portfolio Value, and the logo with its
mountain. Red is an error or a click that removes something, amber a warning (both as in ghostsig).
Jersey 15 sets titles and figures, Chivo the interface, Chivo Mono addresses, hashes and amounts;
square corners; motion stepped, once, and off under reduced motion. The logo (the CRT edelweiss and
the app icon) is settled: never redraw it. Nothing on a screen explains the concept.

- A UI change redraws its board in the same commit, then republishes the canvas (below).
- A board edit, or a comment on one, is a brief: change the code and its tests to match.
- Where a board and the code disagree, say which one is stale and fix it.
- New UI is drawn first, by hand, on the Ideas page, and the owner agrees to it before code is
  written. Once it is built, add its screen to `scripts/design/screens.ts` and draw its board on its
  journey page in place of the old one.
- Titles, tabs and buttons are in Title Case ("Connect Wallet", "Air-gap Sync"); field labels,
  descriptions, notices and toasts are in sentence case. The spelling is American ("authorize").
  Addresses are shortened with `shortAddress` (`GABCDEFG…UVWXYZ12`), operation and signer kinds
  read through `lib/labels.ts`, never as `set_options` or `ed25519_public_key`.
- Once the change is committed, write that commit's hash on the Main board and in the readme note.
  To find drift: `git diff --stat <that hash>..HEAD -- src tests`, then the table below.
- Without the Artifact tool, name the boards that need the change in your summary.

To redraw boards (everything lands in `design-out/`, which is not committed):

1. `npm run design:capture -- <board or flow> ...` (no name: every screen). It starts the app, funds
   throwaway testnet accounts with friendbot, blocks every mainnet host, walks the flows of
   `screens.ts` and saves each screen with its height. With `--shots` it also saves a screenshot of
   each in `design-out/shots/`, to look at the screens when auditing them.
2. Read `project/canvas.json` from the canvas, then
   `npm run design:boards -- --index <that file> <board> ...`. It writes the boards and an updated
   index: sizes and titles change, the owner's placement and everything else is kept.
3. A QR code or another image drawn inline is a new upload: the command names the files. Upload them
   to the canvas, add each url under `data` in `uploads.json`, and run step 2 again.
4. Read the boards you replace from the canvas first: the owner edits the canvas by hand, so a board
   that differs in more than example data (addresses, amounts, hashes, dates) is a brief, not stale.
   Publish the boards, and the index only when a size or title changed.

A class that is not in the uploaded stylesheet does not render on the canvas. `npm run
design:stylesheet` builds it into `design-out/uploads/`, with the bundled font files: upload them,
put their urls in `uploads.json` (`stylesheet`, and each font under `fonts`), and redraw every board
so they link them. An image the app serves from `public/` (such as `/brand/summit-phone.svg`) is
uploaded once and named under `images`.

Drawn from the commit named on the Main board: the main state of each journey of `USER_FLOWS.md` at 1280 px, and the air-gapped
signer at 390 px too. Not drawn yet: cross-asset and merge payments, the review warnings (look-alike
assets, lockout, sequence number), the activity filters, a Refractor link (`?r=`) opening, the
Signature QR of `/sign` (it needs a wallet there: its board, `airgap-signature-qr-phone`, is drawn by
hand), the wallet list with browser extensions installed, the Soroswap and DeFindex forms (mainnet
only; the DeFi board shows the testnet notice), Privacy and Terms (laid out as Impressum), the sending
sheet and its failed and not-in-a-ledger states (drawn by hand on the Acid redesign page, `acid-send-*`),
and phone widths outside `/sign` (the Acid redesign page draws every screen at 390 px). A board for one of these is drawn when its code next changes.

| Page | Board | Code (under `src/`) | Test |
|---|---|---|---|
| Map | Main | the journeys, this section | |
| Connect | `connect-landing` | `components/LandingPage.tsx`, `components/Footer.tsx` (on every page), `components/brand/`, `public/brand/`, `src/index.css` (the system, on every page) | |
| Connect | `connect-wallets`, `connect-manual` | `components/WalletConnect.tsx`, `contexts/WalletKitContext.tsx`, `components/icons/TrezorLogo.tsx` | `lib/validation.test.ts` |
| Connect | `connect-load-failed` | the account error in `pages/Index.tsx` | |
| Dashboard | `dash-balances` | `components/AccountOverview.tsx`, `AssetBalancePanel.tsx`, `AssetIcon.tsx`, `contexts/FiatCurrencyContext.tsx` | `lib/reflector.test.ts`, `lib/reflector-client.test.ts` |
| Dashboard | `dash-activity` | `components/history/` | `lib/labels.test.ts` |
| Dashboard | `dash-multisig`, `multisig-confirm` | the multisig tab of `components/AccountOverview.tsx`, `ThresholdInfoTooltip.tsx` | `lib/labels.test.ts` |
| Dashboard | `dash-account` | `components/AccountMenu.tsx`, the header of `components/AccountOverview.tsx`, `components/brand/Shell.tsx` | |
| Dashboard | `dash-endpoints` | `components/HorizonSettingsDialog.tsx`, `lib/horizonSettings.ts` | |
| Dashboard | `multisig-edit` | `components/MultisigConfigBuilder.tsx` | `lib/multisig.test.ts`, `lib/validation.test.ts` |
| Build | `build-payment`, `build-payment-filled`, `build-payment-bundled` | `components/TransactionBuilder.tsx`, `components/payment/`, `SwapInterface.tsx`, `AddressAutocomplete.tsx`, `SourceAccountSelector.tsx` | `lib/payments.test.ts`, `lib/validation.test.ts`, `hooks/useAddressBook.test.ts`, `lib/sep7.test.ts`, `tests/testnet-flows.spec.ts` |
| Build | `build-contract`, `build-contract-filled` | `components/contract/`, `lib/contract/` | |
| Build | `build-defi` | the DeFi tab of `components/TransactionBuilder.tsx`, `components/soroswap/`, `components/defindex/` | `lib/protocols/guards.test.ts`, `lib/protocols/verify.test.ts`, `lib/protocols/onchain.test.ts`, `lib/protocols/tokens.test.ts` |
| Build | `build-import`, `build-import-scan-refused` | `components/ImportTab.tsx`, `QRScanner.tsx`, `DeepLinkHandler.tsx` | `lib/sep7.test.ts`, `lib/airgap/ur.test.ts`, `tests/testnet-flows.spec.ts` |
| Review and sign | `review-unsigned`, `review-partly-signed`, `review-ready` | `components/XdrDetails.tsx`, `components/transaction/`, `SignerSelector.tsx` | `lib/xdr/describe.test.ts`, `lib/xdr/interpret.test.ts`, `lib/signatures.test.ts`, `lib/protocols/auth.test.ts`, `lib/protocols/tokens.test.ts`, `lib/protocols/enrich.test.ts`, `lib/labels.test.ts`, `tests/testnet-flows.spec.ts` |
| Review and sign | `review-airgap-mode`, `review-airgap-qr`, `review-airgap-qr-animated` | `components/transaction/TransactionSubmitter.tsx`, `TransactionSigningPanel.tsx`, `components/airgap/AirgapSyncModal.tsx`, `AirgapQRCode.tsx`, `HashField.tsx`, `lib/airgap/` | `lib/airgap/cbor.test.ts`, `lib/airgap/ur.test.ts`, `lib/airgap/payloads.test.ts`, `lib/signatures.test.ts`, `lib/sep7.test.ts`, `tests/testnet-flows.spec.ts` |
| Coordinate and submit | `share-sent`, `share-link` | `components/transaction/TransactionSigningPanel.tsx`, `SuccessModal.tsx` (Refractor), `ImportTab.tsx`, `ShareModal.tsx` | `tests/testnet-flows.spec.ts` |
| Coordinate and submit | `submit-success` | `SuccessModal.tsx` (network), `components/transaction/SubmissionTerminal.tsx` | `tests/testnet-flows.spec.ts` |
| Air-gapped signer | `airgap-empty`, `airgap-scanning`, `airgap-loaded` and their `-phone` boards, `airgap-signature-qr-phone` | `pages/AirgapSigner.tsx`, `components/airgap/`, `QRScanner.tsx` | `lib/airgap/payloads.test.ts`, `lib/signatures.test.ts`, `lib/sep7.test.ts`, `tests/testnet-flows.spec.ts`, `tests/airgap-camera.spec.ts` |
| Other | `legal-impressum`, `misc-404` | `pages/legal/`, `components/legal.tsx`, `pages/NotFound.tsx` | |
