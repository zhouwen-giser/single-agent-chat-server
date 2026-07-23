# EP-01: Single SDAR chat entry server

This ExecPlan is a living document. Update `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` whenever work advances.

## Purpose

Build a deployable OpenAI-compatible chat service for exactly one configured
SDAR A2A agent. Open WebUI is the external UI. The service owns conversation
routing, local persistence, identity, idempotency, bounded stream handling, and
safe explanation of published A2A state. SDAR remains authoritative for goals,
skills, plans, workflows, execution, MCP work, and evidence.

```text
Open WebUI
  -> GET /v1/models and POST /v1/chat/completions
  -> thin LangGraph chat graph
  -> isolated official A2A SDK adapter
  -> one configured SDAR Agent
```

## Non-negotiable protocol boundary

- SDAR upstream commit: `667146a3639eefdfed9b89c2417c08e1ac50e9a9`.
- A2A specification patch: `1.0.1`; wire: `1.0`; binding: `HTTP+JSON`.
- SDK: exactly `@a2a-js/sdk@1.0.0-beta.0`, isolated in the adapter.
- Agent Card: `/.well-known/agent-card.json`; task endpoint: `/a2a`.
- Only `sendMessageStream`, `sendMessage`, `getTask`, and `cancelTask` may
  perform SDAR task operations.
- Existing-task messages require an allowed `metadata.sdar_action` and strict
  metadata. Interpret `INPUT_REQUIRED` with `Task.metadata.internalPhase`.
- A nonterminal stream end falls back to bounded `getTask()` polling. No cursor,
  replay, or arbitrary resubscription is assumed.
- No SDAR management API, SDAR database, ClickHouse, MCP, Mesh, Registry,
  capability discovery, multi-agent routing, or custom UI is in scope.

## Progress

- [x] 2026-07-18: Read and checksum the complete R2 task package.
- [x] 2026-07-18: Initialize and push protected-flow `main` governance.
- [x] 2026-07-18: Select maintained `create-langgraph@1.1.5` ->
      `new-langgraphjs-project` baseline at template commit
      `4e5f3cd20895663f43d77b91074fbab9d7d05476`.
- [x] 2026-07-18: Run the unmodified template unit test, build, ESLint, and
      `langgraph.json` path verification.
- [x] 2026-07-18: Verify exact SDAR source and a live Agent Card; record hash.
- [x] 2026-07-18: Confirm pip Open WebUI 0.10.2 is healthy on loopback 8080.
- [x] 2026-07-18: Phase 0 verified, committed as `03423e9`, pushed, and published as Draft PR #1.
- [x] 2026-07-18: Phase 1 verified, committed as `a28b882`, pushed, and recorded on Draft PR #1.
- [x] 2026-07-18: Phase 2 verified, committed as a5d1b8a, pushed, and recorded on Draft PR #1.
- [x] 2026-07-18: Phase 3 verified, committed as 34641c6, pushed, and recorded on Draft PR #1.
- [x] 2026-07-18: Phase 4 verified, committed as b8be3b3, pushed, and recorded on Draft PR #1.
- [x] 2026-07-18: Phase 4 PostgreSQL checkpoints, bindings, events, and idempotency complete.
- [x] 2026-07-18: Phase 5 verified, committed as 8b878ee, pushed, and recorded on Draft PR #1.
- [x] 2026-07-18: Phase 5 Open WebUI signed identity and chat continuity complete.
- [x] 2026-07-18: Phase 6 verified, committed as 0f35d53, pushed, and recorded on Draft PR #1.
- [x] 2026-07-18: Phase 6 submission, status, bounded streaming, polling fallback, and disconnect recovery complete.
- [x] 2026-07-18: Phase 7 verified, committed as c144198, pushed, and recorded on Draft PR #1.
- [x] 2026-07-18: Phase 7 phase-gated Follow-up, input, cancellation, terminal outcomes, and redaction complete.
- [x] 2026-07-18: Phase 8 verified, committed as 9e906a1, pushed, and recorded on Draft PR #1.
- [x] 2026-07-18: Phase 8 restart, concurrency, lease recovery, and stale-event hardening complete.
- [x] 2026-07-19: Phase 9 verified, committed as 34e731b, pushed, and recorded on Draft PR #1.
- [x] 2026-07-19: Phase 9 secure logs, telemetry, limits, and dependency readiness complete.
- [x] 2026-07-19: Phase 10 verified and published as `d8fade1`, with its
      evidence follow-up committed as `c479c04`.
- [x] 2026-07-19: Phase 11 real Open WebUI-to-SDAR vertical-slice E2E
      verified and published as `d6a79a9`, with the evidence report committed
      as `61fec2f`.
- [x] 2026-07-23: Work-mode handoff verified the remote feature/main SHAs,
      both Phase 11 commits, Draft PR #1, and the two latest failed Actions
      runs without performing a remote write.
- [x] 2026-07-23: Reproduced the latest `verify:phase10` failure as a
      Prettier-only defect in the Phase 11 JSON report and repaired it locally
      in `2124f21`.
- [x] 2026-07-23: Phase 12 adversarial review, actionable fixes, seven
      dedicated security regressions, the expanded architecture gate, and
      `verify:phase12` completed locally as `a93e953`; nothing was pushed.
- [ ] 2026-07-23: Phase 13 implementation, documentation, and every available
      local gate completed; required native PostgreSQL, real Open WebUI/SDAR,
      Docker/Compose, and current SBOM gates are blocked by the workspace.

## Implementation sequence

Each phase is a minimal closed loop: implement, test, update this plan and
`reports/goal/sync-state.json`, write Markdown and JSON evidence, commit with the
specified semantic subject, push immediately, and update the Draft PR. Never
amend or force-push published history.

1. Establish a reproducible TypeScript/LangGraph foundation without production
   chat behavior. Freeze template and SDAR protocol evidence.
2. Define stable internal DTOs and OpenAI request/response/SSE contracts behind
   service-key authentication.
3. Build a small graph with deterministic guards for utility, general chat,
   new task, status, follow-up, and cancellation.
4. Isolate all SDK types and operations inside `packages/a2a-sdar-client`.
   Validate Agent Cards and only apply an explicit endpoint override.
5. Add append-only PostgreSQL migrations and repositories for identity,
   task bindings, observations, leases, and idempotency.
6. Verify service bearer authentication, signed Open WebUI JWTs, utility
   isolation, and stable thread/message identity mapping.
7. Consume real bounded A2A streams, emit published status text, poll with
   `getTask()` after nonterminal end, and never cancel at the Chat time budget.
8. Validate phase/action compatibility and strict follow-up metadata. Reuse
   task/context IDs and use top-level `cancelTask()`.
9. Reconcile active bindings and leases after restarts. Protect one-active-task
   and terminal monotonicity with optimistic concurrency.
10. Add redacted logs, low-cardinality metrics, limits, readiness, graceful
    shutdown, containers, CI, licenses, and SBOM evidence.
11. Run the literal acceptance matrix through installed Open WebUI and real
    SDAR. Distinguish real, mock-assisted, and unverified evidence.
12. Perform adversarial boundary review and fix every actionable finding.
13. Run every final command, publish reports, mark PR Ready only after all
    required checks and real E2E pass, and never merge without authorization.

## Validation

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd peers check
pnpm.cmd verify:phase0
pnpm.cmd verify:phase1
```

Final validation is the complete Phase 13 command list in the task package. A
skipped, simulated, or mock-only check never satisfies a required real-E2E gate.

## Surprises & Discoveries

- `create-langgraph@1.1.5` downloaded the maintained template before its final
  Git-init prompt failed in this non-interactive terminal with `uv_tty_init ...
EBADF`. The exact extracted baseline was complete and tested unchanged.
- The template declares Yarn 1.22.22 and ESLint 8-era tooling. This repository
  uses pinned pnpm 11.13.1 while retaining its graph and Studio shape.
- pnpm 11 replaced `onlyBuiltDependencies` with `allowBuilds` in
  `pnpm-workspace.yaml`. Only reviewed `esbuild` is allowed.
- Open WebUI is installed by pip rather than Docker. Version 0.10.2 is healthy
  on `127.0.0.1:8080`; integration evidence must follow the actual topology.
- No SDAR initially listened on 9999. An isolated temporary server from the
  exact commit produced the Agent Card; all temporary resources were removed.
- The first dedicated PostgreSQL host port was already allocated. The test
  container was recreated on an unused loopback port without touching the
  existing listener. docker exec pg_isready hung, while direct pg access,
  all integration tests, and server startup succeeded; the temporary container
  and its unpersisted test data were then removed.
- A real PostgreSQL container restart killed an idle pooled connection. The
  pool emitted its documented idle-client error, discarded that client, and
  the unchanged production server process served the next request through a
  fresh connection. The same persisted chat also survived a server restart.
- A Phase 9 lease-expiry test exposed a real 10ms wall-clock race under a busy
  integration run. Replacing the delay with an explicit expired SQL timestamp
  made the recovery assertion deterministic without weakening the behavior.
- The Phase 11 report commit added valid evidence but serialized two JSON
  values in a style rejected by the pinned Prettier. Both remote workflows
  therefore failed in `quality`, and the dependent container job was skipped.
- The current Work-mode workspace provides neither Docker nor native
  PostgreSQL, Open WebUI, SDAR, Redis, or MCP listeners. An isolated PGlite
  wire-compatibility probe exercised most database tests but is explicitly not
  accepted as a real PostgreSQL replacement.

## Decision Log

- 2026-07-18: Use the official minimal `New LangGraph Project` JS template,
  not the archived/full-stack Agent Chat UI scaffold. Open WebUI already owns UI
  and the product graph must remain thin.
- 2026-07-18: Pin direct dependencies and pnpm rather than template caret
  ranges, for reproducibility and license evidence.
- 2026-07-18: Keep Phase 0 graph deterministic and Studio-only. Public API and
  SDAR behavior begin in later independently verified phases.
- 2026-07-18: Treat pip Open WebUI as the authoritative installed topology.
- 2026-07-18: Keep LangGraph checkpoint tables in langgraph_checkpoint and
  local bindings/idempotency/event observations in chat_service. Apply the
  latter only through checksum-verified append-only migrations.
- 2026-07-18: Scope idempotency by key, user, and chat; use request hashes and
  leases for conflict, replay, and interrupted-worker recovery. Never infer an
  A2A cursor from the local event cache.
- 2026-07-18: Add a separate per-chat submission lease before lazy A2A
  discovery. It closes the interval before an SDAR Task ID exists while the
  existing partial unique index remains authoritative after binding.
- 2026-07-19: Keep telemetry content-free and low-cardinality. Use only route,
  status class, operation, outcome, and stream-kind labels; correlation IDs
  remain in redacted logs and response headers, never metric attributes.
- 2026-07-19: PostgreSQL is the readiness dependency. SDAR discovery remains
  lazy so temporary Agent outage fails a chat operation without withdrawing
  the otherwise healthy OpenAI-compatible entrance.
- 2026-07-23: Apply the Work-mode handoff package's stricter local-only rule.
  All Phase 12/13 commits stay on `work/local-phase12-phase13-handoff`;
  `origin` has `NO_PUSH_ALLOWED` as its push URL, and the repository owner owns
  all later publication and PR decisions.

- The first isolated Open WebUI smoke inherited the chat server DATABASE_URL
  and failed before proxy testing because the pip install lacked psycopg2.
  Removing that variable only from the Open WebUI child restored its isolated
  SQLite default; real signed model discovery and chat proxying then passed.

- 2026-07-18: Accept only Open WebUI 0.10.2 default X-OpenWebUI-User-Jwt
  with HS256 and strict claims. Do not trust plaintext user headers or permit
  configurable algorithms/header names on the server side.

## Outcomes & Retrospective

Phase 0 has a reproducible scaffold and verified upstream evidence. Publication
evidence will be appended after the phase commit, push, and Draft PR exist. The
Phase 1 now provides authenticated OpenAI-compatible HTTP/SSE contracts without
SDAR behavior. It is published; Phase 2 is the next code boundary.

## Phase 2 outcome

The OpenAI Chat Completions route now executes the thin LangGraph chat graph.
Structured output is strict-schema validated and then checked against active
task state and internal phase. Utility calls remain local, a second active task
is blocked, and no A2A operation exists before Phase 3. Verification evidence
is in reports/goal/02-thin-chat-graph.md. Phase 3 is next.

## Phase 3 outcome

The official beta.0 SDK is pinned and isolated behind stable internal DTOs.
Agent Card discovery fails closed unless HTTP+JSON 1.0 with streaming is
advertised. Endpoint correction is explicit only. The four permitted SDK
operations, strict metadata, normalization, and timeout/abort behavior passed a
real local HTTP+JSON mock contract. No final real SDAR E2E is claimed. Phase 4
PostgreSQL persistence is next.

## Phase 4 outcome

Real PostgreSQL 16.9 verification covers empty and upgrade migrations,
checkpointer setup, concurrent idempotency, retry replay/conflict, expired lease
recovery, process restart, binding authorization, event deduplication, and
terminal monotonicity. The built server completed startup reconciliation and
reported ready against that database. No final SDAR/Open WebUI E2E is claimed;
Phase 4 is published; Phase 5 Open WebUI identity integration is next.

## Phase 5 outcome

Two-layer Open WebUI authentication, strict session headers, persisted user/chat
thread mapping, and the Postgres graph checkpointer are wired into production.
A real isolated pip Open WebUI 0.10.2 instance forwarded its own signed JWT,
discovered the model, proxied a chat completion, and produced one binding plus
six checkpoint rows. Phase 5 is published; Phase 6 submission and bounded streaming is next.

## Phase 6 outcome

New SDAR-bound turns now claim idempotency before `sendMessageStream`, persist
the published Task/context binding, and emit real OpenAI SSE deltas from only
published status and Artifact data. Nonterminal stream completion and the
30-second observation boundary fall back to bounded `getTask` polling without
cancellation. Real PostgreSQL tests cover long tasks, disconnect recovery,
terminal text/JSON results, and exact-message replay. Production A2A discovery
is lazy, so readiness passed with SDAR deliberately unavailable. Phase 6 is
published; Phase 7 Follow-up and terminal interaction handling is next.

## Phase 7 outcome

Published `INPUT_REQUIRED` phase and input-request data now drives strict
Follow-up decisions. Plan approval is explicit only; user input, pause/resume,
goal actions, and top-level cancellation reuse the authorized Task boundary
through permitted SDK operations. Capability Gap, ordinary business failure,
completion, and cancellation are rendered separately with bounded redaction;
streaming protocol failures close safely. Real PostgreSQL coordination and
adapter contract gates passed. Phase 7 is published; Phase 8 recovery and
consistency hardening is next.

## Phase 8 outcome

Concurrent distinct turns are now serialized before any remote Task creation,
and expired submission/idempotency leases are reclaimed on startup. Persisted
observations reject older timestamps, terminal Tasks cannot reopen, and
optimistic versions still expose concurrent updates. Lazy SDAR discovery
recovers after temporary outage; graceful shutdown closes persistence once.
The built production server passed both a live PostgreSQL restart and a process
restart against the same persisted chat. Phase 8 is published; Phase 9 secure
observability and operational controls is next.

## Phase 9 outcome

Production now emits content-free Pino JSON logs, bounded correlation IDs, and
no-op-safe OpenTelemetry spans/metrics for API, model, Agent Card, and permitted
A2A boundaries. Rate limiting, message/body/database/stream limits, active Task
and stream gauges, and low-cardinality enforcement are covered by regression
tests. A real built server kept liveness at 200 while PostgreSQL was down,
reported readiness 503, and recovered readiness in the same PID after database
restart; its logs passed a secret scan. Phase 9 is published; Phase 10 Docker,
CI, license, SBOM, and governance work is next.

## Phase 10 outcome

The production image is multi-stage, production-dependency-only, non-root, and
health-checked. Compose starts the server with a clean PostgreSQL 16.9 volume,
applies all migrations, isolates the database network, publishes only to
loopback, and documents the external Open WebUI network. Frozen dependency,
peer, architecture, license, image, Compose, and CycloneDX SBOM gates passed
locally. Both push and pull-request GitHub Actions quality/container jobs passed.
Phase 10 is published; Phase 11 real SDAR and Open WebUI E2E is next.

## Phase 11 outcome

The remote `d6a79a9` commit and its `61fec2f` evidence report record a real
Open WebUI 0.10.2 → production chat server → SDAR
`667146a3639eefdfed9b89c2417c08e1ac50e9a9` vertical slice with real
PostgreSQL, Redis and MCP transport. The official
`@a2a-js/sdk@1.0.0-beta.0` HTTP+JSON path was used; the deterministic
structured-model fixture did not replace those components. The stale Progress
and sync-state records were a publication-state defect, not grounds to delete
or rewrite Phase 11 evidence.

## Local handoff outcome

The handoff starts from remote feature `61fec2f` on local branch
`work/local-phase12-phase13-handoff`. The fetch URL remains read-only and the
push URL is `NO_PUSH_ALLOWED`. The existing PR is unchanged, and GitHub
Actions has not run for any local handoff commit. Phase 12 is next. Final-head
real E2E and container checks remain environment-dependent required gates; if
they cannot be supplied, Phase 13 must produce a truthful blocked local-review
package.

## Phase 12 outcome

Local functional commit `a93e953` bounds and validates untrusted A2A payloads,
fails closed on Task/context identity drift and cross-origin endpoints,
serializes mutating Task interactions, suppresses stale rejected observations,
restricts signed roles, and safely bounds published output. The repeatable
architecture gate also rejects production drift toward management APIs, MCP,
mesh, registry, capability discovery, multi-agent UI stacks, or direct network
access outside the isolated adapter. `pnpm verify:phase12` passed with 31 unit,
26 contract, and seven dedicated security tests across 42 production files.
The commit is local only. Phase 13 final-head real E2E and container verification
remain blocked unless the required external runtimes are supplied.

## Phase 13 local outcome

Final acceptance tooling and documentation are present at verification source
HEAD `719572c`. Hermetic quality passed with unit 31/31, contract 26/26,
security 7/7, fixture E2E 1/1, OpenAI 19/19, A2A 7/7, architecture 42 files,
licenses 84 entries, built-server smoke, and static migration/workflow/secret
gates. Integration was only partial because 35 native-PostgreSQL cases skipped.
The strict live E2E and aggregate `verify` commands failed closed on missing real
environment configuration; Docker, Compose, container, and current SBOM checks
were unavailable. Phase 13 remains incomplete and produces a blocked
local-review archive. PR #1 is unchanged; the repository owner must review,
unblock, push, and verify remote CI manually.
