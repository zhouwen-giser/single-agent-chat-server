# single-agent-chat-server

An OpenAI-compatible chat entrance for exactly one configured SDAR agent. Open
WebUI owns the user interface; this service owns signed identity, local
conversation continuity, bounded streaming, and safe translation of published
A2A state.

```text
Open WebUI -> /v1 --------\
                           SdarInteractionEvent -> thin LangGraph
AG-UI client -> /ag-ui ---/          |                 |
                                  PostgreSQL   isolated official A2A SDK
                                                       |
                                                   one SDAR
```

The service is deliberately not an SDAR manager, workflow engine, MCP client,
agent registry, capability-discovery service, or multi-agent router.

## Frozen compatibility

- execution-time SDAR main: `2275bc52759914bc80113358a9083e6f00d59e6d`
- execution-time SMPP main, read-only semantic reference:
  `f8c37e6a2ecdc859e56910803197ec938b9a807a`
- A2A specification patch: `1.0.1`
- Wire version: `1.0`
- Binding: `HTTP+JSON`
- SDK: `@a2a-js/sdk@1.0.0-beta.0`
- Open WebUI evidence baseline: `0.10.2`

Protocol drift fails closed. See [A2A compatibility](docs/a2a-compatibility.md).

## Requirements

- Node `22.14.x`
- pnpm `11.13.1`
- PostgreSQL 16 for persistence and integration tests
- one reachable OpenAI-compatible Chat Completions model gateway
- one reachable SDAR Agent Card and A2A endpoint
- Open WebUI 0.10.2 configured to forward a signed user JWT

## Local start

```bash
corepack enable
corepack prepare pnpm@11.13.1 --activate
pnpm install --frozen-lockfile
cp .env.example .env
# replace every development credential and configure the model, PostgreSQL, and SDAR
pnpm migrate
pnpm build
pnpm start
```

The default liveness and readiness endpoints are `/health` and `/ready`.
OpenAI-compatible routes are:

- `GET /v1/models`
- `POST /v1/chat/completions`

The pinned official AG-UI `0.0.57` routes are:

- `GET /ag-ui/capabilities`
- `POST /ag-ui`

Both `/v1/*` routes require the configured service bearer key and a valid
`X-OpenWebUI-User-Jwt`. Chat requests also require stable Open WebUI chat and
message IDs. See [API contract](docs/api-contract.md) and
[Open WebUI setup](docs/openwebui-setup.md).

Ordinary conversation and strict Turn Decisions come from the configured
model. The model has no tools or network/database/A2A authority. A Chat may
hold up to eight active Tasks by default. Untargeted status lists all active
Tasks; a mutable operation must resolve one unique authorized Task or SACS
returns clarification without calling A2A. Completed A2A requests persist
exactly one `TASK | MESSAGE` result, and an exact `MESSAGE` is replayed without
refreshing a later Task.

## Container start

Supply real secrets without committing them, then:

```bash
docker compose up --build -d
curl --fail http://127.0.0.1:3000/ready
```

The server container is non-root, read-only, capability-dropped, and published
on loopback by default. PostgreSQL remains on an internal network. SDAR must
also remain on a trusted network; its unauthenticated A2A endpoint must never be
public.

## Verification

```bash
pnpm verify:phase12       # hermetic quality and adversarial gate
pnpm verify:ci            # CI-equivalent PostgreSQL and fixture gate
pnpm test:e2e:fixture     # deterministic in-process fixture, not real E2E
pnpm smoke                # built-server health/models/completion probe
pnpm verify:v03           # complete exact-head gate; requires real services and Docker
```

`pnpm verify:v03` intentionally fails unless native PostgreSQL, Docker, a real
OpenAI-compatible model, the fixed current SDAR, exact source/candidate SHAs,
operator-reviewed safe Task requests, and an exact CI URL are configured. The
evidence directory and generated SBOM output must be below ignored `.tmp`;
every real gate identifies the exact local and remote candidate SHA. A skipped
database suite or deterministic fixture never satisfies the real release gate.

See [operations](docs/operations.md),
[v0.3 release-candidate qualification](docs/release-candidate-v0.3.md),
[troubleshooting](docs/troubleshooting.md),
[v0.3 traceability](docs/traceability-v0.3.md), and the current
[project status](PROJECT_STATUS.md).
