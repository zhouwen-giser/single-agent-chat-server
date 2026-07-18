# OpenAI-compatible API contract

Status: Phase 6 bounded SDAR streaming and recovery.

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
The thin graph runs with the PostgreSQL checkpointer. The user-message ID is
preserved for idempotency, and a nonempty `X-OpenWebUI-Task` deterministically
routes utility work locally without A2A.

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

Client disconnect aborts only this HTTP observation. It never maps to
`cancelTask`. A later status request can resume observation through the
persisted user/chat/Task binding and `getTask`.

## Errors and limits

- `401 invalid_api_key`
- `401 invalid_user_identity`
- `400 invalid_request`
- `404 model_not_found`
- `413 request_too_large`
- redacted `500 internal_error`

The default body limit is 1 MiB and request timeout is 30 seconds. The A2A
stream observation budget defaults to 30 seconds, followed by at most 5 seconds
of 1-second `getTask` polling. All values are bounded by configuration
validation.

## Health

- `GET /health` is unauthenticated liveness.
- `GET /ready` is unauthenticated process readiness. Production startup
  completes PostgreSQL migrations, checkpointer setup, and reconciliation
  before listening.
