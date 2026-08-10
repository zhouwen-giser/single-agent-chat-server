# Open WebUI connection

This service uses two independent trust layers:

1. the OpenAI connection API key is `CHAT_SERVER_SERVICE_KEY`; and
2. each request carries a short-lived Open WebUI user JWT signed with the shared
   `OPENWEBUI_USER_JWT_SECRET`.

Plain `X-OpenWebUI-User-*` headers are never accepted as identity.

## Open WebUI 0.10.2 environment

Verify the installed pip artifact before starting the isolated UI process:

```powershell
python -m pip show open-webui
open-webui serve --host 127.0.0.1 --port 18080
Invoke-RestMethod http://127.0.0.1:18080/health
```

The P10 regression baseline accepts only `Version: 0.10.2` from `pip show` and
an HTTP 200 health response from that same loopback process. A fixture or a
direct call to SACS is not real Open WebUI evidence.

Configure Open WebUI before it starts:

```text
ENABLE_FORWARD_USER_INFO_HEADERS=true
FORWARD_USER_INFO_HEADER_JWT_SECRET=<same value as OPENWEBUI_USER_JWT_SECRET>
FORWARD_USER_INFO_HEADER_JWT=X-OpenWebUI-User-Jwt
FORWARD_USER_INFO_HEADER_JWT_EXPIRES_SECONDS=300
```

Keep the default JWT header name. The server accepts HS256 only and validates
`iss=open-webui`, `sub`, `role`, `iat`, and `exp`. Tokens longer than 600 seconds,
expired tokens, future-issued tokens, wrong algorithms, and forged signatures
fail closed.

The installed Open WebUI 0.10.2 source was inspected for this contract. It signs
`sub`, `email`, `name`, `role`, `iss`, `iat`, and `exp` with HS256 and defaults to
the header and 300-second lifetime shown above.

## OpenAI connection

Create an OpenAI-compatible connection with:

- URL: `http://127.0.0.1:3000/v1` when pip Open WebUI and this server run on the
  same host;
- API key: the exact `CHAT_SERVER_SERVICE_KEY` value; and
- model: `sdar-single-agent` (discovered from `/v1/models`).

Configure these custom headers on the connection:

| Header                               | Template value               | Required by server |
| ------------------------------------ | ---------------------------- | ------------------ |
| `X-OpenWebUI-Chat-Id`                | `{{CHAT_ID}}`                | yes                |
| `X-OpenWebUI-Message-Id`             | `{{MESSAGE_ID}}`             | yes                |
| `X-OpenWebUI-User-Message-Id`        | `{{USER_MESSAGE_ID}}`        | yes                |
| `X-OpenWebUI-User-Message-Parent-Id` | `{{USER_MESSAGE_PARENT_ID}}` | no                 |
| `X-OpenWebUI-Task`                   | `{{TASK}}`                   | no                 |

The Chat ID is mapped with the signed JWT `sub`, so two users presenting the
same Chat ID receive different internal LangGraph threads. The user-message ID
is preserved for the Phase 6 idempotency claim. A non-empty task header marks a
title/tag/follow-up/background request as utility work and keeps it on the local
deterministic graph; it must never submit an A2A Task.

## Network examples

For pip Open WebUI and a host process, keep the server on loopback:

```text
Open WebUI URL=http://127.0.0.1:3000/v1
CHAT_SERVER_HOST=127.0.0.1
```

For Open WebUI in Docker and the server on the Windows host:

```text
Open WebUI URL=http://host.docker.internal:3000/v1
CHAT_SERVER_HOST=0.0.0.0
```

Restrict the published server port with the host firewall. Do not publish the
unauthenticated SDAR A2A endpoint.

When both services are containerized, attach them to a dedicated edge network
and address the server by its Compose service name:

```yaml
networks:
  single-agent-chat-edge:
    internal: true

services:
  open-webui:
    networks: [single-agent-chat-edge]
  single-agent-chat-server:
    networks: [single-agent-chat-edge, sdar-trusted-backend]
```

Use `http://single-agent-chat-server:3000/v1` as the Open WebUI URL. PostgreSQL
and SDAR belong only on trusted backend networks. The repository Compose artifacts implement this boundary; the externally installed Open WebUI remains outside this repository and is verified through its real proxy endpoints.

## Failure checks

- `401 invalid_api_key`: connection API key is missing or wrong.
- `401 invalid_user_identity`: JWT forwarding is disabled, the shared secrets
  differ, the token is expired/forged, or the header name was changed.
- `400 invalid_request`: required Chat/Message custom headers are absent.
- `/health` and `/ready` intentionally remain unauthenticated for local
  orchestration; they expose no user or SDAR state.
