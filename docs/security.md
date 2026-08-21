# Security, identity, and privacy policy

SACS is the external security boundary for the currently unauthenticated SDAR
A2A endpoint. Deploy SACS and SDAR on a trusted isolated network; never publish
the SDAR A2A endpoint directly.

The southbound connection has no interactive credential flow. An Agent Card
with authentication requirements or an SDK `TASK_STATE_AUTH_REQUIRED` result
fails closed as `UNEXPECTED_A2A_AUTH_REQUIRED`; SACS never persists that value
as Task state or asks a user to provide SDAR credentials. This does not weaken
the northbound controls below.

## Identity and authorization

- OpenAI and AG-UI use different service bearer credentials.
- Both require the signed Open WebUI HS256 JWT with fixed issuer, bounded
  lifetime, non-empty subject, and `user` or `admin` role.
- Plain identity headers such as `X-User-Id` are ignored.
- Internal principal/thread bindings are resolved server-side. A Task, Run,
  request, or interrupt is authorized through that binding before any A2A
  client is created or called.
- Client AG-UI `state`, `context`, and `forwardedProps` are input data only;
  they cannot select a Task, mark a utility request, route an agent, or grant an
  action.

## Browser and request policy

`CHAT_CORS_ALLOW_ORIGINS` is an optional comma-separated list of at most 32
exact HTTP(S) origins. Empty is deny-by-default for requests carrying `Origin`.
Allowed origins are reflected exactly; wildcard origins and credentialed CORS
are not supported. Preflight permits only GET/POST and the fixed headers needed
for bearer authentication, signed identity, JSON/SSE, and request IDs.

Rate limits are keyed by northbound protocol and signed subject. Request body,
message count/size, response size, A2A parts/artifacts/history, JSON depth/node
count, interrupt data, and public events are bounded before use or projection.

## Published content and references

- RAW AG-UI events and client-provided or inferred tool calls are disabled.
- Internal MCP operations are never projected as AG-UI/OpenAI tools.
- Text and JSON are bounded, control-filtered, Markdown/HTML escaped where
  rendered as chat, and secret-like keys/assignments, authentication/cookie
  headers, bearer values, and database URL credentials are redacted.
- Artifact references are data only. SACS never performs DNS or HTTP fetches
  for A2A URL Parts. Projection requires HTTPS without credentials and rejects
  loopback, private/reserved IP literals, and local/internal hostnames.

## Logs and telemetry

Request logging is disabled at the framework level. Application logs contain
only request ID, normalized route, method, status, duration, and bounded
operation outcome. Logger redaction covers authorization, JWT, credentials,
tokens, prompts, bodies, artifacts, and structured content. Metrics and spans
use a fixed low-cardinality attribute allowlist and never label user, thread,
Task, prompt, artifact, URL, response data, or raw error text.

Browser disconnect is observation lifecycle only. It never authorizes
`cancelTask()`, `cancel_goal`, Resume, or any other SDAR mutation.

## Model and multi-Task boundaries

The configured conversation model receives one fixed system instruction and a
bounded JSON `untrustedData` envelope. Conversation history, Task summaries,
published A2A content, user-supplied URLs, and endpoint-looking strings remain
data. The model has no tool, network, A2A, database, Provider, MCP, SMPP, or URL
fetch authority. Its strict output schemas reject extra endpoint or tool-call
fields.

Explicit Task identifiers are resolved and authorized from the
principal-owned local Task Directory before an A2A client is acquired. A
missing and an unauthorized explicit identifier return the same bounded “not
bound” response. Mutating references must resolve to one Task; ambiguity only
returns clarification and does not call A2A. Task-level leases serialize work
for the same Task without blocking independent Tasks in the Chat.
