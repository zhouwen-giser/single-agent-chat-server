# SACS v0.4 Geospatial Explanation Final Report

## Decision

**BLOCKED** — safe local implementation evidence exists, but the authoritative WSGS-owned geospatial consumer handoff/profile and real SACS→WSGS→GOWM→GDPS evidence are unavailable.

## Source and PR State

The pre-change source/PR/CI baseline is recorded in `S13-source-lock.json`. Subsequent implementation is local on `codex/sacs-v0.4-geospatial-explanation`; this report does not claim an exact-head CI run, push, or PR update.

## WSGS Geospatial Consumer Profile

The checked-in profile is a task-package proposal with consumer-lock status `BLOCKED`. It cannot authorize geospatial business requests or satisfy any acceptance row that requires `UPSTREAM_LOCK` or `REAL_WSGS`.

## WorldExplanation Contract

A strict `WorldExplanationV1` contract, canonical hash, six-part replay identity, typed finding/source/gap closure, and append-only migration 0013 are implemented locally.

## Finding Normalization

The normalizer accepts only the six locked finding kinds and authoritative WSGS fields. Raw GDPS payloads, `safePayload`, unknown extensions, authority overrides, and SACS-side spatial calculations remain rejected.

## Narrative and Protocol Projections

The deterministic zh/en renderer produces the one persisted explanation projected to OpenAI, AG-UI typed events, map features, and replay. Hybrid presentation keeps SDAR task truth, WSGS/GOWM world truth, and SACS compare-only checks in three explicit sections; protocol-visible status text is redacted.

## Persistence and Replay

Migration 0013, isolated PostgreSQL behavior, physical database restart, and exact replay recovery pass; the S19 marker is asserted. The dedicated restart gate reports that no shared service was modified.

## Multi-turn

PendingChoice and thread-scoped WorldFocus are wired. FindingReferenceResolver and MapSelection remain safe primitives because the frozen northbound contracts have no trusted structured selection envelope, and feature-only ReferenceKeys are not automatically projected into persistent finding links. All S20 rows therefore remain BLOCKED.

## Gap and Currentness Semantics

Local gap and WSGS-only currentness policies pass their unit/contract evidence. Production currentness remains fail-closed while the authoritative lock is absent.

## Authority Fusion Boundary

The evaluator remains typed and geospatial findings remain contextual. The exact three-section hybrid runtime, protocol parity, and six-part replay identity pass focused local source/unit/HTTP/isolated-PostgreSQL evidence; the PostgreSQL run used an injected WSGS protocol fixture and is not REAL_WSGS evidence.

## Real SACS→WSGS→GOWM→GDPS E2E

All 18 required real cases are BLOCKED. The S24 preflight validates the provisional lock and stops before reading transport credentials, issuing GETs, or sending business POSTs.

## Regression / Security / Container

The final local repository run passed 60 suites and 456 tests, with 15 suites and 109 tests skipped (565 total). Migration, architecture, secret-pattern, build, and container verification gates pass locally. Their S24 acceptance rows remain BLOCKED because the matrix additionally requires exact-head CI and GIT publication evidence. Compose/live-chain, SACS-runtime recovery, and PR gates remain BLOCKED or NOT_RUN.

## Known Limitations

The authoritative WSGS consumer bundle and live geospatial profile are absent; S20 lacks a versioned trusted selection ingress; all REAL_WSGS/real Gateway/real GDPS-source rows are blocked; no final exact-head CI or Draft PR evidence exists because publication was not authorized.

## Acceptance ledger

189 PASS, 0 FAIL, 3 NOT_RUN, 113 BLOCKED across 305 independently mapped rows.

## Git / Draft PR

No push, PR update, merge, tag, release, deployment, or shared-infrastructure mutation is claimed by this report.

## Final Marker

`SACS_V0_4_WORLD_GROUNDING_GEOSPATIAL_EXPLANATION_BLOCKED`
