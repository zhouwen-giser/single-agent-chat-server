## Scope

Continue the existing v0.6 branch with the Frozen WSGS Consumer C00–C06 goal. Only SACS changes; upstream public bytes are immutable. Reuse existing Grounding Job/Analysis/pump/AG-UI composition. Source execution; no Docker, real upstream/model/device, release or deployment gates. Existing historical reports remain historical.

## Progress

- C00: imported 117 exact public files; real SACS loader ran all 44 official examples plus tamper/hash/boundary cases (52 tests). Commit e870717.
- C01: exact 1.2 HTTP decoding/negotiation and budgets; stored contract identity and scoped restore; cancellation intent/uncertainty/terminal-race handling. Local HTTP and memory/SQL-driver boundaries, old 1.0/1.1 regressions. See generated C01.json and logs for final verified outcomes.
- C02: normal mapper consumes five public Finding types plus geo; deterministic text/map/timeline preserves proof, gaps, source identities, original time bounds and ranking values. Full public validation before view clipping. The cumulative phase run passed 195 tests, typecheck, architecture and lint with zero errors.
- C03 complete: normal source proposal/Choice control, durable pre-HTTP intent, parent revision CAS, atomic next-revision binding, history-safe late observations and per-revision pump. Chat and AG-UI share the resolved internal principal while ordinary SDAR retains its external user identity. Final stable-source verification passed 358 tests / 23 suites, including all 23 real normal-entry HTTP cases; typecheck/architecture/migrations/diff passed. Lint: zero errors, 142 recorded warnings.
- C04 complete: 110 tests / 6 suites passed, including exact independent LineString previews, same-source text/map/timeline/Choice, authoritative hidden selection and non-executing historical targets. Typecheck/architecture/migrations/diff passed; lint 0 errors / 108 warnings. Initial four 20-second Jest timeouts are preserved; a bounded 60-second integration test budget passed the rerun without changing production timeouts, TTL or assertions.
- C05 complete: 116 tests / 9 suites passed, including all 23 normal-entry cases, synchronous/asynchronous source projection and both cross-entry directions. Typecheck/architecture/migrations/diff passed; lint 0 errors / 88 warnings. Logs retain exact stdout/stderr bytes.
- C06 complete: the delivered all-source CLI passed **521 tests / 42 suites**, including the CLI contract and all 23 normal-entry cases. Typecheck/architecture/migrations/diff passed; lint 0 errors / 142 warnings. Final audit verified 43 successful command logs, 160 evidence references, the unchanged 40-scenario matrix and the exact final source-tree digest.
- REQUIRED ledger: **40/40 PASS**. Decision: **SACS_WSGS_FROZEN_WORLD_ANALYSIS_CONSUMER_DEV_READY** (L0/L1 consumer development only). This PR remains Draft, not production/release-ready. See `FINAL_REPORT.md`, `FINAL_EVIDENCE_AUDIT.json` and `SOURCE_RUN.md` under `reports/v0.6/frozen-wsgs-consumer/`.

## Evidence and limits

`reports/v0.6/frozen-wsgs-consumer/ACCEPTANCE_LEDGER.json` is generated from actual executed tests, not the upstream verification report alone. Core tests call the real HTTP adapter against a loopback wire fixture. Real PostgreSQL restart is ENV-001 NOT_RUN; no claim of real upstream integration or real model quality. No merge or force-push; final merge remains user-controlled.
