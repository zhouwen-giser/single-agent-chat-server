# Changelog

## 0.1.0 — local release candidate, blocked

### Added

- OpenAI-compatible model discovery and chat completions with bounded SSE.
- Thin LangGraph routing for utility, general chat, Task creation, status,
  Follow-up, and cancellation.
- Official frozen SDAR A2A HTTP+JSON adapter.
- PostgreSQL continuity, authorization, idempotency, leases, observations,
  checkpoints, migrations, and restart reconciliation.
- Signed Open WebUI identity, rate/resource limits, secure observability,
  production container, Compose topology, CI, license, and SBOM gates.
- Phase 11 real Open WebUI/SDAR vertical-slice evidence at the remote baseline.
- Phase 12 adversarial tests and repeatable architecture drift gate.
- Phase 13 deterministic fixture, built-server smoke, migration/workflow/secret
  gates, and strict live-environment verification entry points.

### Security

- Reject malformed or oversized A2A payloads and stream floods.
- Reject Task/context identity drift and cross-origin A2A endpoints.
- Escape/redact published content and bound aggregated responses.
- Serialize all mutating Task interactions.
- Suppress stale observations rejected by persistence.
- Restrict signed roles to `user` or `admin`.

### Release status

This local candidate is not published. Final-head native PostgreSQL, Docker, and
live Open WebUI-to-SDAR verification could not run in the current workspace.
Remote GitHub Actions have not run for the local commits.
