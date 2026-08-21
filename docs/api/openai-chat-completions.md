# OpenAI-compatible API contract

Status: Phase 10 durable multi-turn and multi-Task integration.

## Authentication

Every `/v1/*` route requires both:

```http
Authorization: Bearer <CHAT_SERVER_SERVICE_KEY>
X-OpenWebUI-User-Jwt: <short-lived signed user JWT>
```

The service key contains 32-512 characters and is compared through fixed-size
SHA-256 digests with `timingSafeEqual`. The JWT is HS256-signed with
`OPENWEBUI_USER_JWT_SECRET` and must contain valid `iss=open-webui`, `sub`,
`role`, `iat`, and `exp` claims. Plain `X-OpenWebUI-User-*` headers are
untrusted.

Chat completions also require `X-OpenWebUI-Chat-Id`,
`X-OpenWebUI-Message-Id`, and `X-OpenWebUI-User-Message-Id`. Parent ID and
utility task are optional. See the Open WebUI deployment guide for templates.

## Model discovery

`GET /v1/models` returns the single configured `sdar-single-agent` model.
Open WebUI forwards signed user identity for this request.

## Chat completions

`POST /v1/chat/completions` accepts a nonempty `messages` array and supports
`stream=false` and `stream=true`, temperature, top-p, one token-limit field,
stop sequences, and `stream_options.include_usage`. Known fields are bounded
and validated; unknown fields are ignored for OpenAI forward compatibility.

The signed user ID plus Open WebUI Chat ID resolves a persisted internal thread.
The adapter converts `messages[]` to a protocol-neutral client envelope. The
current user message is always bound to `X-OpenWebUI-User-Message-Id`; explicit
historical `id`/`message_id` values and the parent assistant header are used for
reconciliation. Repeated history is deduplicated, client assistant history can
only match server-published text, and system/developer/tool content cannot
become server instructions. The shared Conversation Application Service then
loads bounded durable context and the Task Directory before model inference.

A nonempty `X-OpenWebUI-Task` bypasses message import, context/Task lookup, and
the conversation model. It returns the deterministic local utility response
without A2A, Focus changes, or conversation-message writes.

OpenAI and AG-UI share the protocol-neutral `interaction_request` store. An
A2A-bound request completes with exactly one durable `TASK` or `MESSAGE`
result. Repeating a message-only request returns the exact stored assistant
text without another model, A2A, or Task query. Repeating a Task result first
reauthorizes the original Task/Context binding and then observes current Task
state. If an initial stream emits Message text before creating a Task, its
durable result is the Task while the published Message text remains in the
conversation transcript.

### Non-streaming

The response uses `object=chat.completion`, one assistant choice,
`finish_reason=stop`, and an explicit usage object.

### Streaming

The media type is `text/event-stream`. Frames use standard
`data: <ChatCompletionChunk JSON>` encoding and end with exactly one
`data: [DONE]`. Published SDAR status, `status.message`, `phaseMessage`, and
terminal Artifact fragments are emitted as separate content deltas as they are
observed; the route does not buffer the full A2A response first. No
browser-specific event protocol is used.

The HTTP adapter accumulates only rendered deltas that enter the outgoing
stream. At normal completion it writes one assistant message; on disconnect or
a safe streaming failure it writes the published prefix with `truncated=true`.
It never persists unseen generator output or writes once per token. A
Task-scoped event also associates the assistant message with that authorized
Task and the originating user-message request ID.

Client disconnect aborts only this HTTP observation. It never maps to
`cancelTask`. A later status request can resume observation through the
persisted user/chat/Task binding and `getTask`.

## Multi-Task interaction

An untargeted status turn lists every active Task in deterministic order. A
targeted status refreshes only its authorized binding with `getTask` and never
sends a Task Message. Explicit plan decisions, requested user input,
pause/resume, goal patch/cancel actions, and top-level Task cancellation must
resolve to one full Task ID and are phase-gated before A2A. Mutations of one
Task serialize; another Task in the same Chat remains independently available.
Ordinary text at plan confirmation never implies approval.

Streaming protocol failures produce a generic safe delta and still terminate
with the standard stop chunk and `[DONE]`; internal endpoints, tokens, and
exception messages are not exposed.

## Errors and limits

- `401 invalid_api_key`
- `401 invalid_user_identity`
- `400 invalid_request`
- `404 model_not_found`
- `413 request_too_large`
- `429 rate_limit_exceeded` with `Retry-After`
- redacted `500 internal_error`

The default body limit is 1 MiB, message limit is 64, per-message serialized
content limit is 32 KiB, and request timeout is 30 seconds. Authenticated model
and chat requests share a per-user 60-request/60-second fixed window by default.
The A2A stream observation budget defaults to 30 seconds, followed by at most 5 seconds
of 1-second `getTask` polling. All values are bounded by configuration
validation.

## Health

- `GET /health` is unauthenticated liveness.
- `GET /ready` is unauthenticated process readiness. Production startup
  completes PostgreSQL migrations, checkpointer setup, and reconciliation
  before listening. The live readiness check returns `503 not_ready` while
  PostgreSQL or the configured conversation model is unavailable. The model
  probe is bounded and cached; SDAR discovery remains lazy and does not gate
  readiness.
