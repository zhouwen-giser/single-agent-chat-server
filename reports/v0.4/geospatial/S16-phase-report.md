# SACS Geospatial Explanation Phase Report — S16

## Phase

S16: **PASS**

## Source SHAs

See `reports/v0.4/geospatial/S13-source-lock.json`; source, runtime, and deployment identities remain distinct.

## Upstream profile/lock hashes

The checked-in consumer lock is explicitly provisional and `BLOCKED`. It is not an authoritative WSGS handoff.

## Changes

See the phase-scoped source and test evidence mapped in `acceptance-ledger.json`.

## Tests actually run

| command                       | result                          | evidence                                      |
| ----------------------------- | ------------------------------- | --------------------------------------------- |
| focused Jest S15-S18 file set | PASS within 8 suites / 72 tests | assembler and renderer hostile-input coverage |

Fixture or unit evidence is supplementary wherever the matrix requires REAL_WSGS.

## Acceptance IDs

Summary: 32 PASS, 0 FAIL, 0 NOT_RUN, 0 BLOCKED (32 total).

| ID      | status | scenario                     | decision                                                                                                                                             |
| ------- | ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-N001 | PASS   | Profile hash                 | PASS: local source, contract, or test evidence independently verifies Profile hash — Mismatch rejected.                                              |
| AC-N002 | PASS   | Finding ID uniqueness        | PASS: local source, contract, or test evidence independently verifies Finding ID uniqueness — Duplicates rejected.                                   |
| AC-N003 | PASS   | SourceProduct ID uniqueness  | PASS: local source, contract, or test evidence independently verifies SourceProduct ID uniqueness — Duplicates rejected.                             |
| AC-N004 | PASS   | Finding evidence closure     | PASS: local source, contract, or test evidence independently verifies Finding evidence closure — Unknown evidence ID rejected.                       |
| AC-N005 | PASS   | Finding source closure       | PASS: local source, contract, or test evidence independently verifies Finding source closure — Unknown sourceProduct ID rejected.                    |
| AC-N006 | PASS   | Source evidence closure      | PASS: local source, contract, or test evidence independently verifies Source evidence closure — Unknown evidence ID rejected.                        |
| AC-N007 | PASS   | Reference closure            | PASS: local source, contract, or test evidence independently verifies Reference closure — Unknown reference product cannot be narrated.              |
| AC-N008 | PASS   | Status compatibility         | PASS: local source, contract, or test evidence independently verifies Status compatibility — NO_DATA cannot carry completed factual value.           |
| AC-N009 | PASS   | Point geometry               | PASS: local source, contract, or test evidence independently verifies Point geometry — Invalid point rejected.                                       |
| AC-N010 | PASS   | Measurement finite           | PASS: local source, contract, or test evidence independently verifies Measurement finite — NaN/infinity rejected.                                    |
| AC-N011 | PASS   | Unit presence                | PASS: local source, contract, or test evidence independently verifies Unit presence — Measurement/profile unit required.                             |
| AC-N012 | PASS   | Class code                   | PASS: local source, contract, or test evidence independently verifies Class code — Non-empty bounded class required.                                 |
| AC-N013 | PASS   | Feature count parity         | PASS: local source, contract, or test evidence independently verifies Feature count parity — returnedCount and returned features interpreted safely. |
| AC-N014 | PASS   | Truncated                    | PASS: local source, contract, or test evidence independently verifies Truncated — Partial semantics retained.                                        |
| AC-N015 | PASS   | Feature identity             | PASS: local source, contract, or test evidence independently verifies Feature identity — Feature ID required.                                        |
| AC-N016 | PASS   | Feature locator              | PASS: local source, contract, or test evidence independently verifies Feature locator — At least safe locator/attributes required.                   |
| AC-N017 | PASS   | Geometry budget              | PASS: local source, contract, or test evidence independently verifies Geometry budget — Oversized geometry becomes ref/warning or fails closed.      |
| AC-N018 | PASS   | Feature budget               | PASS: local source, contract, or test evidence independently verifies Feature budget — Over limit cannot silently truncate without gap.              |
| AC-N019 | PASS   | Profile order                | PASS: local source, contract, or test evidence independently verifies Profile order — Distance samples nondecreasing.                                |
| AC-N020 | PASS   | Profile budget               | PASS: local source, contract, or test evidence independently verifies Profile budget — Sample limit enforced.                                        |
| AC-N021 | PASS   | Qualified explanation        | PASS: local source, contract, or test evidence independently verifies Qualified explanation — Only published summary/reason codes retained.          |
| AC-N022 | PASS   | Catalog result               | PASS: local source, contract, or test evidence independently verifies Catalog result — Catalog items not treated as world objects.                   |
| AC-N023 | PASS   | Unknown finding kind         | PASS: local source, contract, or test evidence independently verifies Unknown finding kind — Unsupported schema gap; no claim.                       |
| AC-N024 | PASS   | Unknown profile              | PASS: local source, contract, or test evidence independently verifies Unknown profile — Entire extension not trusted.                                |
| AC-N025 | PASS   | Generic safePayload          | PASS: local source, contract, or test evidence independently verifies Generic safePayload — Never creates finding.                                   |
| AC-N026 | PASS   | Asset URI redaction          | PASS: local source, contract, or test evidence independently verifies Asset URI redaction — Internal URI removed/rejected.                           |
| AC-N027 | PASS   | Foreign scope leak           | PASS: local source, contract, or test evidence independently verifies Foreign scope leak — No product/reference detail exposed.                      |
| AC-N028 | PASS   | Unknown published attributes | PASS: local source, contract, or test evidence independently verifies Unknown published attributes — Not narrated by default.                        |
| AC-N029 | PASS   | Normalization report         | PASS: local source, contract, or test evidence independently verifies Normalization report — Every dropped/partial item has issue.                   |
| AC-N030 | PASS   | Determinism                  | PASS: local source, contract, or test evidence independently verifies Determinism — Same input gives same normalized output.                         |
| AC-N031 | PASS   | Fuzz/hostile JSON            | PASS: local source, contract, or test evidence independently verifies Fuzz/hostile JSON — No prototype pollution/control-text leak.                  |
| AC-N032 | PASS   | S16 marker                   | PASS: local source, contract, or test evidence independently verifies S16 marker — Normalizer marker emitted.                                        |

## Regressions

No row is bulk-passed. The full 565-case accounting and the 0.4.0 container candidate pass locally; required exact-head CI/GIT, compose, live-chain, SACS-runtime recovery, and PR evidence retains explicit BLOCKED/NOT_RUN status.

## Commit / Push / Draft PR

Local implementation evidence may reference local commits. This report does not claim a push, PR update, merge, tag, release, or deployment.

## Marker

`SACS_GEOSPATIAL_FINDING_NORMALIZER_READY`: **ASSERTED**

## Blockers

No local implementation blocker is recorded; final live completion remains blocked upstream.
