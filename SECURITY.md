# Security Policy

## Supported versions

Security fixes are provided for the latest code on `main` and the active
`v0.1` feature branch until the first stable release.

## Reporting a vulnerability

Use GitHub private vulnerability reporting. Do not open a public issue
containing credentials, prompts, artifacts, user identifiers, or exploit
details.

## Open WebUI identity

All `/v1/*` requests require the connection bearer key and a short-lived HS256
Open WebUI user JWT. The server validates issuer, subject, role, issued-at,
expiry, lifetime, and signature. Plain user headers never establish identity.
Task authorization is scoped by signed user ID, Open WebUI Chat ID, and the
locally persisted Task binding. Do not log either shared secret or JWT values.

## SDAR network boundary

The current SDAR A2A endpoint has no authentication. Deploy it and this chat
server only on a trusted isolated network. Never expose SDAR port 9999 directly
to the public internet.

## Published data and limits

Only bounded A2A status messages, allowlisted metadata, and Result Artifact
content may reach chat output. HTML and Markdown are neutralized and
credential-like values are redacted. Task, Message, Artifact, JSON, SSE,
request, response, rate, and timeout limits fail closed. Hidden reasoning,
stack traces, internal error details, prompts, and raw private logs are not
published.

## Authorization and consistency

The persisted `(signed principal, conversation thread, SDAR task, SDAR
context)` binding authorizes status, Follow-up, and cancellation. Arbitrary
Task IDs are resolved only against that principal-owned Task Directory. A Chat
may have multiple active Tasks up to the configured bound. Mutating operations
must resolve one Task and use a Task-level lease, retries are idempotent,
terminal state is monotonic, and rejected stale observations are not rendered.

Conversation history, model input, published A2A content, user-supplied URLs,
and endpoint-looking strings are untrusted data. The conversation model has no
tools or network authority. It cannot override the single fixed SDAR endpoint
or local Task authorization.

## Dependency and protocol review

Production dependencies are pinned. The architecture gate requires one SDAR
client construction site and rejects SMPP/MCP, mesh, registry,
capability-discovery, multi-agent UI, management-route, local model fallback,
legacy A2A operations, internal `AUTH_REQUIRED`, and out-of-adapter network
drift. A2A or SDK upgrades require an ADR, fixture and adversarial regression
updates, and a real Open WebUI-to-SDAR rerun.
