# Sign contract deploys in Stratum from CI

The action builds a Soroban transaction for your multisig account, stores it on Refractor and
links to it in Stratum, where the signers review and sign it. By default the workflow only has the account's
public key, so no signing key is kept in GitHub secrets. The logic lives in [`src/lib/ci`](../src/lib/ci), which
other tools can call as well. Inputs and outputs are in [`action.yml`](action.yml).

Use a release tag, for example `tupui/stellar-stratum/action@action-v1`. A release builds the bundle and
publishes it under `action-vX.Y.Z` and the moving `action-vX` tag, so the bundle is not in the repository.
Locally, `npm run build:action` builds it into `action/dist`.

The link goes in the job summary, and in a pull request or commit comment if you set `comment`.

## Deploy

A deploy is two transactions, because the contract can only be created once its code is on the ledger.
Run the workflow with `upload`, sign and send that in Stratum, then run it again with `deploy`.
See [`examples/deploy.yml`](examples/deploy.yml). Constructor arguments go in `args`, a JSON object of
values by name, written as in the app's contract form.

## Upgrade

Upload the new code the same way, then run the contract's upgrade function with `operation: call`. The
example assumes an `upgrade` function that takes the new WASM hash. See
[`examples/upgrade.yml`](examples/upgrade.yml).

## Let the CI sign its half

Add a `signing-key` (the secret key of one signer, kept in a GitHub secret) and the transaction is already
signed by the CI when the signers open it, so a human only adds the second signature. The recommended
setup is a CI key with weight 1, a human with weight 1 and the account's medium and high thresholds at 2, so
the CI can never deploy alone. The action reads the account's signers and thresholds first and refuses a key
that is not a signer, or that reaches the threshold alone, before it stores anything.
See [`examples/deploy-signed-by-ci.yml`](examples/deploy-signed-by-ci.yml).

The human then, in Stratum:

1. Opens the link from the job summary or the comment. The wallet that holds the signer's key must be set to the same network as the transaction, and it may ask once to allow the site.
2. Under Sign Transaction, picks their key in "Select a signer to sign with" and their wallet in "Select wallet to sign", and clicks Sign.
3. Clicks "Send Transaction to Testnet" (or Mainnet), which appears once the weight reaches the threshold. The CI signature is already on the transaction. "Send for Signature" is only needed when more signatures are still missing.

## Limits

- Refractor accepts request bodies up to about 100 KB, which is an upload of a WASM of about 73 KB. For a larger transaction the action leaves `refractor-id` empty and sets `artifact-path` to a file with the unsigned XDR. Upload it with `actions/upload-artifact`, and the signers download it, open Stratum on the same network, choose Import in the transaction builder and paste the XDR.
- The transaction uses the account's next sequence number. If another transaction from the account is sent first, run the workflow again.
- The authorization must be the source account's own, which the transaction signature covers. Stratum refuses a call that another address has to authorize.

## Moving from one CI key to a multisig deployer account

Today the deployer is usually one account whose secret key sits in a GitHub secret. You can turn that same
account into a multisig account in Stratum and keep its address, so contracts it already owns stay as they are.
Try it on testnet first.

1. Open Stratum on the deployer account, with its network chosen, and connect a wallet that holds the current key. The key in the GitHub secret is the only signer at this point, so it has to sign this first change.
2. On the dashboard, under Multisig, choose Edit Configuration.
3. Under Current Signers, add each person's public key with a weight, using the field at the bottom of the list and Add.
4. Under Operation Thresholds, set Low, Medium and High. For three people who each weigh 1, a Medium and High of 2 means any two of them must agree. Contract uploads, deploys and upgrades are Medium operations. Restoring or extending contract data is Low.
5. Lower the weight of the Current Account row to 0 so the old CI key can no longer sign. Stratum shows a lockout warning if the weights and thresholds would leave nobody able to sign, so read it before you continue.
6. Choose Build Configuration Transaction, review it, and sign it with the current key. The signers and thresholds change once it is sent.
7. In the repository, delete the secret key from GitHub secrets and add the public key as a variable, for example `DEPLOYER_ACCOUNT`. Run the workflow, and open the link from the job summary.

From then on a deploy needs the threshold of signers, and nothing in GitHub can sign it.
