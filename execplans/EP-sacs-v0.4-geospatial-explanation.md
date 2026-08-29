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
- [ ] S14 — authoritative marker blocked; fail-closed intake work pending
- [ ] S15
- [ ] S16
- [ ] S17
- [ ] S18
- [ ] S19
- [ ] S20
- [ ] S21
- [ ] S22
- [ ] S23
- [ ] S24 — real E2E blocked until the authoritative profile and runtime exist

## Decisions

- SACS consumes only a schema-locked WSGS profile and never decodes raw GDPS
  outputs or contacts GDPS/GOWM.
- Task-package proposal fixtures can prove local contracts only.
- OpenAI and AG-UI must project one persisted `WorldExplanationV1`.
- Geospatial findings remain world context and cannot alter SDAR Task truth.

## Applied migrations

None beyond the existing 0010–0012 baseline at S13.

## Real evidence

- SACS baseline Jest: 311 PASS, 100 skipped, 411 total.
- GOWM readiness: status ok, 122 capabilities.
- WSGS readiness: timeout; no live request evidence claimed.

## Blockers

- `SACS_WSGS_GEOSPATIAL_HANDOFF_NOT_READY`
- `SACS_GEOSPATIAL_LIVE_ENVIRONMENT_NOT_READY`
