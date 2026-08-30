# EP: SACS v0.5 Observer-First Interactive Analysis

## Actual source truth

- Branch: `codex/sacs-v0.5-observer-first-interactive-analysis`
- Starting commit: `0d67125ba1e8f2d69ad07480bacbe7ecf5bab774`
- Task package:
  `D:\downloads\SACS_v0.5_Observer_First_Interactive_Analysis_Codex_Goal.zip`
- Task-package SHA-256:
  `44497cd392ca7b0892da707af97c37f7364ed993d05a89e0b89da51a4bdf128f`
- Package validation: 73 safe entries, 19 schemas, 15 phases, 28 E2E
  cases and 418 acceptance rows.

The package supplies implementation and evidence requirements. It does not
authorize publication, PR mutation, deployment, shared-service mutation or
credential use. This run performs none of those actions.

## Hard prerequisite status

- A00 is BLOCKED because the inherited v0.4 geospatial baseline remains
  blocked and is not real production-qualified evidence.
- A01 is BLOCKED because the eight-file authoritative WSGS analysis handoff is
  absent. The task-package proposal is not substituted for WSGS authority.
- A14 is BLOCKED because the required official-client/real-WSGS/running
  GOWM/real GDPS-or-STAS/real PostgreSQL ALL-OF chain was not available.

Production therefore keeps AG-UI v0.3 and analysis-control routes fail-closed:
no branded analysis runtime is assembled in `main.ts`, capabilities do not
advertise v0.3, and control calls return
`SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY`.

## Local implementation progress

- [x] A00 package/source intake and AG-UI v0.2 compatibility boundary
- [ ] A01 authoritative WSGS consumer qualification (external handoff absent)
- [x] A02 lifecycle contracts
- [x] A03 append-only event/projection persistence primitives
- [x] A04 Observer/EXCEPTION_ONLY policy
- [x] A05 AG-UI v0.3 profile, projection and strict registration boundary
- [x] A06 map scene and separated local inspection focus
- [x] A07 bounded ToolInteractionDescriptor and edit security
- [x] A08 proposal/control API contracts
- [x] A09 immutable Revision compilation and node-set validation
- [x] A10 intervention/cancel/queued-revision local transitions
- [x] A11 timeline and time-semantics projection
- [x] A12 headless official-event reference client
- [x] A13 snapshot/revision/reconnect recovery primitives
- [ ] A14 real integrated final evidence

Checked local components are not promoted to acceptance PASS automatically.
The generated intake ledger remains 0 PASS / 0 FAIL / 347 NOT_RUN / 71
BLOCKED until each row receives all required evidence types.

## Key decisions

- SACS consumes only a byte-verified authoritative WSGS analysis bundle.
- Ordinary read-only nodes auto-execute; interrupts are limited to ambiguity,
  permission, budget, high risk and explicit interrupt-and-apply.
- SACS never decides semantic DAG topology or node reuse.
- State and Activity deltas are revision guarded; canonical State snapshots are
  hash verified.
- An interrupt is emitted only after complete State and Activity snapshots.
- A queued Revision does not replace the active Revision while the old Run is
  nonterminal; activation and new-Run insertion share one transaction.
- Map inspection/playback is local observer state and cannot emit a backend
  analysis command.
- Disconnect detaches the observer and never implies cancellation.

## Verification scope

To honor the request to reduce unnecessary tests, verification is limited to
v0.5 and directly affected compatibility/security boundaries. Historical
full-suite, Docker, live WSGS and real E2E runs are intentionally not run.

## Withheld markers

- `SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY`
- `SACS_INTERACTIVE_LIVE_ENVIRONMENT_NOT_READY`
- `SACS_V0_5_OBSERVER_FIRST_INTERACTIVE_ANALYSIS_BLOCKED`
