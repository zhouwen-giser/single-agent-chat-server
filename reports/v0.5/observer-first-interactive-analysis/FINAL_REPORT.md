# SACS v0.5 Observer-First Interactive Analysis — Final Report

> Historical status: `SUPERSEDED_STRICT_QUALIFICATION`. This 418-row global
> decision is retained for audit only and is not an active v0.5 product gate.

## Decision

`SACS_V0_5_OBSERVER_FIRST_INTERACTIVE_ANALYSIS_BLOCKED`

A bounded local v0.5 component/scaffold candidate is implemented and its
focused checks pass. The product upgrade is not implementation-complete,
qualified or promotion-ready: the inherited v0.4 geospatial prerequisite is
blocked, the authoritative eight-file WSGS analysis handoff is absent, and
the required A14 real chain is unavailable.

## Source and branch state

- Branch: `codex/sacs-v0.5-observer-first-interactive-analysis`
- Starting commit: `8262685`
- Intake commit after local stack reconciliation: `072e34b`
- Implementation commit after local stack reconciliation: `36df690`
- Migration-stack verification commit: `9ce9b22`
- Task-package SHA-256:
  `44497cd392ca7b0892da707af97c37f7364ed993d05a89e0b89da51a4bdf128f`

No push, PR mutation, CI run, merge, tag, release or deployment was performed.

## Task-package intake

The ZIP was validated and safely imported as 73 entries: 19 schemas, 15
phases, 28 E2E cases and 418 acceptance rows. Package instructions were
treated as requirements, not as authorization for publication or external
mutation.

Three canonical package conflicts are preserved rather than silently repaired:

1. 25 A14-FINAL rows require `REPORT`, which the template allowlist omits.
2. The A14-E2E-01 template reduces a five-type ALL-OF requirement to
   `REAL_CHAIN`.
3. The template contains top-level metadata forbidden by its canonical schema.

The reproducible intake ledger therefore remains 0 PASS, 0 FAIL, 347 NOT_RUN
and 71 BLOCKED. Local test success does not bulk-promote ledger rows.

## WSGS analysis consumer

The consumer verifies exact artifact inventory, raw bytes, checksums, bundle
hash, WSGS SHA, schemas, transport mode and declared sequence/idempotency/
recovery semantics. The task package is explicitly provisional and cannot
create authority.

Current status is `SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY`: none of the eight
authoritative artifacts was supplied. Production does not construct an
analysis WSGS HTTP client from guessed endpoints or reuse the v0.4 grounding
adapter.

## Local implementation

The candidate adds:

- strict Analysis Session, immutable Revision, Run, Node, Event, Projection,
  Proposal, Intervention, focus, map and timeline contracts;
- append-only migration `0015_interactive_analysis.sql` after the v0.4
  structured-selection migration, with principal/thread
  scoped repository access;
- event integrity, two-phase event acceptance, transactional projection and
  active-run/revision isolation;
- Observer/EXCEPTION_ONLY policy with permission, budget and risk precedence;
- AG-UI v0.3 profile negotiation while preserving v0.2;
- an opaque v0.3 analysis-handler registration that requires an authorized
  WSGS consumer plus control-ready declaration;
- canonical/hash-verified State snapshots, guarded State/Activity deltas,
  bounded Tool Call projection and snapshot-first interrupt projection;
- separated map observation, inspection focus and timeline playback;
- bounded Proposal, immutable WSGS-compiled Revision, cancel and intervention
  coordination with exact idempotency replay;
- queued Revision persistence that leaves the current Revision active until
  the old Run is terminal, followed by atomic activation/new-Run insertion;
- a headless official-event reference client with reconnect snapshot latches,
  lineage checks, stale-run isolation and local map-render failure isolation.

The candidate deliberately does not claim crash-safe control side effects.
Cancel/intervention still require an authoritative WSGS idempotency/status
contract before a durable intent/outbox and startup reconciliation loop can be
safely composed. Without that handoff, a production adapter could otherwise
split brain if WSGS succeeds and the local settlement transaction fails.

## Production fail-closed state

`main.ts` intentionally injects neither a v0.3 analysis handler nor an
analysis-control service. Consequently:

- v0.2 remains the default compatible profile;
- v0.3 capabilities and run requests return 503 while the analysis runtime is
  unavailable;
- analysis-control endpoints return
  `SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY`;
- no business POST is sent to a guessed or provisional WSGS endpoint.

This is the required behavior until a verified authoritative handoff and
production store/transport composition exist.

## Verification

Per the request to reduce unnecessary tests, only v0.5 and directly affected
boundaries were run:

- focused Jest: 16 suites / 116 tests PASS;
- real PostgreSQL suite: 1 suite / 7 tests PASS on a dedicated ephemeral
  PostgreSQL 16 container; the exact container was removed afterward;
- one supplementary read-only `GROUND_REFERENCES` call to isolated WSGS
  `18277`: HTTP 202, terminal HTTP 200 / `COMPLETED`, one reference product,
  no error and no capability gap. This does not satisfy either missing
  authoritative handoff or the A14 analysis chain;
- TypeScript typecheck and build: PASS;
- scoped ESLint: PASS;
- v0.5 architecture: PASS across 111 files;
- existing architecture regression: PASS across 115 files;
- migration gate: PASS across 15 contiguous append-only migrations;
- acceptance artifact drift check: PASS, with the three preserved conflicts;
- secret-pattern gate: PASS across 780 files;
- Git diff check: PASS.

Historical full-suite, Docker, live WSGS and real A14 E2E were intentionally
not run.

## Remaining blockers

- `SACS_V04_GEOSPATIAL_EXPLANATION_BASELINE_NOT_READY`
- `SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY`
- `AUTHORITATIVE_CONTROL_RECOVERY_SEMANTICS_MISSING`
- `SACS_INTERACTIVE_LIVE_ENVIRONMENT_NOT_READY`
- `EXACT_HEAD_CI_AND_GIT_PUBLICATION_NOT_RUN`

The final completion/readiness markers remain withheld.
