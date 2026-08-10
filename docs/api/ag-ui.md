# AG-UI HTTP/SSE API

SACS v0.2 exposes the exact pinned AG-UI `0.0.57` HTTP POST/SSE profile:

```http
GET /ag-ui/capabilities
POST /ag-ui
```

Both routes require:

```http
Authorization: Bearer <AG_UI_SERVICE_KEY>
X-OpenWebUI-User-Jwt: <signed principal JWT>
```

`AG_UI_SERVICE_KEY` must be different from `CHAT_SERVER_SERVICE_KEY`. The
principal JWT remains the frozen SACS v0.2 signed-identity profile: HS256,
`iss=open-webui`, bounded lifetime, subject, and `user` or `admin` role. A
plaintext user ID header is never trusted.

## Run request

```http
POST /ag-ui
Accept: text/event-stream
Content-Type: application/json
```

The body is validated by the official `RunAgentInputSchema`. The response uses
the official `EventEncoder` SSE format. The minimal lifecycle is
`RUN_STARTED`, text start/content/end, and `RUN_FINISHED`; failures become a
bounded `RUN_ERROR` without stack, prompt, token, or hidden protocol metadata.

Client-provided tools, inferred tool calls, external `RAW` events, event
cursors, WebSockets, binary HTTP, push notification, task resubscription, and
multi-agent behavior are not part of this profile. A client disconnect aborts
only the current HTTP observation; it does not imply `cancelTask`.

`GET /ag-ui/capabilities` returns an object validated by the official
`AgentCapabilitiesSchema`. It describes AG-UI transport and interaction
features; SDAR business capabilities remain authoritative in the current Agent
Card and are queried through the interaction query service.

## Resume an interrupt

Use the official `RunAgentInput.resume` array. This single-SDAR profile requires
exactly one complete `ResumeEntry`; the request is rejected before execution if
the array is empty or contains multiple entries.

```json
{
  "threadId": "the-original-external-thread",
  "runId": "a-new-observation-run-id",
  "state": {},
  "messages": [],
  "tools": [],
  "context": [],
  "forwardedProps": {},
  "resume": [
    {
      "interruptId": "the-published-interrupt-id",
      "status": "resolved",
      "payload": {
        "action": "provide_input",
        "text": "the requested input",
        "inputRequestId": "the-exact-published-id"
      }
    }
  ]
}
```

The server verifies the signed principal, internal thread, authorized Task and
context, open/expiry state, phase/action pair, input request ID, optional public
response schema, and durable resolution hash before calling the existing A2A
Follow-up adapter. An identical completed Resume is replayed without a second
Follow-up; changed payload conflicts.

`status: "cancelled"` closes only the AG-UI interrupt and never infers SDAR Task
or Goal cancellation. If a Follow-up result is uncertain, the interrupt stays
`RESOLVING`; automatic retry is refused to prevent duplicate side effects.
