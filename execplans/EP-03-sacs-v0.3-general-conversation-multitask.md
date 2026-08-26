# EP-03: SACS v0.3 general conversation and multi-task chat

This ExecPlan is a living document. Update progress, decisions, discoveries,
validation, and outcomes at every P00-P14 boundary.

## Purpose

Upgrade the existing single-SDAR dual-northbound gateway with a configured
real general conversation model, server-authoritative durable conversation
context, multiple active Tasks per Chat, deterministic Task targeting, and a
strict `TASK | MESSAGE` completed-request result.

## Frozen boundaries

- One SACS process constructs and reuses one fixed SDAR A2A client.
- Southbound is A2A 1.0 HTTP+JSON only on the pinned beta SDK; there is no
  registry, mesh, router, request-selected endpoint, SDAR management API, SMPP,
  MCP, Provider, or device access.
- The conversation model has no tools and can only produce text or locally
  validated decisions. Deterministic code owns authorization and execution.
- PostgreSQL owns protocol-neutral conversation, Task binding/focus, request
  result, durable Run, and Interrupt state. SDAR owns Task truth.
- Internal Task state excludes `AUTH_REQUIRED`; the SDK state fails closed as a
  protocol/deployment mismatch. Northbound keys, JWTs, and authorization remain.
- Existing migrations `0001` through `0006` are immutable; upgrades are
  append-only and must preserve v0.2 data.

## Progress

- [x] 2026-08-21: Read and validate all task-package files.
- [x] 2026-08-21: Refresh and lock SACS, SDAR, and SMPP `origin/main` sources.
- [x] 2026-08-21: Complete frozen install and authoritative `verify:ci` baseline.
- [x] 2026-08-21: Create the requested feature branch from exact verified main.
- [x] 2026-08-21: Diagnose exact-head CI's expired open-Interrupt fixture and
      replace only its stale absolute expiry with the established 2099 test date.
- [x] P00: publish evidence, pass exact-head quality/container CI, and open Draft PR #12.
- [x] P01: freeze ADR, contracts, domain types, and architecture gates; pass exact-head CI.
- [x] P02: implement the configured OpenAI-compatible conversation model.
- [x] P03-P04: persist and assemble durable bounded conversation context.
- [x] P05-P06: implement multi-task persistence, deterministic resolution,
      reference updates, and safe model-driven routing.
- [x] P07: harden explicit multi-task coordination, Task identity, bounded
      optimistic merge, and concurrency contracts.
- [x] P08: implement atomic `TASK | MESSAGE` result persistence and exact replay.
- [x] P09: implement trusted A2A fail-closed behavior.
- [x] P10: integrate durable multi-turn and multi-Task context through the
      shared application service into OpenAI/OpenWebUI.
- [x] P11: integrate the same conversation application service into AG-UI.
- [x] P12: complete security, privacy, observability, and adversarial hardening.
- [x] P13: qualify real model, current SDAR, migration, restart, and network boundary.
- [x] P14: synchronize latest main and prepare final release-candidate documentation.
- [ ] P14 post-commit: final-head full gate, CI, exact-head publication receipt and Ready PR.

## Implementation sequence

Each phase closes a minimum complete vertical slice, required tests, three
evidence artifacts, reviewed diff, semantic commit, push, Draft PR update, and
exact local/remote comparison before the next phase begins.

## Decisions

- 2026-08-21: Inspect upstream repositories via fetched `origin/main` objects;
  do not switch or clean their user-owned working branches.
- 2026-08-21: Treat the first sandboxed loopback failure as environment-only
  evidence and use the successful unsandboxed rerun as the P00 code baseline.
- 2026-08-21: Do not count the 50 environment-skipped PostgreSQL tests in
  `verify:ci` toward any v0.3 required gate. P03/P05/P08/P13 must run them on a
  real PostgreSQL service with zero required skips.
- 2026-08-21: Measure the context budget against the exact untrusted model JSON
  envelope and reserve the current user turn before adding durable history.
  If the current turn alone cannot fit, fail explicitly instead of dropping it.
- 2026-08-21: Treat a schema-valid model selector only as a candidate. Local
  deterministic code resolves and authorizes it; ambiguous mutable operations
  return candidates, increment a low-cardinality counter, and never call A2A.
- 2026-08-21: Existing-Task Coordinator operations accept only an explicit full
  Task ID. A mutation lease is scoped to its binding; every A2A Task result is
  checked against persisted Task and Context identity before any state change.
- 2026-08-21: Use `interaction_request` as the single protocol-neutral
  idempotency boundary for OpenAI and AG-UI. Complete status and the normalized
  `TASK | MESSAGE` payload atomically; replay Message text without consulting a
  changed Task, while Task replay must reauthorize the original Task/Context.
- 2026-08-21: Treat any Agent Card security requirement or SDK
  `TASK_STATE_AUTH_REQUIRED` as a southbound deployment mismatch. The latter
  throws before Coordinator observation and is counted without attributes;
  northbound keys, JWTs, rate limits, CORS, and Task authorization are unchanged.
- 2026-08-21: Keep OpenAI transport responsible for the text actually emitted
  to its client, but keep TurnDecision, context, Task selection, reference
  updates, and Coordinator dispatch in one protocol-neutral Conversation
  Application Service. This is the only layer that P11 may reuse for AG-UI.
- 2026-08-21: Reconcile client bindings for the same signed principal and
  external thread ID onto one internal Thread. Preserve per-protocol envelopes,
  but reconcile stable message IDs against the shared server-authoritative
  ledger so repeated cross-protocol history cannot duplicate context.
- 2026-08-21: Treat an AG-UI Run's optional Task/context as recovery metadata,
  not as permission to rewrite its completed-result discriminator. Exact
  `MESSAGE` replay wins over later Task state; `TASK` recovery uses that Run's
  persisted Task ID rather than Focus.
- 2026-08-21: Emit model outcome, durable result/replay kind, and message-dedup
  telemetry only at the adapter/persistence boundaries with fixed
  low-cardinality attributes. Treat telemetry as best-effort so an exporter
  failure cannot reverse or obscure a committed durable result.
- 2026-08-21: Require one production SDAR client construction site in the
  process entry point. The lazy cache accepts only an injected factory and
  cannot independently parse another endpoint.

## Discoveries

- Execution-time main SHAs equal the task package reference SHAs after fresh
  fetch, so no source drift decision is required at P00.
- Current SDAR Agent Card uses HTTP+JSON wire `1.0`, streaming, empty security
  requirements, and no-auth HTTP user builder, matching the trusted isolated
  southbound assumption.
- Existing SACS `verify` intentionally fails before running when P13 real
  environment variables are absent; the v0.3 gate must preserve that fail-closed
  behavior while adding explicit real-model variables.
- Main's last green CI ran one day before a hard-coded Interrupt test expiry.
  Current exact-head PostgreSQL CI correctly treats that row as expired; this is
  a baseline test-data defect, not a v0.3 production regression.

## Validation

P00 authoritative baseline: `pnpm verify:ci` passed unit 78, contract 57,
security 9, fixture E2E 1, architecture/build/smoke/migration/OpenAI/A2A/
workflow/license/secret gates. PostgreSQL tests remained environment-skipped and
are not release evidence.

P08 authoritative local gate: `pnpm verify:phase8` passed 97 unit, 66 contract,
82 integration, and build with zero required skip against isolated PostgreSQL
16.9. Security 11, architecture 72 files, migrations 9, licenses 89, and secret
scan also passed. Functional SHA `2aef667e3f7e9e9552bf98975f54cbf134cda0f6`
passed exact-head CI run `32493711915` (quality `96807094991`, container
`96807552281`).

P09 authoritative local gate: `pnpm verify:phase9` passed 99 unit, 70 contract,
83 integration, and build with zero required skip against isolated PostgreSQL
16.9. Security 11, architecture 73 files, migrations 9, licenses 89, secret
scan, Docker build, and isolated Compose verification also passed. Functional
SHA `fc05c96b654a82ba64df2611935c2dfffa0408be` passed exact-head CI run
`32496491328` (quality `96816017831`, container `96816442562`).

P10 authoritative local gate: `pnpm verify:phase10` passed 99 unit, 76
contract, 85 integration, and build with zero required skip against isolated
PostgreSQL 16.9. The predecessor suite passed 22 tests, the dedicated durable
OpenAI PostgreSQL vertical passed 2 tests, security passed 11, fixture E2E
passed 1, and migration/architecture/license/secret/smoke/workflow gates
passed. Functional SHA `8515f2dde83e470ead695744d9a1f360f0c63bc3`
passed exact-head CI run `32499909972` (quality `96826950287`, container
`96827333827`).

P11 authoritative local gate: `pnpm verify:phase11` passed 99 unit, 78
contract, 89 integration, and build with zero required skip against isolated
PostgreSQL 16.9. The dedicated official-client/shared-runtime AG-UI gate passed
35 tests; predecessor OpenAI passed 22, security 11, fixture E2E 1, and all
migration/architecture/license/secret/smoke gates passed. Functional SHA
`e03a8570ea0dd51b97c37ed1fc33c633c6f88ca0` passed exact-head CI run
`32503356579` (quality `96837914040`, container `96838341355`).

P12 authoritative local gate: `pnpm verify:phase12` passed 100 unit, 78
contract, 89 integration, and build with zero required skip against isolated
PostgreSQL 16.9. The dedicated adversarial/telemetry gate passed 146 tests;
predecessor OpenAI passed 22, cumulative AG-UI passed 35, security 12, fixture
E2E 1, and all migration/architecture/license/secret/smoke/image/container/SBOM
gates passed. Functional SHA
`928a56e7b9f77bb30dc7bd93a30787d79b65129c` passed exact-head CI run
`32507942371` (quality `96852231590`, container `96852849256`).

P13 functional candidate `3a3abbd983db0480f668ce674759210915085198`
adds fail-closed exact-head real-model/current-SDAR, migration/restart, and
network-boundary drivers plus the complete `verify:v03` command. Its available
local gates passed 100 unit, 78 contract, 89 PostgreSQL integration, 22
predecessor, 12 security, 35 AG-UI, and 146 dedicated acceptance tests, with
build/architecture/license/secret/image/container/Compose/SBOM gates also
passing. Exact-head CI run `32511015976` passed quality job `96861907391` and
container job `96862547655`. P13 remains `BLOCKED_ENVIRONMENT`: no P13/model/
SDAR variables or operator-reviewed safe requests exist in the execution
environment, so AC-039 through AC-042 have not been claimed and no fixture is
substituted.

P14 preparation SHA `630a630cda050e72b9cab1e798b87f4d9d4d7a83`
aligns package/image/SBOM metadata to 0.3.0, updates final operator and release
documentation, and adds explicit v0.3 push CI. The complete available local
`verify:ci`, image, container, Compose, and SBOM gates passed; exact push CI
`32513481057` and PR CI `32513485570` both passed quality and container jobs.
Latest `origin/main` `0211157e8652cc0ae933a1eea9294cf665b4da38` is
already an ancestor. Final P14 evidence and PR Ready remain blocked by the same
unsatisfied P13 genuine-environment gates.

## Outcomes

2026-08-26 P13 qualification: exact published candidate `9cb0db0` passed the
complete `verify:v03` command with zero required skips, all five real/environment
evidence documents, Docker, isolated Compose and CycloneDX generation. Real
SDAR created two active `INPUT_REQUIRED` Tasks without confirmation/execution;
the full gate explicitly revalidated the same-candidate evidence. Ordinary
model settings were overridden only for the verification process to remain
within production limits. See `reports/v0.3/P13-completion.md` and acceptance
JSON. The operator's same-tree SDAR process-SHA waiver remains disclosed.

P13 evidence commit `838c9e7` passed Push CI `32925165630` and PR CI
`32925168899`. P14 fetched latest main `9734ba2` on 2026-08-26 and verified
it is an ancestor; there is no source drift and no history rewriting. Final
documentation changes are evidence-only relative to the qualified candidate.

The committed plan is frozen before final publication. The post-commit
`P14 exact-head publication receipt` on PR #14 is the authoritative completion
record: it must verify the final local/remote/PR/evidence SHA, all zero-skip
gates, both CI workflows and actual Ready state. This avoids a self-referential
evidence commit and never substitutes prior-head proof for final-head tests.
