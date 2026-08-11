# Operations

## Health and startup

- `/health` proves the process can serve HTTP.
- `/ready` also checks PostgreSQL. SDAR discovery remains lazy, so a temporary
  agent outage does not withdraw the otherwise healthy entrance.
- Migrations use a PostgreSQL advisory lock, SHA-256 checksums, and one
  transaction per append-only SQL file.
- Startup reconciliation expires abandoned idempotency and interaction leases
  and restores active Task counts.

## Configuration

Required production values are `CHAT_SERVER_SERVICE_KEY`, `AG_UI_SERVICE_KEY`,
`OPENWEBUI_USER_JWT_SECRET`, `DATABASE_URL`, and `SDAR_A2A_BASE_URL`. Use an
explicit `SDAR_A2A_ENDPOINT_OVERRIDE` only for a validated but unusable
container-advertised endpoint. Never derive it from user input.

Tune request/body/message/response, polling, connection-pool, and rate limits
with the documented environment settings in `.env.example`. Browser CORS is
deny-by-default; set `CHAT_CORS_ALLOW_ORIGINS` only to exact trusted origins.
Supply secrets
through the deployment secret store, not image layers or Git.

## Observability

Logs contain request IDs, routes, status classes, durations, and bounded
low-cardinality operation outcomes. They redact authorization, JWTs, prompts,
bodies, messages, artifacts, and token-like fields. Metrics must not include
user, chat, Task, prompt, Artifact, URL, or error-text labels.

## Recovery

- PostgreSQL outage: liveness stays up, readiness becomes 503, and the pool may
  recover without a process restart.
- SDAR outage: the affected chat request returns a sanitized error; local
  binding and idempotency state remain authoritative.
- A2A stream interruption/nonterminal end: bounded `getTask()` polling; never
  infer a cursor or cancel at the HTTP observation boundary.
- Server restart: persisted active binding and leases are reconciled.
- Shutdown: reject new work, abort active HTTP observation, close persistence,
  and do not claim the top-level Task or lower-level providers were canceled.

## Container controls

The production image is non-root and has a healthcheck. Compose uses a read-only
filesystem, tmpfs for `/tmp`, all capabilities dropped, and
`no-new-privileges`. Clean-start and cleanup must operate only on the project's
own Compose resources.

`pnpm verify:compose` creates a uniquely prefixed `sacs-p13-*` project, waits
for PostgreSQL migrations and HTTP readiness, verifies the runtime controls,
then removes only that disposable project's containers, volume, and networks.
It is an acceptance command, not a production shutdown command.

## Known limitations and rollback

- Exactly one fixed SDAR is supported. Its current A2A endpoint is
  unauthenticated and must stay on a trusted isolated network.
- A2A observation streams are bounded. Recovery uses `getTask()` polling; there
  is no event cursor or arbitrary Task stream resubscription.
- AG-UI RAW and Tool Call events are deliberately disabled. Internal SDAR/MCP
  operations are not public tools.
- Open WebUI and official AG-UI clients are independent northbound protocols;
  neither is an authority for Task state.

For an application rollback, retain the PostgreSQL volume, stop new traffic,
and deploy the previously verified image with the same service credentials and
SDAR endpoint. Migrations are append-only and have no automatic destructive
down migration; confirm the older image understands the current schema before
rollback. Never use `docker compose down --volumes` for a production rollback.
If compatibility is uncertain, preserve the database and stop rather than
resetting it.
