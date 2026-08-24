# Open WebUI setup

The verified baseline is Open WebUI `0.10.2`. Configure it to forward its signed
user JWT:

```text
ENABLE_FORWARD_USER_INFO_HEADERS=true
FORWARD_USER_INFO_HEADER_JWT_SECRET=<same as OPENWEBUI_USER_JWT_SECRET>
FORWARD_USER_INFO_HEADER_JWT=X-OpenWebUI-User-Jwt
FORWARD_USER_INFO_HEADER_JWT_EXPIRES_SECONDS=300
```

Create one OpenAI-compatible connection:

| Setting  | Value                                              |
| -------- | -------------------------------------------------- |
| Base URL | `http://127.0.0.1:3000/v1` for same-host processes |
| API key  | exact `CHAT_SERVER_SERVICE_KEY`                    |
| Model    | discovered `sdar-single-agent`                     |

Add the connection headers:

| Header                               | Template                     |
| ------------------------------------ | ---------------------------- |
| `X-OpenWebUI-Chat-Id`                | `{{CHAT_ID}}`                |
| `X-OpenWebUI-Message-Id`             | `{{MESSAGE_ID}}`             |
| `X-OpenWebUI-User-Message-Id`        | `{{USER_MESSAGE_ID}}`        |
| `X-OpenWebUI-User-Message-Parent-Id` | `{{USER_MESSAGE_PARENT_ID}}` |
| `X-OpenWebUI-Task`                   | `{{TASK}}`                   |

The first three IDs are required for chat requests. A nonempty task header
marks title/tag/follow-up-suggestion work as a local utility request and must
not submit or mutate an SDAR Task.

Users can create multiple SDAR Tasks in the same Chat. Status without a target
lists all active Tasks. The service renders stable short IDs that users can
reference in later turns. Cancel, pause, resume, confirmation, input, and other
mutations must resolve exactly one Task; when a reference is ambiguous the
response asks for clarification and does not call SDAR. This behavior is
server-side and must not be replaced with an Open WebUI function or tool.

For Docker-to-host deployment, use
`http://host.docker.internal:3000/v1`. For a fully containerized deployment,
attach Open WebUI and this service to a dedicated edge network and use the
server service name. Never publish the SDAR A2A port.

Before accepting users:

1. Confirm `/health` and `/ready`.
2. Confirm `/v1/models` through Open WebUI shows `sdar-single-agent`.
3. Confirm missing/forged identity returns 401.
4. Confirm ordinary and utility chat create no SDAR Task.
5. Run the final real-E2E checklist in [release checklist](release-checklist.md).

The more detailed topology guide remains at
[deployment/openwebui-connection.md](deployment/openwebui-connection.md).
