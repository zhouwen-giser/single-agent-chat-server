# Changelog

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
