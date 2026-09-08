# Changelog

## Unreleased — SACS v0.5 development

### Added

- Observer-first analysis contracts and policy, durable Analysis Session /
  Revision / Run / Node persistence, and fail-closed WSGS analysis handoff.
- Explicit AG-UI v0.3 profile negotiation with authoritative Step, Tool Call,
  Activity, State, map, focus, and timeline projection boundaries.
- Bounded Proposal, revision recompile, cancel, intervention, snapshot recovery,
  and headless reference-client coordination surfaces.

### Candidate status

The local v0.5 implementation remains blocked from promotion until the
authoritative WSGS analysis handoff bundle, real PostgreSQL evidence, and the
required SACS-to-WSGS-to-GOWM-to-GDPS/STAS acceptance chain are available.
Explicit AG-UI v0.3 execution therefore fails closed unless an authoritative
analysis handler is configured; the default v0.2 interaction profile is
unchanged.

## SACS v0.4 development

### Added

- S00 exact source locks for SACS, WSGS 0.2.0, indirect GOWM 0.6.3, and SDAR.
- A byte-level verifier for all 32 frozen `sacs-wsgs-grounding/1.0` artifacts.
- An explicit fail-closed SDAR grounding-extension compatibility lock and S00
  contract Gate.
- Strict v0.4 TurnPlan, deterministic GroundingRequestPlan, validated
  OperationalGroundingBundle, and hybrid plan/reality comparison contracts.
- Negative contract and architecture Gates preventing model-selected WSGS/GOWM
  details, overbroad context, stale operational references, text downgrade,
  and direct spatial or Provider access.
- A deterministic GroundingRequestPlanner and isolated WSGS HTTP adapter with
  fixed routes, transport-only authentication, bounded responses/polling, and
  sanitized protocol failures.
- Append-only PostgreSQL grounding execution/events with the required
  seven-state lifecycle, composite request authorization, exactly-once WSGS
  and SDAR reservation identities, immutable outputs, terminal closure, and
  expired-lease recovery.
- Production v0.4 TurnPlan routing and one isolated WorldGroundingRuntime shared
  by OpenAI and AG-UI, with durable one-call WSGS execution and safe Message
  replay.
- Strict WSGS reference, evidence, and ambiguity result subcontracts plus
  deterministic safe world-answer rendering that never infers absence from
  unresolved or NO_DATA outcomes.
- A validated-reference OperationalGroundingBundle builder and exact
  fail-closed SDAR extension Gate with no raw-text or ungrounded downgrade.
- A read-only Authority Fusion Preview that resolves one authorized Task,
  reads bounded published SDAR plan state through official A2A `getTask()`,
  requires completed unambiguous WSGS/GOWM evidence, and composes the two
  authorities without mutation or invented semantic conclusions.
- Durable hybrid-preview identity including the observed SDAR snapshot, so a
  stored preview replays without a second WSGS POST and cannot be reused for a
  different plan observation.

### Candidate status

The WSGS candidate is blocked and current SDAR lacks
`sacs-sdar-operational-grounding/1.0`. S00 through S04 and the S05 internal
implementation therefore record `SACS_V0_4_STABLE_CANDIDATE_BLOCKED`. S05 real
PostgreSQL plus production-adapter/injected-fetch evidence is not live
SDAR+WSGS/GOWM E2E. The live Gate also requires explicit current-task
credential authorization, so `AUTHORITY_FUSION_PREVIEW_READY` is withheld.

## 0.3.0 — qualified release candidate

### Added

- A fixed, configured OpenAI-compatible conversation model client with strict
  structured decisions, bounded calls, readiness, and no production fallback.
- Protocol-neutral durable user/assistant history, optimistic summaries, stable
  replay reconciliation, and deterministic bounded context assembly shared by
  the OpenAI and AG-UI application path.
- Numeric-only context size/truncation telemetry and deployment controls for
  recent-message, total-envelope, summary-trigger, and Task-summary budgets.
- A multi-Task directory with stable short IDs, Focus, last reference,
  deterministic selection, configurable active limit, and Task-scoped leases.
- A strict durable `TASK | MESSAGE` completed-result union shared by OpenAI and
  AG-UI, including exact Message replay without changing Task state.
- Exact-head real-model/current-SDAR, v0.2 upgrade and restart, network-boundary,
  container, Compose, and CycloneDX evidence drivers.

### Changed

- OpenAI and AG-UI now share one protocol-neutral conversation context,
  selector, authorization boundary, Coordinator, and result persistence path.
- Multiple active Tasks may coexist in one Chat; ambiguous mutable requests
  clarify locally and never call A2A.

### Security

- Unexpected A2A `TASK_STATE_AUTH_REQUIRED` and Agent Card authentication
  requirements fail closed as deployment mismatches; northbound keys, signed
  identity, authorization, rate limits, and CORS remain enforced.
- The conversation model receives a bounded untrusted-data envelope and has no
  tools, request-level endpoint override, database, A2A, MCP, SMPP, Provider, or
  arbitrary URL access.

### Candidate status

P00 through P13 are complete. Candidate `9cb0db0` passed the full zero-skip
real-model/current-SDAR, PostgreSQL upgrade/restart, network, quality, Docker,
Compose and SBOM gate. Its evidence publication `838c9e7` passed Push and PR
CI. Final-head P14 evidence and Ready status are published as the exact-head
receipt on [PR #14](https://github.com/zhouwen-giser/single-agent-chat-server/pull/14)
after the release-candidate commit is tested; this changelog does not pre-claim
that post-commit outcome. No production release, tag, deployment or merge is
performed by this workflow.

## Unreleased — SACS v0.2 candidate

### Added

- A protocol-neutral, typed `SdarInteractionEvent` spine shared by the OpenAI
  and official AG-UI northbound adapters.
- Authenticated AG-UI HTTP/SSE capabilities and Run endpoints using official
  `@ag-ui/core`, `@ag-ui/encoder`, and `@ag-ui/client` 0.0.57 contracts.
- Durable PostgreSQL interaction Runs, requests, interrupts, Agent Card
  snapshots, client thread bindings, crash recovery, and explicit Resume.
- Safe Task status/history/artifact/capability queries that cannot create or
  mutate SDAR Tasks.
- Exact-head release orchestration for native PostgreSQL, five zero-skip real
  gates, hardened Docker Compose, license/secret gates, and CycloneDX SBOM.

### Fixed

- Close a non-aborted AG-UI execution failure as a sanitized, replayable
  `ERROR` Run instead of leaving durable state permanently `RUNNING`.
- Preserve one Task identity across bounded observation, disconnect recovery,
  duplicate Run attempts, and protocol projections.

### Security

- Keep OpenAI and AG-UI service credentials independent while enforcing the
  same signed principal profile and protocol-isolated rate limits.
- Reject client-authored Task state, unbound Task IDs, RAW A2A events, inferred
  Tool Calls, unsafe URLs, oversized state/artifacts, and identity drift.

### Candidate status

Phase 13 exact candidate `40e7ae4e...` passed local, real, container,
supply-chain, and remote CI gates. AC-21 and AC-22 remain pending for P14
latest-main integration and final PR ancestry proof. No merge, tag, release, or
deployment has been performed.

## 0.1.0 — acceptance passed, PR publication pending

### Added

- OpenAI-compatible model discovery and chat completions with bounded SSE.
- Thin LangGraph routing for utility, general chat, Task creation, status,
  Follow-up, and cancellation.
- Official frozen SDAR A2A HTTP+JSON adapter.
- PostgreSQL continuity, authorization, idempotency, leases, observations,
  checkpoints, migrations, and restart reconciliation.
- Signed Open WebUI identity, rate/resource limits, secure observability,
  production container, Compose topology, CI, license, and SBOM gates.
- Real pip Open WebUI 0.10.2 to frozen SDAR `667146a` evidence with Redis and
  real Streamable HTTP MCP transport.
- Adversarial tests and repeatable architecture drift gate.
- Strict final live-environment verification bound to the current Git HEAD.

### Fixed

- Preserve accepted terminal stream fragments when an already-terminal
  `getTask()` enrichment is rejected as a redundant monotonic observation.
- Send required Open WebUI session metadata in the final non-mutating live probe.
- Validate A2A protocol revision on the selected Agent Card interface.

### Security

- Reject malformed or oversized A2A payloads and stream floods.
- Reject Task/context identity drift and cross-origin A2A endpoints.
- Escape/redact published content and bound aggregated responses.
- Serialize all mutating Task interactions.
- Suppress stale observations rejected by persistence.
- Restrict signed roles to `user` or `admin`.
- Require an explicit endpoint override for unusable advertised container URLs.

### Release status

All required local and real-environment acceptance gates passed. PR publication
is permitted after the Phase 13 documentation commit's remote checks pass.
There is no tag or GitHub Release, and merge remains user-controlled.
