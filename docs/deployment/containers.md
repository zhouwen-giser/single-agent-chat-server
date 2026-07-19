# Container deployment

The multi-stage image builds with Node 22.14.0 and pnpm 11.13.1, installs only
production dependencies in the runtime image, includes checksum-verified SQL
migrations, and runs as the existing non-root `node` user. The filesystem is
read-only under Compose except for a bounded `/tmp` tmpfs.

## Start the server and PostgreSQL

Set these values in the shell or a non-committed `.env` file:

```text
CHAT_SERVER_SERVICE_KEY=<at least 32 characters>
OPENWEBUI_USER_JWT_SECRET=<same secret as Open WebUI forwarding>
POSTGRES_PASSWORD=<strong database password>
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

The default SDAR URL inside Compose is `http://host.docker.internal:9999`.
When SDAR is another container, attach the server to that trusted private
network with a local Compose override and set:

```text
SDAR_A2A_BASE_URL=http://sdar:9999
SDAR_A2A_ENDPOINT_OVERRIDE=http://sdar:9999/a2a
```

The override must be explicit; the adapter never rewrites `0.0.0.0` silently.

## Stop and remove test data

```powershell
docker compose down --volumes --remove-orphans
```

Omit `--volumes` for an ordinary restart when PostgreSQL data must persist.
