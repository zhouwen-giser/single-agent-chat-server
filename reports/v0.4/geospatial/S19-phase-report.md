# SACS Geospatial Explanation Phase Report — S19

## Phase

S19: **PASS**

## Source SHAs

See `reports/v0.4/geospatial/S13-source-lock.json`; source, runtime, and deployment identities remain distinct.

## Upstream profile/lock hashes

The checked-in consumer lock is explicitly provisional and `BLOCKED`. It is not an authoritative WSGS handoff.

## Changes

See the phase-scoped source and test evidence mapped in `acceptance-ledger.json`.

## Tests actually run

| command                                           | result                                                                    | evidence                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| pnpm test:v04:s19 with isolated TEST_DATABASE_URL | PASS 2 suites / 12 tests                                                  | contract plus tests/world-explanation-persistence.postgres.int.test.ts |
| node scripts/phase-v04-s19-restart-replay.mjs     | PASS; isolated PostgreSQL physically restarted and exact replay recovered | reports/v0.4/geospatial/S19-restart-replay.json                        |

Fixture or unit evidence is supplementary wherever the matrix requires REAL_WSGS.

## Acceptance IDs

Summary: 25 PASS, 0 FAIL, 0 NOT_RUN, 0 BLOCKED (25 total).

| ID      | status | scenario                          | decision                                                                                                                                                   |
| ------- | ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-P001 | PASS   | Migration 0013                    | PASS: local source, contract, or test evidence independently verifies Migration 0013 — Append-only contiguous migration.                                   |
| AC-P002 | PASS   | World explanation table           | PASS: local source, contract, or test evidence independently verifies World explanation table — Required columns/constraints.                              |
| AC-P003 | PASS   | Principal FK                      | PASS: local source, contract, or test evidence independently verifies Principal FK — Ownership constrained.                                                |
| AC-P004 | PASS   | Thread FK                         | PASS: local source, contract, or test evidence independently verifies Thread FK — Thread ownership constrained.                                            |
| AC-P005 | PASS   | Grounding identity                | PASS: local source, contract, or test evidence independently verifies Grounding identity — Grounding/result hash stored.                                   |
| AC-P006 | PASS   | Locale stored                     | PASS: local source, contract, or test evidence independently verifies Locale stored — Locale part of identity.                                             |
| AC-P007 | PASS   | Contract hash stored              | PASS: local source, contract, or test evidence independently verifies Contract hash stored — Exact consumer contract.                                      |
| AC-P008 | PASS   | Renderer policy hash stored       | PASS: local source, contract, or test evidence independently verifies Renderer policy hash stored — Exact renderer.                                        |
| AC-P009 | PASS   | Explanation JSON                  | PASS: local source, contract, or test evidence independently verifies Explanation JSON — Object and size bounded.                                          |
| AC-P010 | PASS   | Explanation hash                  | PASS: local source, contract, or test evidence independently verifies Explanation hash — SHA constraint.                                                   |
| AC-P011 | PASS   | Unique replay key                 | PASS: local source, contract, or test evidence independently verifies Unique replay key — Exact six-part uniqueness.                                       |
| AC-P012 | PASS   | Immutable identity                | PASS: local source, contract, or test evidence independently verifies Immutable identity — Cannot mutate keys.                                             |
| AC-P013 | PASS   | Exact replay                      | PASS: local source, contract, or test evidence independently verifies Exact replay — Same key returns same JSON/text.                                      |
| AC-P014 | PASS   | No second WSGS POST               | PASS: local source, contract, or test evidence independently verifies No second WSGS POST — Replay is local.                                               |
| AC-P015 | PASS   | New renderer policy               | PASS: local source, contract, or test evidence independently verifies New renderer policy — New explanation identity.                                      |
| AC-P016 | PASS   | New contract hash                 | PASS: local source, contract, or test evidence independently verifies New contract hash — New explanation identity.                                        |
| AC-P017 | PASS   | Cross-protocol replay             | PASS: local source, contract, or test evidence independently verifies Cross-protocol replay — Same persisted record.                                       |
| AC-P018 | PASS   | World focus pointers              | PASS: local source, contract, or test evidence independently verifies World focus pointers — Paired ID/hash with revision.                                 |
| AC-P019 | PASS   | Optional finding identity columns | PASS: local source, contract, or test evidence independently verifies Optional finding identity columns — Only reference-linked findings.                  |
| AC-P020 | PASS   | No large geometry duplication     | PASS: local source, contract, or test evidence independently verifies No large geometry duplication — Budget enforced.                                     |
| AC-P021 | PASS   | No product catalog table          | PASS: local source, contract, or test evidence independently verifies No product catalog table — SACS does not own GDPS data.                              |
| AC-P022 | PASS   | Real PostgreSQL migration         | PASS: local source, contract, or test evidence independently verifies Real PostgreSQL migration — 0010→0013 passes.                                        |
| AC-P023 | PASS   | Concurrent create                 | PASS: local source, contract, or test evidence independently verifies Concurrent create — Save-or-replay deterministic.                                    |
| AC-P024 | PASS   | Restart recovery                  | PASS: the dedicated S19 PostgreSQL container was physically restarted and the exact persisted explanation was recovered without modifying shared services. |
| AC-P025 | PASS   | S19 marker                        | PASS: the S19 replay marker is asserted after migration, exact replay, concurrency, and isolated physical restart evidence passed.                         |

## Regressions

No row is bulk-passed. The full 565-case accounting and the 0.4.0 container candidate pass locally; required exact-head CI/GIT, compose, live-chain, SACS-runtime recovery, and PR evidence retains explicit BLOCKED/NOT_RUN status.

## Commit / Push / Draft PR

Local implementation evidence may reference local commits. This report does not claim a push, PR update, merge, tag, release, or deployment.

## Marker

`SACS_GEOSPATIAL_EXPLANATION_REPLAY_READY`: **ASSERTED**

## Blockers

No local implementation blocker is recorded; final live completion remains blocked upstream.
