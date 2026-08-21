# Container deployment

The multi-stage image builds with Node 22.14.0 and pnpm 11.13.1, installs only
production dependencies in the runtime image, includes checksum-verified SQL
migrations, and runs as the existing non-root `node` user. The filesystem is
read-only under Compose except for a bounded `/tmp` tmpfs.

## Start the server and PostgreSQL

Set these values in the shell or a non-committed `.env` file:

```text
CHAT_SERVER_SERVICE_KEY=<at least 32 characters>
AG_UI_SERVICE_KEY=<different value, at least 32 characters>
OPENWEBUI_USER_JWT_SECRET=<same secret as Open WebUI forwarding>
CHAT_CORS_ALLOW_ORIGINS=<optional exact browser origin; empty denies CORS>
POSTGRES_PASSWORD=<strong database password>
CONVERSATION_MODEL_BASE_URL=http://model-gateway:8000/v1
CONVERSATION_MODEL_NAME=<deployed model name>
CONVERSATION_MODEL_API_KEY=<optional for a trusted private gateway>
```

Then run:

```powershell
docker compose up -d --build
docker compose ps
curl.exe http://127.0.0.1:3000/ready
```

Only the chat server is published, and only on loopback by default. PostgreSQL
is isolated on the internal backend network. Migrations and LangGraph
checkpoint setup run before the server starts listening.

## Connect external pip Open WebUI

The installed host Open WebUI should use `http://127.0.0.1:3000/v1`. A
containerized Open WebUI may join the `single-agent-chat-frontend` network and
use `http://server:3000/v1`, or reach the loopback-published port through an
explicit host gateway appropriate to its platform. Do not publish PostgreSQL or
the unauthenticated SDAR A2A endpoint.

The model URL is mandatory and is fixed when the server starts. The model
receives bounded conversational context and has no SACS tool, URL, database,
A2A, MCP, Provider, or shell access. Do not point it at a user-supplied URL.

The default SDAR URL inside Compose is `http://sdar:9999` on the internal
`single-agent-chat-sdar` network. Attach exactly the configured SDAR container
to that network (or set `CHAT_SERVER_SDAR_NETWORK` to its existing internal
network) and set, when its service name or endpoint differs:

```text
SDAR_A2A_BASE_URL=http://sdar:9999
SDAR_A2A_ENDPOINT_OVERRIDE=http://sdar:9999/a2a
```

The override must be explicit; the adapter never rewrites `0.0.0.0` silently.
Do not route the unauthenticated A2A connection through the public `frontend`
network or a host gateway. The server rejects Agent Cards that require an
interactive authentication scheme because that indicates a protocol/deployment
mismatch rather than a user action.

## Connect an official AG-UI client

Use `GET /ag-ui/capabilities` for the implemented profile and `POST /ag-ui` for
HTTP/SSE Runs. Supply the distinct `AG_UI_SERVICE_KEY` bearer credential and
the same validated signed-principal header policy used by the server. Do not
reuse the OpenAI service key. The official client must treat a finished HTTP
observation as bounded; reconnect by Run idempotency or an authorized status
Run, never by inventing an A2A cursor.

## Stop and remove test data

```powershell
docker compose down --volumes --remove-orphans
```

Omit `--volumes` for an ordinary restart when PostgreSQL data must persist.
