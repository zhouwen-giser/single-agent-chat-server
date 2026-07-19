# Phase 11 real SDAR and Open WebUI E2E report

Generated: 2026-07-19T09:49:22+08:00

## Result

The real pip Open WebUI 0.10.2 to production chat server to frozen SDAR A2A
HTTP+JSON vertical slice passed. The SDAR runtime was an exported, frozen
`667146a3639eefdfed9b89c2417c08e1ac50e9a9` production server with real
PostgreSQL, Redis, official `@a2a-js/sdk@1.0.0-beta.0` traffic, and a real MCP
server. A deterministic structured-model fixture made the scenarios repeatable;
it did not replace Open WebUI, this service, the official A2A client, SDAR,
PostgreSQL, Redis, or MCP transport.

## Real vertical-slice evidence

1. Open WebUI `/openai/models` discovered `sdar-single-agent`.
2. Ordinary chat returned locally and persisted a user/chat thread with no
   `sdar_task_id`.
3. The live Agent Card advertised HTTP+JSON 1.0 streaming at `/a2a`; response
   SHA-256 was
   `bfcf6ebdb2e603a0859379ad1e5d234eeda4ff47f57f46b3d16e3330d6c302b1`.
4. A real task was created once through streaming `sendMessageStream`.
5. OpenAI SSE emitted published SUBMITTED/WORKING progress, status messages,
   Temporary Skill creation, workflow-planning progress, and INPUT_REQUIRED.
6. The status boundary lacked event metadata exactly as the real server emits;
   the coordinator immediately called `getTask()`, persisted
   `internalPhase=awaiting_plan_confirmation`, and rendered the correct explicit
   plan decision instead of guessing.
7. Confirm completed a task; reject returned CANCELED; revise returned to plan
   confirmation and then completed.
8. Missing device input produced `awaiting_user_input`; `device-17` was sent as
   `provide_input`, the same task advanced to plan confirmation, and completed.
9. A two-node real MCP workflow paused at a safe node boundary, published
   `internalPhase=paused`, resumed, and completed without replaying the finished
   node.
10. Chat cancellation invoked top-level `cancelTask()` and rendered CANCELED
    with the required Provider non-inference disclaimer.
11. COMPLETED rendered published text `Device is online.` plus JSON
    `{"status":"online"}` from the Result Artifact.
12. FAILED with `internalPhase=capability_gap` rendered the published missing
    capability, suggested Tool contract, and next action separately from a
    protocol/server failure.
13. The server was stopped with one active plan-confirmation binding. The new
    production PID logged `activeTaskBindings=1`; the same Open WebUI user/chat
    recovered the boundary, confirmed it, and completed.
14. Two real signed Open WebUI accounts used the same Chat ID. The non-owner saw
    no active task; PostgreSQL held two threads and only the owner had a binding.
15. A real `title_generation` utility request returned `Single SDAR chat` and
    created no task binding.
16. In an internal Docker network, an Agent Card deliberately advertised
    `http://0.0.0.0:7000/advertised-a2a`. The hardened current image used the
    explicit override and the official SDK probe log was exactly GET
    `/.well-known/agent-card.json`, then POST
    `/selected-a2a/message:stream`. It never used the advertised address.

Additional required boundaries passed:

- retrying the same Open WebUI user-message ID retained one completed
  idempotency claim and one remote task;
- a real SDAR outage returned sanitized OpenAI `500 server_error/internal_error`,
  kept `/ready` at 200 because PostgreSQL remained healthy, and created zero
  task bindings;
- the signed subject persisted as the Open WebUI user UUID; plaintext identity
  headers were not used;
- production architecture remained free of SDAR management, SDAR database, MCP,
  Mesh, Registry, routing, or capability-discovery dependencies.

## Persisted evidence audit

`PHASE11_DATABASE_URL=... pnpm audit:phase11:evidence` passed and audited 12
bindings plus 47 sanitized A2A observations. It asserted normal/utility no-task
behavior, completed artifacts, bounded-boundary `getTask` enrichment,
reject/revise, provide_input, pause/resume, cancelTask, Capability Gap, restart,
cross-user isolation, and retry idempotency.

## Complete repository gate

- format, ESLint, LangGraph config, typecheck, and build: passed
- unit: 5 suites, 31 tests passed
- contract: 2 suites, 25 tests passed
- integration: 3 suites, 36 tests passed with real PostgreSQL
- architecture: 41 production source files passed
- production licenses: 84 entries passed
- current container metadata: non-root `node`, healthcheck present
- current image ID:
  `sha256:84c2093be0c41920dbaf6a6940eabd538e44e05d29907d53aa591fbd6d521f57`
- `git diff --check`: passed
- known disposable credential scan: zero file hits

## Evidence boundary

Real evidence consists of Open WebUI model and completion responses, OpenAI SSE
chunks, persisted A2A summaries, production logs, Agent Card response, official
SDK endpoint-probe logs, and request/response summaries. Browser screenshot
capture was attempted through the required in-app Browser skill, but its Node
runtime failed three times with the Windows sandbox `helper_unknown_error`.
No screenshot is claimed or fabricated. This did not block the real HTTP/UI
server path or any functional assertion.

## Publication and cleanup

- Phase commit: `d6a79a91114fe8d55bc711e3d580790d52393443`
- Commit subject: `test: verify the Open WebUI to SDAR A2A vertical slice`
- Feature push: succeeded
- Draft PR: https://github.com/zhouwen-giser/single-agent-chat-server/pull/1
- Temporary listeners after cleanup: zero
- Temporary Phase 11 containers, networks, and volumes after cleanup: zero
- Temporary logs, SQLite data, Agent Card shim, and SDAR export: removed
- User Open WebUI 0.10.2 on port 8080: preserved and healthy
- Unrelated `sdar-rc2-test-db` container: preserved
- Next phase: Phase 12 adversarial review and hardening

No merge, force-push, rebase, or SDAR upstream modification was performed.
