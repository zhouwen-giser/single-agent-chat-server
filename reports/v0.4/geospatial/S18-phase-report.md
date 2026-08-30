# SACS Geospatial Explanation Phase Report — S18

## Phase

S18: **PASS**

## Source SHAs

See `reports/v0.4/geospatial/S13-source-lock.json`; source, runtime, and deployment identities remain distinct.

## Upstream profile/lock hashes

The checked-in consumer lock is explicitly provisional and `BLOCKED`. It is not an authoritative WSGS handoff.

## Changes

See the phase-scoped source and test evidence mapped in `acceptance-ledger.json`.

## Tests actually run

| command                       | result                          | evidence                                                    |
| ----------------------------- | ------------------------------- | ----------------------------------------------------------- |
| focused Jest S15-S18 file set | PASS within 8 suites / 72 tests | projection, runtime, OpenAI HTTP, and AG-UI HTTP/SSE suites |

Fixture or unit evidence is supplementary wherever the matrix requires REAL_WSGS.

## Acceptance IDs

Summary: 26 PASS, 0 FAIL, 0 NOT_RUN, 0 BLOCKED (26 total).

| ID      | status | scenario                     | decision                                                                                                                                  |
| ------- | ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| AC-A001 | PASS   | OpenAI uses persisted text   | PASS: local source, contract, or test evidence independently verifies OpenAI uses persisted text — No re-render.                          |
| AC-A002 | PASS   | OpenAI explanation identity  | PASS: local source, contract, or test evidence independently verifies OpenAI explanation identity — ID/hash retained internally.          |
| AC-A003 | PASS   | AGUI world explanation event | PASS: local source, contract, or test evidence independently verifies AGUI world explanation event — Typed event/state.                   |
| AC-A004 | PASS   | AGUI map projection event    | PASS: local source, contract, or test evidence independently verifies AGUI map projection event — Typed event/state.                      |
| AC-A005 | PASS   | AGUI sources event           | PASS: local source, contract, or test evidence independently verifies AGUI sources event — Sanitized source metadata.                     |
| AC-A006 | PASS   | Cross-protocol hash          | PASS: local source, contract, or test evidence independently verifies Cross-protocol hash — Exact same explanation hash.                  |
| AC-A007 | PASS   | Cross-protocol findings      | PASS: local source, contract, or test evidence independently verifies Cross-protocol findings — Exact same finding IDs.                   |
| AC-A008 | PASS   | Cross-protocol gaps          | PASS: local source, contract, or test evidence independently verifies Cross-protocol gaps — Exact same gap semantics.                     |
| AC-A009 | PASS   | Map upstream geometry        | PASS: local source, contract, or test evidence independently verifies Map upstream geometry — Copied without calculation.                 |
| AC-A010 | PASS   | Map ReferenceKey             | PASS: local source, contract, or test evidence independently verifies Map ReferenceKey — Projected.                                       |
| AC-A011 | PASS   | Map payloadRef               | PASS: local source, contract, or test evidence independently verifies Map payloadRef — Projected.                                         |
| AC-A012 | PASS   | Map exactly-one locator      | PASS: local source, contract, or test evidence independently verifies Map exactly-one locator — No ambiguous locator.                     |
| AC-A013 | PASS   | Map labels                   | PASS: local source, contract, or test evidence independently verifies Map labels — Bounded safe labels.                                   |
| AC-A014 | PASS   | Map feature count            | PASS: local source, contract, or test evidence independently verifies Map feature count — 256 max.                                        |
| AC-A015 | PASS   | Large geometry fallback      | PASS: local source, contract, or test evidence independently verifies Large geometry fallback — Reference/payloadRef or warning.          |
| AC-A016 | PASS   | No buffer                    | PASS: local source, contract, or test evidence independently verifies No buffer — No spatial computation.                                 |
| AC-A017 | PASS   | No distance calculation      | PASS: local source, contract, or test evidence independently verifies No distance calculation — Only upstream distance.                   |
| AC-A018 | PASS   | No area calculation          | PASS: local source, contract, or test evidence independently verifies No area calculation — Only upstream area.                           |
| AC-A019 | PASS   | No asset URI                 | PASS: local source, contract, or test evidence independently verifies No asset URI — Never exposed.                                       |
| AC-A020 | PASS   | AGUI schema validation       | PASS: local source, contract, or test evidence independently verifies AGUI schema validation — All events accepted by SACS profile.       |
| AC-A021 | PASS   | OpenAI SSE/non-SSE parity    | PASS: local source, contract, or test evidence independently verifies OpenAI SSE/non-SSE parity — Same text.                              |
| AC-A022 | PASS   | AGUI replay                  | PASS: local source, contract, or test evidence independently verifies AGUI replay — Uses persisted explanation.                           |
| AC-A023 | PASS   | Protocol error safety        | PASS: local source, contract, or test evidence independently verifies Protocol error safety — No raw upstream error.                      |
| AC-A024 | PASS   | Custom event order           | PASS: local source, contract, or test evidence independently verifies Custom event order — Explanation before terminal run event.         |
| AC-A025 | PASS   | Activity/status projection   | PASS: local source, contract, or test evidence independently verifies Activity/status projection — Grounding/explanation states coherent. |
| AC-A026 | PASS   | S18 marker                   | PASS: local source, contract, or test evidence independently verifies S18 marker — Projection marker emitted.                             |

## Regressions

No row is bulk-passed. The full 565-case accounting and the 0.4.0 container candidate pass locally; required exact-head CI/GIT, compose, live-chain, SACS-runtime recovery, and PR evidence retains explicit BLOCKED/NOT_RUN status.

## Commit / Push / Draft PR

Local implementation evidence may reference local commits. This report does not claim a push, PR update, merge, tag, release, or deployment.

## Marker

`SACS_AGUI_GEOSPATIAL_PROJECTION_READY`: **ASSERTED**

## Blockers

No local implementation blocker is recorded; final live completion remains blocked upstream.
