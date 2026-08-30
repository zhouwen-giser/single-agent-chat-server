# SACS Geospatial Explanation Phase Report — S17

## Phase

S17: **PASS**

## Source SHAs

See `reports/v0.4/geospatial/S13-source-lock.json`; source, runtime, and deployment identities remain distinct.

## Upstream profile/lock hashes

The checked-in consumer lock is explicitly provisional and `BLOCKED`. It is not an authoritative WSGS handoff.

## Changes

See the phase-scoped source and test evidence mapped in `acceptance-ledger.json`.

## Tests actually run

| command                       | result                          | evidence                             |
| ----------------------------- | ------------------------------- | ------------------------------------ |
| focused Jest S15-S18 file set | PASS within 8 suites / 72 tests | assembler, renderer, and hash suites |

Fixture or unit evidence is supplementary wherever the matrix requires REAL_WSGS.

## Acceptance IDs

Summary: 34 PASS, 0 FAIL, 0 NOT_RUN, 0 BLOCKED (34 total).

| ID      | status | scenario                   | decision                                                                                                                                    |
| ------- | ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-E001 | PASS   | Point value question kind  | PASS: local source, contract, or test evidence independently verifies Point value question kind — POINT_VALUE.                              |
| AC-E002 | PASS   | Point class question kind  | PASS: local source, contract, or test evidence independently verifies Point class question kind — POINT_CLASSIFICATION.                     |
| AC-E003 | PASS   | Features in area kind      | PASS: local source, contract, or test evidence independently verifies Features in area kind — FEATURES_IN_AREA.                             |
| AC-E004 | PASS   | Features nearby kind       | PASS: local source, contract, or test evidence independently verifies Features nearby kind — FEATURES_NEARBY.                               |
| AC-E005 | PASS   | Range areas kind           | PASS: local source, contract, or test evidence independently verifies Range areas kind — VALUE_RANGE_AREAS.                                 |
| AC-E006 | PASS   | Profile kind               | PASS: local source, contract, or test evidence independently verifies Profile kind — PROFILE.                                               |
| AC-E007 | PASS   | Qualified explanation kind | PASS: local source, contract, or test evidence independently verifies Qualified explanation kind — QUALIFIED_EXPLANATION.                   |
| AC-E008 | PASS   | Multi finding kind         | PASS: local source, contract, or test evidence independently verifies Multi finding kind — MULTI_FINDING.                                   |
| AC-E009 | PASS   | Chinese locale             | PASS: local source, contract, or test evidence independently verifies Chinese locale — Deterministic Chinese rendering.                     |
| AC-E010 | PASS   | English locale             | PASS: local source, contract, or test evidence independently verifies English locale — Deterministic English rendering.                     |
| AC-E011 | PASS   | Locale persistence         | PASS: local source, contract, or test evidence independently verifies Locale persistence — Replay retains locale.                           |
| AC-E012 | PASS   | No model call              | PASS: local source, contract, or test evidence independently verifies No model call — Renderer has no LLM dependency.                       |
| AC-E013 | PASS   | Point measurement text     | PASS: local source, contract, or test evidence independently verifies Point measurement text — Exact upstream value/unit.                   |
| AC-E014 | PASS   | Point class text           | PASS: local source, contract, or test evidence independently verifies Point class text — Exact class only.                                  |
| AC-E015 | PASS   | No cross-domain inference  | PASS: local source, contract, or test evidence independently verifies No cross-domain inference — Land cover does not imply traversability. |
| AC-E016 | PASS   | Collection count           | PASS: local source, contract, or test evidence independently verifies Collection count — Count and top-N correct.                           |
| AC-E017 | PASS   | Collection feature details | PASS: local source, contract, or test evidence independently verifies Collection feature details — Only allowed published fields.           |
| AC-E018 | PASS   | Empty collection           | PASS: local source, contract, or test evidence independently verifies Empty collection — No-match-in-current-data wording.                  |
| AC-E019 | PASS   | Data gap text              | PASS: local source, contract, or test evidence independently verifies Data gap text — No availability mistaken for absence.                 |
| AC-E020 | PASS   | Coverage gap text          | PASS: local source, contract, or test evidence independently verifies Coverage gap text — Coverage limitation explicit.                     |
| AC-E021 | PASS   | Capability gap text        | PASS: local source, contract, or test evidence independently verifies Capability gap text — Capability limitation explicit.                 |
| AC-E022 | PASS   | Reference ambiguity text   | PASS: local source, contract, or test evidence independently verifies Reference ambiguity text — Clarification requested.                   |
| AC-E023 | PASS   | Product ambiguity text     | PASS: local source, contract, or test evidence independently verifies Product ambiguity text — No automatic selection.                      |
| AC-E024 | PASS   | Truncated text             | PASS: local source, contract, or test evidence independently verifies Truncated text — Incomplete result explicit.                          |
| AC-E025 | PASS   | Source changed text        | PASS: local source, contract, or test evidence independently verifies Source changed text — Indeterminate/currentness language.             |
| AC-E026 | PASS   | Unknown schema text        | PASS: local source, contract, or test evidence independently verifies Unknown schema text — No fact claim.                                  |
| AC-E027 | PASS   | Quality text               | PASS: local source, contract, or test evidence independently verifies Quality text — Only present quality metrics rendered.                 |
| AC-E028 | PASS   | No fabricated confidence   | PASS: local source, contract, or test evidence independently verifies No fabricated confidence — Absent confidence remains absent.          |
| AC-E029 | PASS   | No ID dump                 | PASS: local source, contract, or test evidence independently verifies No ID dump — Normal answer avoids raw hash/ID clutter.                |
| AC-E030 | PASS   | Provenance preserved       | PASS: local source, contract, or test evidence independently verifies Provenance preserved — Structured metadata retains IDs.               |
| AC-E031 | PASS   | Text bound                 | PASS: local source, contract, or test evidence independently verifies Text bound — 16000 chars max.                                         |
| AC-E032 | PASS   | Deterministic hash         | PASS: local source, contract, or test evidence independently verifies Deterministic hash — Same input/policy gives same explanation hash.   |
| AC-E033 | PASS   | Safe escaping              | PASS: local source, contract, or test evidence independently verifies Safe escaping — Control/markdown injection neutralized.               |
| AC-E034 | PASS   | S17 marker                 | PASS: local source, contract, or test evidence independently verifies S17 marker — Narrative marker emitted.                                |

## Regressions

No row is bulk-passed. The full 565-case accounting and the 0.4.0 container candidate pass locally; required exact-head CI/GIT, compose, live-chain, SACS-runtime recovery, and PR evidence retains explicit BLOCKED/NOT_RUN status.

## Commit / Push / Draft PR

Local implementation evidence may reference local commits. This report does not claim a push, PR update, merge, tag, release, or deployment.

## Marker

`SACS_GEOSPATIAL_NARRATIVE_READY`: **ASSERTED**

## Blockers

No local implementation blocker is recorded; final live completion remains blocked upstream.
