# OpenAI-compatible API contract

Status: Phase 2 thin-chat integration. SDAR A2A operations begin in Phase 3.

## Authentication

Every `/v1/*` route requires:

```http
Authorization: Bearer <CHAT_SERVER_SERVICE_KEY>
```

The configured key must contain 32-512 characters. Comparison uses fixed-size
SHA-256 digests and `timingSafeEqual`. Health endpoints do not require the
service key. Signed Open WebUI user identity is a separate Phase 5 layer.

## Model discovery

`GET /v1/models` returns one stable model:

```json
{
  "object": "list",
  "data": [
    {
      "id": "sdar-single-agent",
      "object": "model",
      "created": 1700000000,
      "owned_by": "single-agent-chat-server"
    }
  ]
}
```

The timestamp is the response creation time. The model ID can be configured at
deployment but defaults to `sdar-single-agent`.

## Chat completions

`POST /v1/chat/completions` accepts the required `model` and nonempty
`messages`, plus:

- `stream`
- `temperature`
- `top_p`
- `max_tokens` or `max_completion_tokens` (not both)
- `stop`
- `user`
- `stream_options.include_usage`

Unknown top-level and message fields are ignored for forward compatibility.
Known fields are bounded and validated. The only configured model is accepted;
an unknown model produces `model_not_found`.

The Phase 2 response runs through the thin LangGraph state machine. The default
local fallback produces stable, simplified conversational text; a narrow
structured-model port can be injected for validated classification and local
answers. The graph still performs no SDAR operation until the isolated Phase 3
adapter is introduced.

### Non-streaming

The response uses `object=chat.completion`, one assistant choice with
`finish_reason=stop`, and an explicit zero usage object because no model is
invoked in this phase.

### Streaming

The response media type is `text/event-stream; charset=utf-8`. Each frame is:

```text
data: <ChatCompletionChunk JSON>\n\n
```

The stream emits an assistant role chunk, content chunk, stop chunk, optional
usage chunk, then exactly one:

```text
data: [DONE]\n\n
```

No custom browser JavaScript events are used.

## Errors and limits

Errors use the OpenAI-compatible `{"error": ...}` envelope. Phase 1 covers:

- `401 invalid_api_key`
- `400 invalid_request`
- `404 model_not_found`
- `413 request_too_large`
- redacted `500 internal_error`

The default request body limit is 1 MiB and the request timeout is 30 seconds.
Both are bounded by configuration validation.

## Health

- `GET /health` is liveness.
- `GET /ready` reports configuration readiness. Database and SDAR checks are
  added only when those dependencies exist.
