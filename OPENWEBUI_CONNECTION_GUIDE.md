# Open WebUI Connection Guide for Codex — R2

Codex must turn this baseline into verified deployment documentation using the actual deployed Open WebUI version.

## 1. Open WebUI → Chat Server

```text
Base URL: http://single-agent-chat-server:<port>/v1
API Key:  <CHAT_SERVER_SERVICE_KEY>
Model:    sdar-single-agent
```

Enable signed user forwarding:

```text
ENABLE_FORWARD_USER_INFO_HEADERS=true
FORWARD_USER_INFO_HEADER_JWT_SECRET=<shared secret>
```

Configure custom forwarded headers when supported:

```text
X-OpenWebUI-Chat-Id={{CHAT_ID}}
X-OpenWebUI-Message-Id={{MESSAGE_ID}}
X-OpenWebUI-User-Message-Id={{USER_MESSAGE_ID}}
X-OpenWebUI-User-Message-Parent-Id={{USER_MESSAGE_PARENT_ID}}
X-OpenWebUI-Task={{TASK}}
```

The Chat Server must:

- verify its service Bearer token;
- verify the signed Open WebUI user JWT;
- use Chat ID as the LangGraph thread identity input;
- use message identifiers for idempotency;
- treat `X-OpenWebUI-Task` as a utility request and never create or mutate a SDAR Task.

Do not enable browser Direct Connection to an untrusted server. Route through the Open WebUI backend connection.

## 2. Chat Server → SDAR Docker network

Current SDAR A2A has no authentication. Open WebUI, Chat Server and SDAR must communicate only over a trusted private Docker/host network.

Example Chat Server configuration:

```text
SDAR_A2A_BASE_URL=http://sdar:9999
SDAR_A2A_AGENT_CARD_PATH=/.well-known/agent-card.json
SDAR_A2A_ENDPOINT_OVERRIDE=http://sdar:9999/a2a
SDAR_A2A_EXPECTED_PROTOCOL_VERSION=1.0
SDAR_A2A_EXPECTED_BINDING=HTTP+JSON
```

If SDAR listens on `0.0.0.0`, its current Agent Card may advertise `http://0.0.0.0:9999/a2a`. The Chat Server may replace this only when `SDAR_A2A_ENDPOINT_OVERRIDE` is explicitly configured and the downloaded Agent Card otherwise validates.

Do not expose SDAR port 9999 directly to the public network. The current SDAR server requires an explicit acknowledgement to bind beyond loopback, but that acknowledgement does not add authentication.

## 3. Smoke sequence

1. From the Chat Server container, fetch `http://sdar:9999/.well-known/agent-card.json`.
2. Verify HTTP+JSON and protocol version 1.0.
3. Verify the SDK pin `@a2a-js/sdk@1.0.0-beta.0`.
4. Call `/v1/models` from the Open WebUI container.
5. Run a normal-chat request and verify no A2A call.
6. Run a new SDAR Task and capture `taskId/contextId`.
7. Verify bounded stream end followed by `getTask()`.
8. Verify plan confirmation or `provide_input` with strict Follow-up metadata.
9. Verify top-level `cancelTask()`.
10. Verify final `result` Artifact rendering.
