# SACS Geospatial Explanation Phase Report — S14

## Phase

S14: **BLOCKED**

## Source SHAs

See `reports/v0.4/geospatial/S13-source-lock.json`; source, runtime, and deployment identities remain distinct.

## Upstream profile/lock hashes

The checked-in consumer lock is explicitly provisional and `BLOCKED`. It is not an authoritative WSGS handoff.

## Changes

See the phase-scoped source and test evidence mapped in `acceptance-ledger.json`.

## Tests actually run

| command           | result     | evidence                           |
| ----------------- | ---------- | ---------------------------------- |
| pnpm test:v04:s14 | PASS 23/23 | three focused contract/unit suites |

Fixture or unit evidence is supplementary wherever the matrix requires REAL_WSGS.

## Acceptance IDs

Summary: 0 PASS, 0 FAIL, 0 NOT_RUN, 28 BLOCKED (28 total).

| ID      | status  | scenario                         | decision                                                                                                              |
| ------- | ------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| AC-U001 | BLOCKED | Authoritative handoff discovered | BLOCKED: Authoritative handoff discovered requires bytes from the missing authoritative WSGS consumer handoff bundle. |
| AC-U002 | BLOCKED | Bundle checksums                 | BLOCKED: Bundle checksums requires bytes from the missing authoritative WSGS consumer handoff bundle.                 |
| AC-U003 | BLOCKED | WSGS SHA                         | BLOCKED: WSGS SHA requires bytes from the missing authoritative WSGS consumer handoff bundle.                         |
| AC-U004 | BLOCKED | GOWM SHA/fingerprint             | BLOCKED: GOWM SHA/fingerprint requires bytes from the missing authoritative WSGS consumer handoff bundle.             |
| AC-U005 | BLOCKED | GDPS SHA/fingerprint             | BLOCKED: GDPS SHA/fingerprint requires bytes from the missing authoritative WSGS consumer handoff bundle.             |
| AC-U006 | BLOCKED | Grounding contract version       | BLOCKED: Grounding contract version requires bytes from the missing authoritative WSGS consumer handoff bundle.       |
| AC-U007 | BLOCKED | Capabilities schema hash         | BLOCKED: Capabilities schema hash requires bytes from the missing authoritative WSGS consumer handoff bundle.         |
| AC-U008 | BLOCKED | Result schema hash               | BLOCKED: Result schema hash requires bytes from the missing authoritative WSGS consumer handoff bundle.               |
| AC-U009 | BLOCKED | Finding profile                  | BLOCKED: Finding profile requires bytes from the missing authoritative WSGS consumer handoff bundle.                  |
| AC-U010 | BLOCKED | Finding schema hash              | BLOCKED: Finding schema hash requires bytes from the missing authoritative WSGS consumer handoff bundle.              |
| AC-U011 | BLOCKED | SourceProduct schema hash        | BLOCKED: SourceProduct schema hash requires bytes from the missing authoritative WSGS consumer handoff bundle.        |
| AC-U012 | BLOCKED | Typed Gap schema hash            | BLOCKED: Typed Gap schema hash requires bytes from the missing authoritative WSGS consumer handoff bundle.            |
| AC-U013 | BLOCKED | Transport mode                   | BLOCKED: Transport mode requires bytes from the missing authoritative WSGS consumer handoff bundle.                   |
| AC-U014 | BLOCKED | Requested products               | BLOCKED: Requested products requires bytes from the missing authoritative WSGS consumer handoff bundle.               |
| AC-U015 | BLOCKED | Currentness mode                 | BLOCKED: Currentness mode requires bytes from the missing authoritative WSGS consumer handoff bundle.                 |
| AC-U016 | BLOCKED | Generated TypeScript             | BLOCKED: Generated TypeScript requires bytes from the missing authoritative WSGS consumer handoff bundle.             |
| AC-U017 | BLOCKED | Generate check                   | BLOCKED: Generate check requires bytes from the missing authoritative WSGS consumer handoff bundle.                   |
| AC-U018 | BLOCKED | No source-code commit lock       | BLOCKED: No source-code commit lock requires bytes from the missing authoritative WSGS consumer handoff bundle.       |
| AC-U019 | BLOCKED | No fixed capability count        | BLOCKED: No fixed capability count requires bytes from the missing authoritative WSGS consumer handoff bundle.        |
| AC-U020 | BLOCKED | No authority-field acceptance    | BLOCKED: No authority-field acceptance requires bytes from the missing authoritative WSGS consumer handoff bundle.    |
| AC-U021 | BLOCKED | Transport auth preserved         | BLOCKED: Transport auth preserved requires bytes from the missing authoritative WSGS consumer handoff bundle.         |
| AC-U022 | BLOCKED | Unknown extension rejected       | BLOCKED: Unknown extension rejected requires bytes from the missing authoritative WSGS consumer handoff bundle.       |
| AC-U023 | BLOCKED | Missing profile blocker          | BLOCKED: Missing profile blocker requires bytes from the missing authoritative WSGS consumer handoff bundle.          |
| AC-U024 | BLOCKED | Provisional fixture labeled      | BLOCKED: Provisional fixture labeled requires bytes from the missing authoritative WSGS consumer handoff bundle.      |
| AC-U025 | BLOCKED | No GDPS direct lock planning     | BLOCKED: No GDPS direct lock planning requires bytes from the missing authoritative WSGS consumer handoff bundle.     |
| AC-U026 | BLOCKED | Secret scan                      | BLOCKED: Secret scan requires bytes from the missing authoritative WSGS consumer handoff bundle.                      |
| AC-U027 | BLOCKED | Intake report                    | BLOCKED: Intake report requires bytes from the missing authoritative WSGS consumer handoff bundle.                    |
| AC-U028 | BLOCKED | S14 marker                       | BLOCKED: S14 marker requires bytes from the missing authoritative WSGS consumer handoff bundle.                       |

## Regressions

No row is bulk-passed. The full 565-case accounting and the 0.4.0 container candidate pass locally; required exact-head CI/GIT, compose, live-chain, SACS-runtime recovery, and PR evidence retains explicit BLOCKED/NOT_RUN status.

## Commit / Push / Draft PR

Local implementation evidence may reference local commits. This report does not claim a push, PR update, merge, tag, release, or deployment.

## Marker

`SACS_WSGS_GEOSPATIAL_CONTRACT_READY`: **WITHHELD**

## Blockers

Authoritative WSGS geospatial consumer handoff/live-chain evidence is unavailable.
