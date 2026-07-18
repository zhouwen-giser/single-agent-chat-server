# Phase 5 Open WebUI identity and chat continuity report

Generated: 2026-07-18T22:07:11+08:00

## Result

Phase 5 implementation, repository verification, and a real isolated pip Open
WebUI 0.10.2 proxy smoke are complete. Semantic commit and publication evidence
are pending at this snapshot.

## Delivered

- existing service bearer key retained as the first trust layer
- dependency-free HS256 verification for `X-OpenWebUI-User-Jwt`
- strict `iss=open-webui`, `sub`, `role`, `iat`, `exp`, signature, algorithm,
  lifetime, and future-issued checks
- plaintext `X-OpenWebUI-User-*` identity rejected
- required Chat ID, Message ID, and User Message ID parsing
- optional parent Message ID and utility task parsing
- signed user plus Chat ID persistence to a stable internal thread
- Postgres LangGraph checkpointer wired into the production graph
- utility task header routed deterministically to the local graph
- exact pip/Docker Open WebUI connection and network documentation
- updated API, security, environment, and failure-mode documentation

## Real Open WebUI connection evidence

An isolated instance was started from the installed pip Open WebUI 0.10.2
package on loopback with a temporary SQLite data directory. Through its actual
HTTP APIs, the verification:

1. created a real temporary admin user;
2. configured the server as an OpenAI-compatible connection;
3. enabled Open WebUI signed-user forwarding with a shared secret;
4. configured all five custom header templates;
5. discovered `sdar-single-agent` through Open WebUI's `/openai/models` proxy;
6. sent a non-streaming completion through Open WebUI's
   `/openai/chat/completions` proxy; and
7. received a nonempty `chat.completion` response.

The Open WebUI-generated signed subject was persisted with
`openwebui_chat_id=phase5-real-chat`. The real PostgreSQL database contained one
matching thread binding and six LangGraph checkpoint rows after the request.

The first isolated startup attempt inherited the chat server's PostgreSQL URL
and failed before connection testing because pip Open WebUI lacked `psycopg2`.
The rerun removed that variable only from the Open WebUI child environment so
it used isolated SQLite; the full proxy chain then passed. All child processes,
temporary SQLite data, and no-volume PostgreSQL containers were removed.

## Complete gate actually run

- `pnpm install --frozen-lockfile`: passed
- `pnpm peers check`: passed, no issues
- `TEST_DATABASE_URL=... pnpm verify:phase5`: passed
  - format: passed
  - ESLint: passed with zero warnings
  - LangGraph config: passed
  - typecheck: passed
  - unit: 3 suites, 16 tests passed
  - contract: 2 suites, 18 tests passed
  - integration: 2 suites, 10 tests passed, including 9 real PostgreSQL tests
  - build: passed
- real pip Open WebUI connection smoke: passed
- real signed JWT forwarding: passed
- real thread binding and checkpoint persistence query: passed
- `git diff --check`: passed

## Boundaries and honest E2E state

This is a real Open WebUI-to-chat-server connection smoke for local chat and
continuity. The A2A adapter is intentionally not yet invoked by the HTTP graph;
the real Open WebUI-to-SDAR vertical slice remains Phase 11. Utility isolation
is real at the current route/graph boundary, and no SDAR management API,
database, or MCP dependency was introduced.

## Publication state

- Head before phase commit: `e2c29ef7bfb4c69af459b7518d2fa77dcb29481b`
- Phase commit: pending
- Feature push: pending
- Draft PR #1 update: pending
- Blockers: none
- Next phase after publication: Phase 6, Task submit, status, and bounded streaming
