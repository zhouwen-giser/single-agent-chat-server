## Scope

Continue the existing v0.6 branch with the Frozen WSGS Consumer C00–C06 goal. Only SACS changes; upstream public bytes are immutable. Reuse existing Grounding Job/Analysis/pump/AG-UI composition. Source execution; no Docker, real upstream/model/device, release or deployment gates. Existing historical reports remain historical.

## Progress

- C00: imported 117 exact public files; real SACS loader ran all 44 official examples plus tamper/hash/boundary cases (52 tests). Commit e870717.
- C01: exact 1.2 HTTP decoding/negotiation and budgets; stored contract identity and scoped restore; cancellation intent/uncertainty/terminal-race handling. Local HTTP and memory/SQL-driver boundaries, old 1.0/1.1 regressions. See generated C01.json and logs for final verified outcomes.
- C02: normal mapper consumes five public Finding types plus geo; deterministic text/map/timeline preserves proof, gaps, source identities, original time bounds and ranking values. Full public validation before view clipping. The cumulative phase run passed 195 tests, typecheck, architecture and lint with zero errors.
- C03 complete: normal source proposal/Choice control, durable pre-HTTP intent, parent revision CAS, atomic next-revision binding, history-safe late observations and per-revision pump. Chat and AG-UI share the resolved internal principal while ordinary SDAR retains its external user identity. Final stable-source verification passed 358 tests / 23 suites, including all 23 real normal-entry HTTP cases; typecheck/architecture/migrations/diff passed. Lint: zero errors, 142 recorded warnings.
- C04/C05 implementation primitives and the C06 source CLI are included where needed by the integrated tests; their separate acceptance verification remains pending. Next: explicit LineString-preview assertion, presentation/normal-entry reconciliation and final delivered source CLI regression.
- REQUIRED ledger: 31/40 PASS, IN_PROGRESS. This PR remains Draft, not yet consumer-development-ready and not release-ready.

## Evidence and limits

`reports/v0.6/frozen-wsgs-consumer/ACCEPTANCE_LEDGER.json` is generated from actual executed tests, not the upstream verification report alone. Core tests call the real HTTP adapter against a loopback wire fixture. Real PostgreSQL restart is ENV-001 NOT_RUN; no claim of real upstream integration or real model quality. No merge or force-push; final merge remains user-controlled.
