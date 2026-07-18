# Phase 8 recovery, concurrency, and consistency report

Generated: 2026-07-18T23:39:25+08:00

## Result

Phase 8 implementation, real PostgreSQL verification, production recovery
smokes, semantic commit, push, Draft PR update, and temporary-runtime cleanup
are complete.

## Delivered

- an atomic per-chat submission lease before A2A discovery or Task creation
- lease release on success, failure, abort, and lazy-client discovery failure
- startup recovery for expired idempotency claims and submission leases
- one-active-Task enforcement before and after the remote Task identifier exists
- timestamp-aware observation updates plus optimistic version increments
- terminal monotonicity: stale or nonterminal observations cannot reopen a Task
- bounded stream-end and caller-disconnect recovery through authorized `getTask`
- lazy SDAR discovery coalescing with retry after temporary discovery outage
- PostgreSQL idle-connection recovery after a real database restart
- idempotent SIGINT/SIGTERM shutdown that closes Fastify and persistence once
- duplicate Follow-up and cancellation suppression through request idempotency

## Complete gate actually run

- `TEST_DATABASE_URL=... pnpm verify:phase8`: passed
  - format: passed
  - ESLint: passed with zero warnings
  - LangGraph config: passed
  - typecheck: passed
  - unit: 4 suites, 20 tests passed
  - contract: 2 suites, 20 tests passed
  - integration: 3 suites, 35 tests passed, including 34 real PostgreSQL tests
  - build: passed
- coordinator suite with `--detectOpenHandles`: 23 tests passed
- `git diff --check`: passed

The recovery cases cover concurrent distinct turns, duplicate input/cancel,
expired submission leases, startup lease recovery, stale observations, terminal
monotonicity, bounded stream polling, disconnect recovery, temporary SDAR
discovery outage, PostgreSQL restart, production service restart, and graceful
shutdown idempotency.

## Real recovery smokes

A built production server on loopback handled an authenticated Open WebUI
utility request, remained alive while its dedicated PostgreSQL 16.9 container
was restarted, and handled a second request through a newly obtained pool
connection. The server was then restarted against the same database and reused
the same persisted chat binding successfully. Both server processes and the
dedicated PostgreSQL container were removed after evidence capture.

## Boundaries and honest E2E state

Recovery and consistency are verified with real PostgreSQL and a real built
server. SDAR outage/retry and A2A coordination use controlled client doubles;
the official adapter remains covered by local HTTP+JSON contracts. A real SDAR
run and full Open WebUI-to-SDAR vertical slice are not claimed before Phase 11.
No event cursor, arbitrary Task resubscription, management API, direct SDAR
database access, MCP access, or hidden reasoning was introduced.

## Publication state

- Head before phase commit: `64481458e8cfe1ccc8dd8967cf35a9a8ed24a19b`
- Phase commit: `9e906a1bbe2d70afdbf9002ea71f9b7f660c2a9f`
- Feature push: succeeded
- Draft PR #1: open, draft, body updated
- PR head at capture: `9e906a1bbe2d70afdbf9002ea71f9b7f660c2a9f`
- Merge state at capture: `UNKNOWN` immediately after push
- Remote checks at capture: none configured/reported
- Blockers: none
- Next phase: Phase 9, secure observability and operational controls
