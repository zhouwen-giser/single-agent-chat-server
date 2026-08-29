# SACS Geospatial Explanation Phase Report — S22

## Phase

S22: **BLOCKED**

## Source SHAs

See `reports/v0.4/geospatial/S13-source-lock.json`; source, runtime, and deployment identities remain distinct.

## Upstream profile/lock hashes

The checked-in consumer lock is explicitly provisional and `BLOCKED`. It is not an authoritative WSGS handoff.

## Changes

See the phase-scoped source and test evidence mapped in `acceptance-ledger.json`.

## Tests actually run

| command                       | result                          | evidence                           |
| ----------------------------- | ------------------------------- | ---------------------------------- |
| focused Jest S21-S23 file set | PASS within 5 suites / 45 tests | WSGS-only currentness policy suite |

Fixture or unit evidence is supplementary wherever the matrix requires REAL_WSGS.

## Acceptance IDs

Summary: 0 PASS, 0 FAIL, 0 NOT_RUN, 13 BLOCKED (13 total).

| ID      | status  | scenario                   | decision                                                                                                                                                                    |
| ------- | ------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-G016 | BLOCKED | Currentness via WSGS       | BLOCKED: Currentness via WSGS has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.       |
| AC-G017 | BLOCKED | Currentness mode from lock | BLOCKED: Currentness mode from lock has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff. |
| AC-G018 | BLOCKED | CURRENT                    | BLOCKED: CURRENT has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.                    |
| AC-G019 | BLOCKED | CHANGED strict             | BLOCKED: CHANGED strict has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.             |
| AC-G020 | BLOCKED | CHANGED best effort        | BLOCKED: CHANGED best effort has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.        |
| AC-G021 | BLOCKED | NOT_AVAILABLE              | BLOCKED: NOT_AVAILABLE has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.              |
| AC-G022 | BLOCKED | UNSUPPORTED currentness    | BLOCKED: UNSUPPORTED currentness has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.    |
| AC-G023 | BLOCKED | Previous and actual hashes | BLOCKED: Previous and actual hashes has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff. |
| AC-G024 | BLOCKED | No historical query        | BLOCKED: No historical query has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.        |
| AC-G025 | BLOCKED | Historical transcript      | BLOCKED: Historical transcript has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.      |
| AC-G026 | BLOCKED | Current UI label           | BLOCKED: Current UI label has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.           |
| AC-G027 | BLOCKED | Safe retry bound           | BLOCKED: Safe retry bound has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.           |
| AC-G028 | BLOCKED | S21/S22 markers            | BLOCKED: S21/S22 markers has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.            |

## Regressions

No row is bulk-passed. The full 565-case accounting and the 0.4.0 container candidate pass locally; required exact-head CI/GIT, compose, live-chain, SACS-runtime recovery, and PR evidence retains explicit BLOCKED/NOT_RUN status.

## Commit / Push / Draft PR

Local implementation evidence may reference local commits. This report does not claim a push, PR update, merge, tag, release, or deployment.

## Marker

`SACS_GEOSPATIAL_CURRENTNESS_READY`: **WITHHELD**

## Blockers

Authoritative WSGS geospatial consumer handoff/live-chain evidence is unavailable.
