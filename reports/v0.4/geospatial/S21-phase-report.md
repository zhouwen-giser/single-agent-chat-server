# SACS Geospatial Explanation Phase Report — S21

## Phase

S21: **BLOCKED**

## Source SHAs

See `reports/v0.4/geospatial/S13-source-lock.json`; source, runtime, and deployment identities remain distinct.

## Upstream profile/lock hashes

The checked-in consumer lock is explicitly provisional and `BLOCKED`. It is not an authoritative WSGS handoff.

## Changes

See the phase-scoped source and test evidence mapped in `acceptance-ledger.json`.

## Tests actually run

| command                       | result                          | evidence                    |
| ----------------------------- | ------------------------------- | --------------------------- |
| focused Jest S21-S23 file set | PASS within 5 suites / 45 tests | geospatial gap policy suite |

Fixture or unit evidence is supplementary wherever the matrix requires REAL_WSGS.

## Acceptance IDs

Summary: 0 PASS, 0 FAIL, 0 NOT_RUN, 15 BLOCKED (15 total).

| ID      | status  | scenario                    | decision                                                                                                                                                                     |
| ------- | ------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-G001 | BLOCKED | Completed normal            | BLOCKED: Completed normal has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.            |
| AC-G002 | BLOCKED | Completed empty             | BLOCKED: Completed empty has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.             |
| AC-G003 | BLOCKED | Partial upstream            | BLOCKED: Partial upstream has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.            |
| AC-G004 | BLOCKED | Truncated finding           | BLOCKED: Truncated finding has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.           |
| AC-G005 | BLOCKED | Data gap                    | BLOCKED: Data gap has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.                    |
| AC-G006 | BLOCKED | Coverage gap                | BLOCKED: Coverage gap has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.                |
| AC-G007 | BLOCKED | Capability gap              | BLOCKED: Capability gap has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.              |
| AC-G008 | BLOCKED | Reference ambiguity         | BLOCKED: Reference ambiguity has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.         |
| AC-G009 | BLOCKED | Product ambiguity           | BLOCKED: Product ambiguity has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.           |
| AC-G010 | BLOCKED | Source changed during query | BLOCKED: Source changed during query has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff. |
| AC-G011 | BLOCKED | Unknown schema              | BLOCKED: Unknown schema has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.              |
| AC-G012 | BLOCKED | Upstream failed             | BLOCKED: Upstream failed has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.             |
| AC-G013 | BLOCKED | Cancelled                   | BLOCKED: Cancelled has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.                   |
| AC-G014 | BLOCKED | NO_DATA not false           | BLOCKED: NO_DATA not false has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff.           |
| AC-G015 | BLOCKED | Missing product not absence | BLOCKED: Missing product not absence has local unit/contract coverage, but its required REAL_WSGS evidence cannot run without the authoritative geospatial consumer handoff. |

## Regressions

No row is bulk-passed. The full 565-case accounting and the 0.4.0 container candidate pass locally; required exact-head CI/GIT, compose, live-chain, SACS-runtime recovery, and PR evidence retains explicit BLOCKED/NOT_RUN status.

## Commit / Push / Draft PR

Local implementation evidence may reference local commits. This report does not claim a push, PR update, merge, tag, release, or deployment.

## Marker

`SACS_GEOSPATIAL_GAP_SEMANTICS_READY`: **WITHHELD**

## Blockers

Authoritative WSGS geospatial consumer handoff/live-chain evidence is unavailable.
