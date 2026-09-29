# Stellar Stratum

A dapp to manage Stellar multisig accounts: build transactions, collect signatures from several
signers (online or air-gapped), and submit them.

https://stellar-stratum.xyz

## Features

- **Multisig**: configure signers, weights and thresholds, with checks that prevent locking an account
- **Clear review before signing**: every operation, asset issuers, configuration changes explained, and the transaction hash for the network being signed
- **Signature collection**: signatures are verified against the transaction for every account involved; share through Refractor links or air-gapped QR codes
- **Wallets**: Freighter, xBull, Albedo, Lobstr, Ghostsig, Ledger, Trezor and more, or any address watch-only
- **Payments**: several operations in one transaction, cross-asset path payments, account creation and account merge
- **Contract calls**: any Soroban contract, including Stellar Asset Contracts
- **DeFi**: Soroswap swaps and liquidity, DeFindex vaults, with the API-built transactions checked before signing
- **Balances and activity**: prices from [Reflector](https://reflector.network) oracles, fiat currencies, history and charts
- **Mainnet and Testnet**, with shareable links that keep the account, network and view
- **Horizon resilience**: failover across public Horizon mirrors, configurable endpoints, and a live submission log

See [USER_FLOWS.md](USER_FLOWS.md) for how the app is used.

## Development

```bash
npm install
npm run dev        # http://localhost:8080
npm run typecheck
npm run lint
npm test           # unit tests (Vitest)
npm run test:e2e   # end-to-end tests on Stellar testnet (Playwright)
```

The end-to-end tests only use testnet accounts funded by friendbot, and fail if the app sends any
request to a mainnet endpoint while on testnet.

## Deployment

The app is published on Radicle Pages, which serves the `pages` branch.

```bash
make pages-init     # once: the canonical rule for refs/heads/pages and its worktree
make deploy-pages   # build, copy into the pages worktree, commit and push to Radicle
make live           # is the published app the build in dist/?
```

`make pages-init` adds the canonical reference rule for `refs/heads/pages` and checks that
branch out as an orphan worktree in `pages/`. `make deploy-pages` refuses a dirty tree, builds,
replaces the content of the worktree, and pushes to Radicle only; every push redeploys.
