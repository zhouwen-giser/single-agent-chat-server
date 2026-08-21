# Secure observability and operational controls

Phase 9 adds operational signals without turning logs or metric labels into a
second conversation store.

## Logs and correlation

Production uses Fastify/Pino JSON logs with built-in request logging disabled.
The server emits a bounded completion record containing only correlation ID,
route template, method, status code, and duration. A caller-provided
`X-Request-Id` is accepted only when it matches a 1-128 character safe ASCII
identifier; otherwise a UUID is generated. The selected value is returned in
the response.

Pino redacts authorization, signed user JWTs, tokens, credentials, request
bodies, prompts, and Artifact fields. Application code must not add user, chat,
Task, prompt, Artifact, credential, or hidden-reasoning values to logs.

## OpenTelemetry

The pinned OpenTelemetry API creates spans and metrics through the global
provider. With no SDK/exporter installed it is a no-op, and provider failures
are caught so telemetry cannot fail a request. An operator may register a
provider before the application starts.

Signals cover API, chat/graph, Agent Card discovery, and the four permitted A2A
operations. Metrics include API/chat/A2A latency, request counts, active HTTP
and A2A streams, and active persisted Task bindings. Labels are restricted to
small enumerations: route, status class, operation, outcome, and stream kind.
User, chat, Task, message, and request identifiers are forbidden metric labels.
The attribute-free counter `a2a_unexpected_auth_required_total` records an SDK
auth-required state as a trusted-network deployment mismatch; it never labels
the endpoint, Task, principal, credential, or error text.

## Limits and dependency health

Authenticated `/v1/*` requests use a bounded per-user fixed window. Request
body, message count, message content, HTTP timeout, A2A operation timeout,
stream duration, polling duration, and published Artifact rendering are all
bounded. Rate-limit responses use OpenAI error shape, status 429, and
`Retry-After`.
PostgreSQL connection and query attempts are bounded to 5 seconds by default
through `DATABASE_OPERATION_TIMEOUT_MS`.

`/health` reports only process liveness. `/ready` checks the required PostgreSQL
dependency and returns 503 without exposing connection details when it is
unavailable. SDAR Agent Card discovery remains lazy: temporary SDAR outage is a
chat-operation failure, not a reason to withdraw HTTP readiness.

SIGINT and SIGTERM use the idempotent shutdown path introduced in Phase 8;
Fastify stops accepting work and its close hook drains both PostgreSQL pools.
