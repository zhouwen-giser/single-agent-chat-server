# Changelog

## Unreleased — SACS v0.3 in progress

### Added

- A fixed, configured OpenAI-compatible conversation model client with strict
  structured decisions, bounded calls, readiness, and no production fallback.
- Protocol-neutral durable user/assistant history, optimistic summaries, stable
  replay reconciliation, and deterministic bounded context assembly shared by
  the future OpenAI and AG-UI application path.
- Numeric-only context size/truncation telemetry and deployment controls for
  recent-message, total-envelope, summary-trigger, and Task-summary budgets.

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
