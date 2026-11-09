# Stratum: Multisig for G and C Accounts

Multisig for Stellar G and C accounts, with passkeys for signing, policies for permissions and
post-quantum keys.

Open Track. The Aha Company. Budget: $140,000. Timeline: 26 weeks.

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

1. One key for G and C accounts. Since protocol 27, CAP-0071 lets a C account delegate its
   authorization to other accounts in one entry. The same Ledger or passkey signs for a G account and is
   a member of a C account, and a member can itself be a smart account, such as a Nido wallet.
2. Policies. A [Perch](https://github.com/stellar-registry/perch) policy states who may call which
   contract and function, with how many signatures, until when and under which spending cap. Stratum
   shows it in plain language, and each device checks its hash before signing. Once Perch is audited, a
   new policy needs a review of its document, not a new audit.
3. Post-quantum members. An ML-DSA-65 key (FIPS 204) can be a member of a C account, verified natively
   since protocol 30. Stratum reports which rules classical signatures alone can still satisfy.
4. DeFi from a shared account. Soroswap and DeFindex from C accounts. A quote expires before three
   people have signed, so a policy can let one operator swap alone, to the account only and within a cap.
5. Passkeys and custodians. A co-signer joins from a link and signs with a passkey. Custodian vaults
   join too, starting with Fordefi, whose vault co-signed a 2-of-2 Stellar account on mainnet in July
   2026
   ([setOptions](https://stellar.expert/explorer/public/tx/d671233a078f93b63c43740f0b17896a2eac70e1eec7a316269a5c39caa37d45),
   [payment](https://stellar.expert/explorer/public/tx/5c7dafe1f130861a6e1985ce5bbafc6f191b6666f41ec5a924875857208359f8)).
   The second signature still had to be added by hand.
6. A SEP draft for multisig on C accounts, so that other wallets can co-sign the same accounts.

### Technical architecture

A signing session goes as follows.

1. A member builds the operation in Stratum, which decodes every contract call.
2. For a C account, Stratum reads the policy hash installed on the account and shows the policy only
   if it matches.
3. Stratum simulates the call and fixes the authorization entry: call tree, nonce and expiry ledger.
4. Each co-signer signs on their device, the transaction hash on a G account and the authorization
   entry on a C account, where all signatures go into the one entry CAP-0071 defines.
5. Signatures wait in Refractor, for G transactions and, with this award, for C entries.
6. Once the threshold is met, any co-signer submits and pays the fee from a G account.

```
                           Stratum (web app)
   G account multisig                          C account multisig (Perch)
   setOptions explainer, lock-out checks       policy view, diff, hash check
   members: Ledger, passkey, custodian vault, smart account, ML-DSA key (offline, QR)
          |                                           |
          | classic signatures                        | one authorization entry
          v                                           v
   G account              --- CAP-0071 --->    C account (Perch account)
   weights, thresholds        member           rules, verifiers, recovery controller
```

Stratum is a React app on stellar-sdk 17 and Stellar Wallets Kit. Today it explains every operation
before signing, refuses changes that would lock an account, and shows everything a contract call
authorizes. It refuses a call that needs another address's authorization entry. Collecting these
entries is the first deliverable. Only Perch's own deployment tool builds them today, because an entry
must name the rule it relies on.

C accounts are Perch accounts. A Perch policy is a canonical JSON document identified by its SHA-256
hash, compiled into OpenZeppelin context rules, with an interpreter whose semantics are proven in Lean
4. Perch's contracts run on testnet and as a beta on mainnet since 26 October 2026, and its audit goes
through the Audit Bank
([scope](https://github.com/stellar-registry/perch/blob/main/docs/audit-scope.md)). Stratum adds no
contract of its own.

Ledger's Stellar app signs CAP-0071 entries since version 6.1.0, and other wallets join through
Stellar Wallets Kit. Passkeys use ghostsig on G accounts and Perch's WebAuthn verifier on C accounts. An
ML-DSA-65 key lives on an offline device that answers with a sequence of QR codes. Recovery uses Perch's
controller, with guardians, a zero-knowledge proof or both. Contract calls are described through the
draft SEP for contract display descriptors by Jun Luo, and payments warn when StellarExpert's directory
flags the destination. The
[architecture document](https://github.com/tupui/stellar-stratum/blob/main/docs/ARCHITECTURE.md) has
the details.

### Privacy and safety

Stratum keeps no data about its users. There is no account, no analytics and no telemetry. Hardware
wallet makers have leaked customer lists, and a compromised front-end library has drained wallets, so we
hold nothing that could leak. The app is served from Radicle Pages, whose
[manifest](https://consulting-manao.radicle.page/stellar-stratum/.git-pages/manifest.json) gives the
commit and the hash of every file, with bundled libraries and a strict Content Security Policy. Stratum
runs no server of its own. Partly signed transactions wait in Refractor, and the directory lookup sends
only the destination of a payment.

### Open questions

We settle a few design choices while building. How a half-signed entry moves between wallets is the
subject of the SEP discussion, and with Fordefi we work out signing for a delegated member. The teams
that test Stratum will help us choose recovery profiles for groups and how narrow an operator rule can
be. Part of this award is the time to answer these questions well.

### Use of Stellar

Classic multisig is native to G accounts, and Soroban custom accounts make C accounts programmable.
CAP-0071 lets a G key be a member of a C account inside the account's own entry. Protocol 30 verifies
ML-DSA natively (CAP-0087) and lets a shared C account label its deposits with muxed addresses
(CAP-0084). SEP-52 defines the passkey key derivation and its backup, and the Stellar Registry publishes
our contracts with verified builds.

### Limitations

- The transaction is still paid and signed with Ed25519 by a G account, until stage 2 of the Quantum
  Preparedness Plan.
- Perch policies govern C accounts. A G account keeps classic multisig, since CAP-72 is not scheduled.
- Moving from G to C changes the address, so it stays optional.

## Success Criteria

We measure only what the chain shows, since Stratum collects nothing about its users. C accounts are
counted by the Perch account wasm hash and the number of members in their policy, with the value they
hold reported every month. G accounts are counted when their owners choose to tell us.

Three months after mainnet we aim for 20 shared accounts managed with Stratum, of which 8 are C
accounts, with 10 passkey co-signers. At six months we aim for 50 shared accounts, of which 20 are C
accounts, with 25 passkey co-signers, and 5 accounts with an ML-DSA member.

## Go-To-Market Plan

The first accounts are ours. Perch's audit notes plan to put its publishing registry and Nido's factory
behind a 2-of-3 multisig
([DEFERRED.md](https://github.com/stellar-registry/perch/blob/main/docs/DEFERRED.md)), and the admin key
of the Stellar Registry contract follows. SCF has funded hundreds of projects, and each ends up with an
admin key or a treasury. We reach them through ghostsig in Stellar Wallets Kit, Skychart, the projects
that publish through the Stellar Registry, and our work as an SDF integration partner. Stratum stays
free and open source, and we maintain it because our own keys depend on it.

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

## Other solutions

Smart Treasury Account (SCF #44) gives a C account caps and guardian recovery, with a single owner key.
The OpenZeppelin policy builders of SCF #44 and SoroPass serve one owner or one app. Latch (SCF #41)
added shared C wallets to its mobile app in August 2026
([latch-mobile#46](https://github.com/3K1-Labs/latch-mobile/pull/46)). MPCVault and Fordefi apply
policies on their own servers, and either can be a member through the custodian interface. LOBSTR Vault
coordinates G multisig through a central server, and MultiClique (SCF #19) has been inactive since
November 2023. Stratum differs from all of them in three ways: the same keys on G and C accounts, a
policy each device checks by its hash, and custodian and post-quantum members in one quorum. On
Ethereum, treasuries use Safe with permissions stored as data, and Stratum brings that model to groups
on Stellar, on top of Perch.

Tansu, our governance tool for open source projects, is a different kind of multisig, where many voters
decide on proposals. Stratum is for a few known co-signers, with rules enforced by the account itself.

## Risks

- Perch's contracts wait for their Audit Bank audit, which is part of Perch's own work. Until then, C
  accounts on mainnet use only rules that stock OpenZeppelin policies cover.
- Perch pins our CAP-0071 patch of OpenZeppelin's stellar-accounts. If it is not merged upstream, we
  keep maintaining the fork.
- A hardware wallet that cannot sign CAP-0071 entries stays a G-account signer.
- If Fordefi cannot sign entries for a delegated member, its vault stays a G-account signer.

## AI disclosure and open source

Stratum was built largely with Lovable: 884 of its 974 commits (6 November 2026) come from the Lovable
bot, the last on 2 August 2026. In September 2026 we reviewed the whole app with Claude Code, fixed what
it found and added tests and CI. This was not an independent audit. We use AI assistants for code and
documents, including this proposal, and review everything we publish.

Stratum and ghostsig are MIT ([LICENSE](https://github.com/tupui/stellar-stratum/blob/main/LICENSE)),
Perch and Nido are Apache-2.0, and new code takes the license of the repository it lands in.

## Team

We are [The Aha Company](https://www.theaha.co), more than 10 engineers working on Stellar since before
Soroban launched. We built the contract workflows of the Stellar CLI, the Contract Client of the JS SDK,
Loam and Scaffold Stellar, and we architected Société Générale-Forge's EURCV on Stellar. Perch, the
contract stack Stratum uses, is our own and is developed by our Stellar Registry team.

Pamphile T. Roy ([GitHub](https://github.com/tupui), [LinkedIn](https://www.linkedin.com/in/tupui))
leads the work. He wrote Stratum, ghostsig, Skychart and Tansu, co-authored SEP-52 and SEP-53, and
maintains SciPy. Elizabeth Engelman ([GitHub](https://github.com/elizabethengelman)), who took Nido to
mainnet and built our Fordefi proof of concept, and Hugo Heer ([GitHub](https://github.com/hugo-heer)),
on frontend, work on it with him. Other engineers join when a deliverable needs them, for Soroban,
security reviews or custodian integrations. PaltaLabs contributes from outside and is not in this
budget.

## Deliverables

The budget pays for new work only. Perch, Nido's passkey SDK, ghostsig and the Soroswap and DeFindex
integration are reused without funding. Perch's development and audit are funded separately.

### Tranche 1: MVP (weeks 1 to 8)

#### Deliverable 1: Signing for G and C quorums

Stratum builds the CAP-0071 entry of a C account, collects its members' signatures and counts them
against the account's rules.

Estimated completion: week 4. Budget: $13,000.

How to measure completion:
1. On testnet, one Ledger key signs a G payment and, as a member, a payment of a 2-of-3 C account.
   Both transaction hashes are published.
2. The C payment fails with one signature and succeeds with two.
3. Tests refuse a key outside the quorum and a member removed after approving.

#### Deliverable 2: Co-signer onboarding

A co-signer joins from a link with a passkey and approves from a phone.

Estimated completion: week 6. Budget: $9,000.

How to measure completion:
1. A video shows a co-signer joining from a link and approving a 2-of-3 testnet payment with a passkey.
   The transaction hash is published.
2. A passkey outside the quorum is refused.

#### Deliverable 3: Policies in the interface

Templates for treasury, protocol admin and DeFi operator. The policy is shown in plain language, a
change as a diff, and the device checks the hash before signing. The view also shows what each signer
can do across all rules.

Estimated completion: week 7. Budget: $14,000.

How to measure completion:
1. On testnet, a protocol admin policy is created from a template, changed and signed. Account address
   and policy hash are published.
2. Tests refuse a tampered or outdated policy, and report the rights of a signer named in two rules.

#### Deliverable 4: End-to-end tests

The new flows join the testnet suite, which then runs on every pull request.

Estimated completion: week 8. Budget: $6,000.

How to measure completion:
1. A passing CI run on the Stratum repository.
2. The suite refuses a key outside the quorum, a tampered policy and a lock-out `setOptions`.

### Tranche 2: Testnet (weeks 9 to 15)

#### Deliverable 5: Threat model and monitoring plan

A STRIDE threat model and an on-chain monitoring plan following SDF's templates, written first so that
the rest of tranche 2 follows it. For alerts we will look at Hypernative, which recently added Stellar,
and at community solutions such as Overcat's Quasar and StellarExpert's paid plan.

Estimated completion: week 10. Budget: $8,000.

How to measure completion:
1. docs/THREAT_MODEL.md and docs/MONITORING.md at a tagged commit.
2. On testnet, alerts for a policy change, a new signer and a recovery attempt fire, with the
   transaction hashes published.
3. The plan names the services chosen for mainnet.

#### Deliverable 6: Post-quantum members

Enrolling an ML-DSA-65 key, a rule that needs a passkey and an ML-DSA signature, and an offline signer
that answers with a sequence of QR codes.

Estimated completion: week 12. Budget: $10,000.

How to measure completion:
1. On testnet, an admin change signed with a passkey and the ML-DSA key succeeds, and fails with the
   passkey alone or a wrong ML-DSA signature. Hashes and instruction counts are published.
2. The offline signer passes the ACVP ML-DSA-65 vectors in CI.

#### Deliverable 7: Classic multisig to C quorum, and quantum report

A G multisig becomes a C quorum with the same signers. The quantum report lists every rule that
classical signatures alone can satisfy.

Estimated completion: week 13. Budget: $7,000.

How to measure completion:
1. On testnet, a G multisig is migrated, with a report of every signer and threshold difference.
2. Once ML-DSA members are added and recovery requires one, the report lists only the fee-paying G
   account.

#### Deliverable 8: Recovery for shared accounts

The quorum replaces a lost member. Guardians, a zero-knowledge proof made in the browser, or both,
recover a C account through Perch's controller, under its `Loss` or `Protected` profile.

Estimated completion: week 15. Budget: $17,000.

How to measure completion:
1. On testnet, a 3-of-5 account is recovered by guardians after losing three members.
2. Under `Loss`, the quorum cancels an attempt, and one member alone cannot.
3. Under `Protected`, a zero-knowledge recovery completes, and the account refuses other activity
   meanwhile. Transaction hashes are published.

### Tranche 3: Mainnet (weeks 16 to 26)

#### Deliverable 9: Mainnet launch

G and C accounts on mainnet, with onboarding, templates, user documentation and directory warnings.
The admin key of the Stellar Registry contract moves to a Stratum account.

Estimated completion: week 21. Budget: $19,000.

How to measure completion:
1. On mainnet, a C account is created from onboarding, a co-signer joins from a link, and a Ledger
   member and a passkey member sign a payment. Transaction hashes are published.
2. The Registry admin key moves to a Stratum account, and the monitoring alerts run on it.
3. A payment to an address the directory flags as malicious needs an explicit confirmation.
4. User documentation is online, and onboarding is tested with three outside teams.

#### Deliverable 10: DeFi from C accounts

Soroswap and DeFindex from a C quorum, and the operator rule. Calls are described through contract
display descriptors, and we publish those for Soroswap and DeFindex.

Estimated completion: week 23. Budget: $11,000.

How to measure completion:
1. On mainnet, a 2-of-3 C account deposits into a DeFindex vault, withdraws and swaps on Soroswap.
   Transaction hashes are published.
2. On testnet, an operator swaps alone within 100 USDC per week. A swap above the cap, or to the
   operator, fails.

#### Deliverable 11: Co-signing across devices and custodians

Refractor already collects the signatures of a G transaction. On a C account each signature goes inside
the authorization entry and changes the transaction hash, which Refractor keys on. We contribute support
for these entries to Refractor, which is open source, so phones, hardware wallets, smart accounts and
custodian vaults, Fordefi first, sign in one place.

Estimated completion: week 25. Budget: $16,000.

How to measure completion:
1. On mainnet, a 2-of-3 G account with a Fordefi vault as signer pays without copying XDR by hand.
   Video and transaction hash are published.
2. The pull request adding authorization entries to Refractor is opened on its repository.
3. A 2-of-3 C account pays with entries from a phone and a Ledger collected through Refractor, on
   mainnet once the change is deployed there, otherwise on testnet.
4. On testnet, a Nido wallet signs as a member of a 2-of-3 C account.

#### Deliverable 12: SEP draft for multisig on C accounts

A SEP draft on how a C account declares its members and rules, and how co-signers pass a partly signed
entry between wallets, building on CAP-0071. Perch and Stratum are the reference implementation. The
deliverable is the discussion and the draft pull request, and acceptance of the SEP is not required.

Estimated completion: week 25. Budget: $5,000.

How to measure completion:
1. A discussion is opened on stellar/stellar-protocol by week 18.
2. A draft pull request for the SEP is opened, linking the code that implements it.

#### Deliverable 13: Package and documentation

A TypeScript package for quorum signing on G and C accounts, and developer documentation.

Estimated completion: week 26. Budget: $5,000.

How to measure completion:
1. The package is published on npm with a worked example.
2. Developer documentation is online.

## Budget

| Deliverable | Tranche | Budget |
|---|---|---|
| 1. Signing for G and C quorums | 1 | $13,000 |
| 2. Co-signer onboarding | 1 | $9,000 |
| 3. Policies in the interface | 1 | $14,000 |
| 4. End-to-end tests | 1 | $6,000 |
| 5. Threat model and monitoring plan | 2 | $8,000 |
| 6. Post-quantum members | 2 | $10,000 |
| 7. Classic multisig to C quorum, and quantum report | 2 | $7,000 |
| 8. Recovery for shared accounts | 2 | $17,000 |
| 9. Mainnet launch | 3 | $19,000 |
| 10. DeFi from C accounts | 3 | $11,000 |
| 11. Co-signing across devices and custodians | 3 | $16,000 |
| 12. SEP draft for multisig on C accounts | 3 | $5,000 |
| 13. Package and documentation | 3 | $5,000 |
| Total | | $140,000 |

Tranche 1 is $42,000, tranche 2 is $42,000 and tranche 3 is $56,000. Payments follow SCF's schedule:
$14,000 on acceptance, then $28,000, $42,000 and $56,000.
