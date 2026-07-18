# Phase 4 PostgreSQL persistence and idempotency report

Generated: 2026-07-18T21:23:11+08:00

## Result

Phase 4 implementation and real PostgreSQL verification are complete. The
semantic phase commit and publication evidence are pending at this report
snapshot.

## Delivered

- exact `@langchain/langgraph-checkpoint-postgres@1.0.4` and `pg@8.22.0`
  production pins
- isolated `langgraph_checkpoint` schema initialized by `PostgresSaver.setup()`
- checksum-verified append-only business migrations under `migrations/`
- stable Open WebUI chat/user to LangGraph thread mapping
- authorized SDAR task/context bindings with one-active-task enforcement
- pending input, last status timestamp, last event hash, terminal timestamp, and
  optimistic version persistence
- claim/complete/replay/conflict/expired-lease idempotency semantics
- A2A published-event cache and Task/event-hash deduplication
- startup migration, checkpointer setup, active-binding reconciliation, and
  expired-claim recovery before the server listens
- standalone `pnpm migrate` command and persistence operations documentation
- direct dependency license record: all three Phase 4 additions are MIT

## Real PostgreSQL verification

The suite ran against PostgreSQL `16.9-alpine` using image digest
`sha256:7c688148e5e156d0e86df7ba8ae5a05a2386aaec1e2ad8e6d11bdf10504b1fb7`
and a dedicated database named `single_agent_chat_phase4`.

Verified against the real database:

- empty database migration
- append-only version-one upgrade and checksum preservation
- isolated LangGraph checkpoint schema creation
- concurrent same-message serialization
- completed same-hash replay
- different-hash conflict
- expired lease recovery after worker loss
- active binding restoration after process restart
- user/chat/task authorization isolation
- event deduplication
- optimistic terminal monotonicity
- built server startup reconciliation and `/ready` response

The temporary container had no volume and was removed after verification.

## Complete gate actually run

- `pnpm install --frozen-lockfile`: passed
- `pnpm peers check`: passed, no issues
- `TEST_DATABASE_URL=... pnpm verify:phase4`: passed
  - format check: passed
  - ESLint: passed; a later cleanup run confirmed zero warnings
  - `langgraph.json` paths/exports: passed
  - typecheck: passed
  - unit: 3 suites, 16 tests passed
  - contract: 2 suites, 14 tests passed
  - integration: 2 suites, 10 tests passed, including 9 real PostgreSQL tests
  - build: passed
- built server `/ready` smoke with real PostgreSQL: passed
- `git diff --check`: passed
- installed direct package version/license audit: passed

## Boundaries and honest E2E state

This phase proves local persistence behavior against real PostgreSQL. It does
not claim the final Open WebUI-to-real-SDAR vertical slice, which remains Phase 11. No SDAR Goal, Plan, Skill, Action, Workflow, Provider, MCP Task, or Evidence
data is copied. Startup reconciliation does not contact SDAR and does not assume
an A2A cursor or arbitrary Task resubscription.

## Publication state

- Head before phase commit: `d1538159d480011fa344ba2f094cf1e5dfd27c8e`
- Phase commit: pending
- Feature push: pending
- Draft PR #1 update: pending
- Blockers: none
- Next phase after publication: Phase 5, Open WebUI identity and chat continuity
