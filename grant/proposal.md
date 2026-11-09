# Stratum: Multisig for G and C Accounts

Multisig for Stellar G and C accounts, with passkeys for signing, policies for permissions and
post-quantum keys.

Open Track. The Aha Company. Budget: $140,000. Timeline: 16 weeks.

Website: https://stellar-stratum.xyz. Code: [GitHub](https://github.com/tupui/stellar-stratum) and
[Radicle](https://radicle.network/nodes/consulting-manao.radicle.garden/rad:z26DiFQyjzLf5CedumY5uUbFSjj7C).
Architecture: https://github.com/tupui/stellar-stratum/blob/main/docs/ARCHITECTURE.md. Video: [link].

## Products & Services

Every team that holds funds on Stellar, from a company treasury to a protocol admin key, a DAO or an
asset issuer, wants several people to approve a payment or a change of keys. On Stellar they hold two
kinds of account. Classic G accounts work with every anchor, asset and exchange, and their multisig
counts signatures. Smart C accounts are contracts that enforce rules, such as a weekly spending cap.
Tools for these rules serve one owner or one app, and we know of no wallet where a group shares both
kinds of account with the same keys.

Stratum is that wallet. It is self-custody, since only the members, and the custodians they choose, hold
keys. With this award, Stratum gathers one CAP-0071 authorization entry from a Ledger, a passkey, a
custodian vault and a post-quantum key, and every device checks the policy that governs the account
before it signs. Stratum has run on mainnet since 2025 at
[stellar-stratum.xyz](https://stellar-stratum.xyz) for G accounts. PaltaLabs, the team behind Soroswap
and DeFindex, uses it, and so do some of our partners.

Stratum is one part of a self-custody suite we build. [Skychart](https://skychart.dev) follows a
portfolio across Stellar and other chains, and opens any Stellar account in Stratum with one link.
ghostsig signs alone with a passkey and is already a signer in Stratum. Nido is a person's own smart
account, and with this award a Nido wallet joins a Stratum quorum as a member. At every step, from a
portfolio to a group account, users keep their own keys.

This award adds the following to Stratum.

1. One key for G and C accounts. Since protocol 27, CAP-0071 lets a C account delegate its authorization
   to other accounts in one entry. The same Ledger or passkey signs for a G account and is a member of a
   C account, and a member can itself be a smart account, such as a Nido wallet.
2. Policies. A [Perch](https://github.com/stellar-registry/perch) policy states who may call which
   contract and function, with how many signatures, until when and under which spending cap. Stratum
   shows it in plain language, and each device checks its hash before signing. Once Perch is audited, a
   new policy needs a review of its document, not a new audit.
3. Post-quantum members. An ML-DSA-65 key (FIPS 204) can be a member of a C account, verified natively
   since protocol 30. Stratum reports which rules classical signatures alone can still satisfy.
4. DeFi from a shared account. Soroswap and DeFindex from C accounts. A quote expires before three
   people have signed, so a policy can let one operator swap alone, to the account only and within a
   cap.
5. Passkeys and custodians. A co-signer joins from a link and signs with a passkey. A custodian vault
   can be a member too, as a Fordefi vault showed when it co-signed a 2-of-2 Stellar account with us on
   mainnet in July 2026
   ([setOptions](https://stellar.expert/explorer/public/tx/d671233a078f93b63c43740f0b17896a2eac70e1eec7a316269a5c39caa37d45),
   [payment](https://stellar.expert/explorer/public/tx/5c7dafe1f130861a6e1985ce5bbafc6f191b6666f41ec5a924875857208359f8)).
   The second signature still had to be added by hand.
6. A SEP draft for multisig on C accounts, so that other wallets can co-sign the same accounts.

## Traction Evidence

- Stratum has run on mainnet since 2025. PaltaLabs, the team behind Soroswap and DeFindex, uses it, and
  so do some of our partners.
- PaltaLabs has merged ten pull requests since February 2026, including the Soroswap and DeFindex
  integration ([#18](https://github.com/tupui/stellar-stratum/pull/18)) and the `setOptions` explainer
  ([#76](https://github.com/tupui/stellar-stratum/pull/76)).
- A Fordefi vault co-signed a 2-of-2 account on mainnet in July 2026 (linked above).
- ghostsig is part of Stellar Wallets Kit since version 2.7.0, and [Skychart](https://skychart.dev) opens
  any Stellar account in Stratum.
- Perch runs on mainnet as a beta since October 2026, and Nido runs on it.
- Nido (SCF #41), a passkey smart-account wallet, and Authline (SCF #44), one-signature trustlines for
  regulated assets, are delivered.

## Tranches

The budget pays for new work only. Perch, Nido's passkey SDK, ghostsig and the Soroswap and DeFindex
integration are reused without funding. Perch's development and audit are funded separately. Weeks count
from the start of the work, planned for 4 January 2027. The total is $140,000.

### Tranche 1: MVP

Weeks 1 to 5. Planned completion: 5 February 2027. Budget: $42,000.

#### Deliverable 1: Signing for G and C quorums

Stratum builds the CAP-0071 entry of a C account, collects its members' signatures and counts them
against the account's rules. The testnet suite covers the new flows and runs on every pull request.

Estimated completion: week 4. Budget: $19,000.

How to measure completion:
1. On testnet, one Ledger key signs a G payment and, as a member, a payment of a 2-of-3 C account. Both
   transaction hashes are published.
2. The C payment fails with one signature and succeeds with two.
3. A passing CI run whose suite refuses a key outside the quorum, a member removed after approving and a
   lock-out `setOptions`.

#### Deliverable 2: Policies and passkey co-signers

Templates for treasury, protocol admin and DeFi operator. The policy is shown in plain language, a
change as a diff, the device checks the hash before signing, and the view shows what each signer can do
across all rules. A co-signer joins from a link with a passkey and approves from a phone.

Estimated completion: week 5. Budget: $23,000.

How to measure completion:
1. On testnet, a protocol admin policy is created from a template, changed and signed. Account address
   and policy hash are published.
2. Tests refuse a tampered or outdated policy, and report the rights of a signer named in two rules.
3. A video shows a co-signer joining from a link and approving a 2-of-3 testnet payment with a passkey,
   and a passkey outside the quorum refused.

### Tranche 2: Testnet

Weeks 6 to 10. Planned completion: 12 March 2027. Budget: $42,000.

#### Deliverable 3: Threat model and monitoring plan

A STRIDE threat model and an on-chain monitoring plan following SDF's templates, written first so that
the rest of tranche 2 follows it. For alerts we will look at Hypernative, which recently added Stellar,
and at community solutions such as Overcat's Quasar and StellarExpert's paid plan.

Estimated completion: week 6. Budget: $8,000.

How to measure completion:
1. docs/THREAT_MODEL.md and docs/MONITORING.md at a tagged commit.
2. On testnet, alerts for a policy change, a new signer and a recovery attempt fire, with the
   transaction hashes published.
3. The plan names the services chosen for mainnet.

#### Deliverable 4: Post-quantum members and migration

Enrolling an ML-DSA-65 key, a rule that needs a passkey and an ML-DSA signature, and an offline signer
that answers with a sequence of QR codes. A G multisig becomes a C quorum with the same signers, and a
quantum report lists every rule that classical signatures alone can satisfy.

Estimated completion: week 9. Budget: $17,000.

How to measure completion:
1. On testnet, an admin change signed with a passkey and the ML-DSA key succeeds, and fails with the
   passkey alone or a wrong ML-DSA signature. Hashes and instruction counts are published.
2. The offline signer passes the ACVP ML-DSA-65 vectors in CI.
3. On testnet, a G multisig is migrated with a report of every difference. Once ML-DSA members are added
   and recovery requires one, the quantum report lists only the fee-paying G account.

#### Deliverable 5: Recovery for shared accounts

The quorum replaces a lost member. Guardians, a zero-knowledge proof made in the browser, or both,
recover a C account through Perch's controller, under its `Loss` or `Protected` profile.

Estimated completion: week 10. Budget: $17,000.

How to measure completion:
1. On testnet, a 3-of-5 account is recovered by guardians after losing three members.
2. Under `Loss`, the quorum cancels an attempt, and one member alone cannot.
3. Under `Protected`, a zero-knowledge recovery completes, and the account refuses other activity
   meanwhile. Transaction hashes are published.

### Tranche 3: Mainnet

Weeks 11 to 16. Planned completion: 23 April 2027. Budget: $56,000.

#### Deliverable 6: Mainnet launch

G and C accounts on mainnet, with onboarding, templates, directory warnings, user and developer
documentation, and a TypeScript package for quorum signing. The admin key of the Stellar Registry
contract moves to a Stratum account.

Estimated completion: week 13. Budget: $24,000.

How to measure completion:
1. On mainnet, a C account is created from onboarding, a co-signer joins from a link, and a Ledger
   member and a passkey member sign a payment. Transaction hashes are published.
2. The Registry admin key moves to a Stratum account, and the monitoring alerts run on it.
3. A payment to an address the directory flags as malicious needs an explicit confirmation.
4. Documentation is online, onboarding is tested with three outside teams, and the package is on npm
   with a worked example.

#### Deliverable 7: DeFi from C accounts

Soroswap and DeFindex from a C quorum, and the operator rule. Calls are described through contract
display descriptors, and we publish those for Soroswap and DeFindex.

Estimated completion: week 14. Budget: $11,000.

How to measure completion:
1. On mainnet, a 2-of-3 C account deposits into a DeFindex vault, withdraws and swaps on Soroswap.
   Transaction hashes are published.
2. On testnet, an operator swaps alone within 100 USDC per week. A swap above the cap, or to the
   operator, fails.

#### Deliverable 8: Co-signing across wallets

Stratum gathers signatures from phones, hardware wallets, smart accounts and custodian vaults, and
submits once the threshold is met. G transactions go through Refractor. C entries go by link or QR code,
and through Refractor once it accepts them. Custodians plug in through one interface modelled on
Ripple's simpleXRPL.

Estimated completion: week 15. Budget: $16,000.

How to measure completion:
1. On mainnet, a 2-of-3 C account pays with entries from a phone and a Ledger. The transaction hash is
   published.
2. On testnet, a Nido wallet signs as a member of a 2-of-3 C account.
3. The documentation lists which wallets of Stellar Wallets Kit sign in Stratum, and the custodian
   interface is documented with a test implementation that signs as a member on testnet.

#### Deliverable 9: SEP draft for multisig on C accounts

A SEP draft on how a C account declares its members and rules, and how co-signers pass a partly signed
entry between wallets, building on CAP-0071. Perch and Stratum are the reference implementation. The
deliverable is the discussion and the draft pull request, and acceptance of the SEP is not required.

Estimated completion: week 16. Budget: $5,000.

How to measure completion:
1. A discussion is opened on stellar/stellar-protocol by week 11.
2. A draft pull request for the SEP is opened, linking the code that implements it.
