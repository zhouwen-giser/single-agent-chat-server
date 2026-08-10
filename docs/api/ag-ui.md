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
