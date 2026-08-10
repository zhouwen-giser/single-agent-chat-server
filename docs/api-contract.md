# OpenAI-compatible API contract

The official AG-UI HTTP/SSE profile is documented separately in
[`docs/api/ag-ui.md`](api/ag-ui.md). Both northbound protocols share the same
protocol-neutral interaction state but use independent service credentials.

## Authentication

Every `/v1/*` request requires:

```http
Authorization: Bearer <CHAT_SERVER_SERVICE_KEY>
X-OpenWebUI-User-Jwt: <short-lived Open WebUI HS256 JWT>
```

The JWT must use `alg=HS256`, `iss=open-webui`, a nonempty `sub`, role `user` or
`admin`, sane `iat`/`exp`, and a lifetime no longer than 600 seconds. Plain
`X-OpenWebUI-User-*` fields do not establish identity.

## `GET /v1/models`

Returns one model, `sdar-single-agent`, using the OpenAI list shape.

## `POST /v1/chat/completions`

Required context headers:

- `X-OpenWebUI-Chat-Id`
- `X-OpenWebUI-Message-Id`
- `X-OpenWebUI-User-Message-Id`

The request accepts OpenAI-style `model`, `messages`, optional `stream`, and
optional usage streaming. Only the configured model exists. Body, message
count, individual content, response, rate, and time limits apply.

Nonstreaming responses use `chat.completion`; streaming responses use
`text/event-stream`, role/content deltas, optional usage, and always a terminal
`data: [DONE]` unless the client connection itself is gone. Internal exceptions
and stack traces are replaced with stable OpenAI error objects.

Utility work identified by `X-OpenWebUI-Task` stays local. General chat stays
local. Task submission, status, phase-gated Follow-up, and cancellation are
delegated only through the fixed SDAR A2A adapter. The server renders only
published bounded state and artifacts; it never exposes hidden reasoning.

Detailed examples from the implementation phases remain in
[api/openai-chat-completions.md](api/openai-chat-completions.md).
