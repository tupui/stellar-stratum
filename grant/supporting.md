# Stratum: supporting material

The parts of the SCF #46 application that are not in [proposal.md](proposal.md): success criteria,
go-to-market, other solutions, risks, AI disclosure, team and budget. The architecture, open questions
and privacy are in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

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
that publish through the Stellar Registry, and our work as an SDF integration partner. We will also work
with custodians such as Fordefi, so that their customers can put a vault in a Stratum quorum. Stratum
stays free and open source, and we maintain it because our own keys depend on it.

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

## Budget

| Deliverable | Tranche | Budget |
|---|---|---|
| 1. Signing for G and C quorums | 1 | $19,000 |
| 2. Policies and passkey co-signers | 1 | $23,000 |
| 3. Threat model and monitoring plan | 2 | $8,000 |
| 4. Post-quantum members and migration | 2 | $17,000 |
| 5. Recovery for shared accounts | 2 | $17,000 |
| 6. Mainnet launch | 3 | $24,000 |
| 7. DeFi from C accounts | 3 | $11,000 |
| 8. Co-signing across wallets | 3 | $16,000 |
| 9. SEP draft for multisig on C accounts | 3 | $5,000 |
| Total | | $140,000 |

Tranche 1 is $42,000, tranche 2 is $42,000 and tranche 3 is $56,000. Payments follow SCF's schedule:
$14,000 on acceptance, then $28,000, $42,000 and $56,000.
