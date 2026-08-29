# SACS Geospatial Explanation Phase Report — S15

## Phase

S15: **PASS**

## Source SHAs

See `reports/v0.4/geospatial/S13-source-lock.json`; source, runtime, and deployment identities remain distinct.

## Upstream profile/lock hashes

The checked-in consumer lock is explicitly provisional and `BLOCKED`. It is not an authoritative WSGS handoff.

## Changes

See the phase-scoped source and test evidence mapped in `acceptance-ledger.json`.

## Tests actually run

| command                       | result                          | evidence                                   |
| ----------------------------- | ------------------------------- | ------------------------------------------ |
| focused Jest S15-S18 file set | PASS within 8 suites / 72 tests | world explanation contract and hash suites |

Fixture or unit evidence is supplementary wherever the matrix requires REAL_WSGS.

## Acceptance IDs

Summary: 32 PASS, 0 FAIL, 0 NOT_RUN, 0 BLOCKED (32 total).

| ID      | status | scenario                    | decision                                                                                                                                  |
| ------- | ------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| AC-C001 | PASS   | Finding discriminated union | PASS: local source, contract, or test evidence independently verifies Finding discriminated union — Six finding kinds validate.           |
| AC-C002 | PASS   | Point measurement typed     | PASS: local source, contract, or test evidence independently verifies Point measurement typed — Point/value/unit required.                |
| AC-C003 | PASS   | Point classification typed  | PASS: local source, contract, or test evidence independently verifies Point classification typed — Point/classCode required.              |
| AC-C004 | PASS   | Feature collection typed    | PASS: local source, contract, or test evidence independently verifies Feature collection typed — count/truncated/features required.       |
| AC-C005 | PASS   | Profile typed               | PASS: local source, contract, or test evidence independently verifies Profile typed — unit/samples/truncated required.                    |
| AC-C006 | PASS   | Qualified explanation typed | PASS: local source, contract, or test evidence independently verifies Qualified explanation typed — code/summary/reasons required.        |
| AC-C007 | PASS   | Catalog typed               | PASS: local source, contract, or test evidence independently verifies Catalog typed — count/truncated/items required.                     |
| AC-C008 | PASS   | Finding IDs bounded         | PASS: local source, contract, or test evidence independently verifies Finding IDs bounded — Identifier contract enforced.                 |
| AC-C009 | PASS   | Finding evidence IDs        | PASS: local source, contract, or test evidence independently verifies Finding evidence IDs — At least one evidence item required.         |
| AC-C010 | PASS   | Source product identity     | PASS: local source, contract, or test evidence independently verifies Source product identity — Current product fields required.          |
| AC-C011 | PASS   | Content hash                | PASS: local source, contract, or test evidence independently verifies Content hash — SHA-256 required.                                    |
| AC-C012 | PASS   | Descriptor hash             | PASS: local source, contract, or test evidence independently verifies Descriptor hash — SHA-256 required.                                 |
| AC-C013 | PASS   | No productVersion           | PASS: local source, contract, or test evidence independently verifies No productVersion — History semantics absent.                       |
| AC-C014 | PASS   | Typed gaps                  | PASS: local source, contract, or test evidence independently verifies Typed gaps — All gap kinds strict.                                  |
| AC-C015 | PASS   | Map projection union        | PASS: local source, contract, or test evidence independently verifies Map projection union — Exactly reference/geometry/payloadRef.       |
| AC-C016 | PASS   | WorldExplanation identity   | PASS: local source, contract, or test evidence independently verifies WorldExplanation identity — ID/hash required.                       |
| AC-C017 | PASS   | Grounding identity          | PASS: local source, contract, or test evidence independently verifies Grounding identity — grounding ID/result hash/status required.      |
| AC-C018 | PASS   | Explanation statuses        | PASS: local source, contract, or test evidence independently verifies Explanation statuses — Six statuses strict.                         |
| AC-C019 | PASS   | Question kinds              | PASS: local source, contract, or test evidence independently verifies Question kinds — Nine kinds strict.                                 |
| AC-C020 | PASS   | Rendered text bound         | PASS: local source, contract, or test evidence independently verifies Rendered text bound — 1..16000 chars.                               |
| AC-C021 | PASS   | Explanation findings        | PASS: local source, contract, or test evidence independently verifies Explanation findings — Typed bounded summaries.                     |
| AC-C022 | PASS   | Explanation references      | PASS: local source, contract, or test evidence independently verifies Explanation references — GOWM ReferenceKey typed.                   |
| AC-C023 | PASS   | Sanitized source products   | PASS: local source, contract, or test evidence independently verifies Sanitized source products — No asset URI.                           |
| AC-C024 | PASS   | Provenance closure fields   | PASS: local source, contract, or test evidence independently verifies Provenance closure fields — evidence/receipt/operation/lock hashes. |
| AC-C025 | PASS   | Replay key                  | PASS: local source, contract, or test evidence independently verifies Replay key — Exact six-part key.                                    |
| AC-C026 | PASS   | World focus projection      | PASS: local source, contract, or test evidence independently verifies World focus projection — finding ordinal and optional ReferenceKey. |
| AC-C027 | PASS   | Currentness result          | PASS: local source, contract, or test evidence independently verifies Currentness result — CURRENT/CHANGED/NOT_AVAILABLE/UNKNOWN.         |
| AC-C028 | PASS   | Normalization report        | PASS: local source, contract, or test evidence independently verifies Normalization report — PASS/PARTIAL/FAIL typed.                     |
| AC-C029 | PASS   | Renderer policy             | PASS: local source, contract, or test evidence independently verifies Renderer policy — Hashable policy contract.                         |
| AC-C030 | PASS   | Canonical hash tests        | PASS: local source, contract, or test evidence independently verifies Canonical hash tests — Stable ordering and self-hash exclusion.     |
| AC-C031 | PASS   | Schema examples             | PASS: local source, contract, or test evidence independently verifies Schema examples — Complete/data-gap/map examples validate.          |
| AC-C032 | PASS   | S15 marker                  | PASS: local source, contract, or test evidence independently verifies S15 marker — Contract marker emitted.                               |

## Regressions

No row is bulk-passed. The full 565-case accounting and the 0.4.0 container candidate pass locally; required exact-head CI/GIT, compose, live-chain, SACS-runtime recovery, and PR evidence retains explicit BLOCKED/NOT_RUN status.

## Commit / Push / Draft PR

Local implementation evidence may reference local commits. This report does not claim a push, PR update, merge, tag, release, or deployment.

## Marker

`SACS_GEOSPATIAL_EXPLANATION_CONTRACT_READY`: **ASSERTED**

## Blockers

No local implementation blocker is recorded; final live completion remains blocked upstream.
