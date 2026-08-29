# SACS Geospatial Explanation Phase Report — S20

## Phase

S20: **BLOCKED**

## Source SHAs

See `reports/v0.4/geospatial/S13-source-lock.json`; source, runtime, and deployment identities remain distinct.

## Upstream profile/lock hashes

The checked-in consumer lock is explicitly provisional and `BLOCKED`. It is not an authoritative WSGS handoff.

## Changes

See the phase-scoped source and test evidence mapped in `acceptance-ledger.json`.

## Tests actually run

| command                                           | result                   | evidence                                                                                                    |
| ------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| pnpm test:v04:s20 with isolated TEST_DATABASE_URL | PASS 4 suites / 28 tests | local resolver/focus/application/PostgreSQL only; structured selection ingress and REAL_WSGS remain BLOCKED |

Fixture or unit evidence is supplementary wherever the matrix requires REAL_WSGS.

## Acceptance IDs

Summary: 0 PASS, 0 FAIL, 0 NOT_RUN, 22 BLOCKED (22 total).

| ID      | status  | scenario                            | decision                                                                                                                                                 |
| ------- | ------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-M001 | BLOCKED | Existing known reference follow-up  | BLOCKED: Existing known reference follow-up requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.  |
| AC-M002 | BLOCKED | PendingChoice selection             | BLOCKED: PendingChoice selection requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.             |
| AC-M003 | BLOCKED | Reference revalidation              | BLOCKED: Reference revalidation requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.              |
| AC-M004 | BLOCKED | Finding ReferenceKey stored         | BLOCKED: Finding ReferenceKey stored requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.         |
| AC-M005 | BLOCKED | Finding ordinal stored              | BLOCKED: Finding ordinal stored requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.              |
| AC-M006 | BLOCKED | Second feature with ReferenceKey    | BLOCKED: Second feature with ReferenceKey requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.    |
| AC-M007 | BLOCKED | Second feature without ReferenceKey | BLOCKED: Second feature without ReferenceKey requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only. |
| AC-M008 | BLOCKED | Pronoun with stable reference       | BLOCKED: Pronoun with stable reference requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.       |
| AC-M009 | BLOCKED | Bare array pronoun                  | BLOCKED: Bare array pronoun requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.                  |
| AC-M010 | BLOCKED | Map selection reference             | BLOCKED: Map selection reference requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.             |
| AC-M011 | BLOCKED | Map selection geometry hash         | BLOCKED: Map selection geometry hash requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.         |
| AC-M012 | BLOCKED | Cross-thread isolation              | BLOCKED: Cross-thread isolation requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.              |
| AC-M013 | BLOCKED | Cross-principal isolation           | BLOCKED: Cross-principal isolation requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.           |
| AC-M014 | BLOCKED | Expired reference                   | BLOCKED: Expired reference requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.                   |
| AC-M015 | BLOCKED | Stale source                        | BLOCKED: Stale source requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.                        |
| AC-M016 | BLOCKED | Prior explanation lookup            | BLOCKED: Prior explanation lookup requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.            |
| AC-M017 | BLOCKED | No prior grounding weakening        | BLOCKED: No prior grounding weakening requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.        |
| AC-M018 | BLOCKED | Original query continuation         | BLOCKED: Original query continuation requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.         |
| AC-M019 | BLOCKED | Ambiguous follow-up                 | BLOCKED: Ambiguous follow-up requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.                 |
| AC-M020 | BLOCKED | Map display historical label        | BLOCKED: Map display historical label requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.        |
| AC-M021 | BLOCKED | World focus revision                | BLOCKED: World focus revision requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.                |
| AC-M022 | BLOCKED | S20 marker                          | BLOCKED: S20 marker requires same-shape REAL_WSGS plus scoped PostgreSQL evidence; local resolver tests are supplementary only.                          |

## Regressions

No row is bulk-passed. The full 565-case accounting and the 0.4.0 container candidate pass locally; required exact-head CI/GIT, compose, live-chain, SACS-runtime recovery, and PR evidence retains explicit BLOCKED/NOT_RUN status.

## Commit / Push / Draft PR

Local implementation evidence may reference local commits. This report does not claim a push, PR update, merge, tag, release, or deployment.

## Marker

`SACS_GEOSPATIAL_MULTITURN_READY`: **WITHHELD**

## Blockers

STRUCTURED_GEOSPATIAL_SELECTION_INGRESS_UNAVAILABLE: the frozen northbound contracts contain no trusted Finding selector or MapSelection envelope; free text, OpenAI passthrough fields, AG-UI state/context/forwardedProps, and TurnPlan booleans cannot be promoted to world identity. Authoritative REAL_WSGS evidence is also unavailable.
