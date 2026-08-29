# EP: SACS v0.4 Geospatial Explanation

## Actual source truth

See `reports/v0.4/geospatial/S13-source-lock.json`.

## Upstream handoff status

`SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY`: the authoritative WSGS-owned SACS
geospatial finding bundle is absent at the fetched WSGS PR #6 head.

## Branch / PR state

- Local stacked branch: `codex/sacs-v0.4-geospatial-explanation`
- Exact base: SACS PR #15 head `2dcbbe1c6074a54e0c332337f03a4e5574c19e06`
- Publication: not run; no new PR exists

## Progress

- [x] S13
- [ ] S14 — strict fail-closed intake implemented; authoritative marker blocked
- [x] S15
- [x] S16
- [x] S17
- [x] S18
- [x] S19
- [ ] S20 — local resolver/focus primitives pass; trusted structured selection ingress absent
- [ ] S21 — local policy passes; required REAL_WSGS evidence unavailable
- [ ] S22 — local policy passes; required REAL_WSGS evidence unavailable
- [x] S23
- [ ] S24 — real E2E blocked until the authoritative profile and runtime exist

## Decisions

- SACS consumes only a schema-locked WSGS profile and never decodes raw GDPS
  outputs or contacts GDPS/GOWM.
- Task-package proposal fixtures can prove local contracts only.
- OpenAI and AG-UI must project one persisted `WorldExplanationV1`.
- Geospatial findings remain world context and cannot alter SDAR Task truth.

## Applied migrations

Append-only `0013_world_explanation.sql` is applied and verified on isolated
PostgreSQL, including exact replay after a physical restart of the dedicated
test container.

## Real evidence

- Final local Jest: 456 PASS, 109 skipped, 565 total.
- Isolated PostgreSQL: S19 12/12, S20 28/28, S23 5/5 real-database tests;
  WSGS transport in S23 remained an injected protocol fixture.
- S24 preflight: BLOCKED by the provisional consumer lock before credentials,
  readiness/capability GETs, or business POSTs; current shared runtime state is
  `NOT_VERIFIED` by this goal.

## Blockers

- `SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY`
- `STRUCTURED_GEOSPATIAL_SELECTION_INGRESS_UNAVAILABLE`
- `REAL_WSGS_GEOSPATIAL_EVIDENCE_UNAVAILABLE`
- `EXACT_HEAD_CI_AND_GIT_PUBLICATION_NOT_RUN`
