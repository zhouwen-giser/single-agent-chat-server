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
- [ ] Phase 5: Open WebUI signed identity and chat continuity.
- [ ] Phase 6: submission, status, bounded streaming, and polling fallback.
- [ ] Phase 7: follow-up, input, cancellation, and terminal outcomes.
- [ ] Phase 8: restart, concurrency, and consistency hardening.
- [ ] Phase 9: secure observability and operational controls.
- [ ] Phase 10: Docker, CI, licenses, SBOM, and governance gates.
- [ ] Phase 11: real Open WebUI-to-SDAR vertical-slice E2E evidence.
- [ ] Phase 12: adversarial review, fixes, and regressions.
- [ ] Phase 13: final acceptance, release evidence, and PR Ready state.

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
