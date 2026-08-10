# Phase 13 — final acceptance and v0.1.0 evidence

## Result

`ACCEPTANCE_PASSED_PUBLICATION_PENDING`

All required local, PostgreSQL, real Open WebUI-to-SDAR, Docker, Compose, supply
chain, and adversarial gates passed at source commit
`085e456c9802462c5d0c2a8c2310cadbfa760a96` on
`feature/single-sdar-chat-entry-v0.1`. Push and pull-request CI for that exact
commit also passed. This report is the required publication commit payload; the
PR remains Draft until this commit is pushed and its final checks pass.

No PR merge, tag, GitHub Release, or SDAR upstream change is authorized or
performed.

## Frozen topology verified

```text
pip Open WebUI 0.10.2
  -> OpenAI-compatible backend proxy
  -> current single-agent-chat-server
  -> thin LangGraph chat graph
  -> @a2a-js/sdk@1.0.0-beta.0 adapter
  -> A2A 1.0 HTTP+JSON
  -> SDAR 667146a
  -> real Redis and Streamable HTTP MCP transport
```

- SDAR source: `667146a3639eefdfed9b89c2417c08e1ac50e9a9`.
- A2A spec patch: `1.0.1`; wire: `1.0`; binding: `HTTP+JSON`.
- Agent Card selected interface: `http://127.0.0.1:9999/a2a`.
- Live raw Agent Card SHA-256:
  `d6de4beb1b6af17dac3db6c25be74672f38a5bd184e6e9b9682b499b99c24068`.
- Open WebUI used an isolated pip data directory and forwarded a signed user
  JWT plus documented chat/message header templates.
- The chat service itself used no SDAR management API, SDAR database, MCP,
  Registry, Mesh, or capability-discovery dependency. The isolated test harness
  used the loopback management API only to configure the disposable SDAR test
  database.

## Required command record

| Command                          | Result | Evidence                                                     |
| -------------------------------- | ------ | ------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | PASSED | lockfile unchanged                                           |
| `pnpm peers check`               | PASSED | no peer dependency issues                                    |
| `pnpm format:check`              | PASSED | all files matched                                            |
| `pnpm lint`                      | PASSED | zero findings                                                |
| `pnpm typecheck`                 | PASSED | TypeScript no-emit                                           |
| `pnpm test:unit`                 | PASSED | 31/31                                                        |
| `pnpm test:contract`             | PASSED | 26/26                                                        |
| `pnpm test:integration`          | PASSED | 36/36 against PostgreSQL 16.9; zero skips                    |
| `pnpm test:e2e`                  | PASSED | fixture 1/1 plus 26/26 required real scenarios               |
| `pnpm test:security`             | PASSED | 8/8                                                          |
| `pnpm build`                     | PASSED | production TypeScript build                                  |
| `pnpm smoke`                     | PASSED | built health, model discovery, completion                    |
| `pnpm verify:migrations`         | PASSED | three append-only migrations; real startup apply also passed |
| `pnpm verify:architecture`       | PASSED | 42 production files                                          |
| `pnpm verify:openai-api`         | PASSED | 19/19                                                        |
| `pnpm verify:a2a`                | PASSED | 7/7 official-SDK adapter contracts                           |
| `pnpm verify:openwebui`          | PASSED | live Open WebUI, live frozen Agent Card, 26 real scenarios   |
| `pnpm verify`                    | PASSED | strict aggregate gate including Docker and current SBOM      |

Additional aggregate results:

- production licenses: 84 entries; Apache-2.0, BSD-3-Clause, ISC, MIT;
- workflow static gate: quality and container jobs present;
- secret-pattern scan: 178 tracked files;
- current CycloneDX 1.7 SBOM regenerated from the production image;
- production image: non-root `node`, healthcheck present, port 3000 exposed.

## Real E2E evidence

The live run used real HTTP/SSE, the official SDK adapter, PostgreSQL 16.9, the
exact frozen SDAR, Redis, and real Streamable HTTP MCP tool discovery/execution.
The chat-owned evidence audit passed with 12 bindings and 47 sanitized published
events.

All 26 verifier scenarios are `PASSED_REAL`:

- model discovery, ordinary chat without Task, Agent Card discovery;
- Task creation, published phase messages, bounded stream and `getTask()`
  enrichment, status query;
- plan confirm/reject/revise, `provide_input`, pause/resume, top-level
  `cancelTask()`;
- completed text+JSON Artifact, failed state and Capability Gap;
- server restart recovery, cross-user isolation, utility isolation, retry
  idempotency, and forged signed-identity rejection;
- real SDAR outage behavior, explicit Docker endpoint override, and the Phase 12
  terminal-stream regression.

The `provide_input` run demonstrated that `awaiting_user_input` transitions
later to a separate `awaiting_plan_confirmation` boundary; no plan decision was
inferred from the user input. Pause was separately rendered from both input
states.

## Outage and Docker evidence

With only the verified temporary SDAR process stopped, Open WebUI returned a
sanitized generic error, chat `/ready` remained HTTP 200, and the outage chat
had zero Task bindings. SDAR then recovered from its isolated PostgreSQL/Redis
state with its provider and MCP registration intact.

A hardened production container read an Agent Card advertising
`http://0.0.0.0:7000/advertised-a2a`. With the explicit configured override,
the shim recorded exactly:

```text
GET  /.well-known/agent-card.json
POST /selected-a2a/message:stream
```

It did not silently use or rewrite the advertised endpoint. The isolated
override containers/network were deleted after capture.

A clean repository Compose project also passed: PostgreSQL and server were
healthy, five chat-service tables were applied, the server ran as `node` with
read-only root filesystem, `cap_drop: ALL`, and
`no-new-privileges:true`. `docker compose down -v --remove-orphans` left zero
project containers, volumes, or networks. Those disposable resources are not
recoverable; unrelated Docker resources were untouched.

## Evidence boundary

No browser screenshot was fabricated. Evidence is live HTTP/SSE output,
sanitized server/process logs, chat-owned PostgreSQL rows, Docker health/config
metadata, and recorded internal shim paths. Secrets, JWTs, request bodies,
prompts, hidden reasoning, and SDAR internal state are not published.

Exact-head publication evidence after this documentation commit is recorded in
PR #1 because a commit cannot contain its own SHA or its later CI result.
