# PostgreSQL persistence boundary

Phase 4 adds durable chat continuity without copying SDAR-owned execution state.
PostgreSQL stores only local routing, recovery, and deduplication data.

## Schemas

- `langgraph_checkpoint` is owned by
  `@langchain/langgraph-checkpoint-postgres` and initialized with
  `PostgresSaver.setup()`.
- `chat_service` is owned by this repository and changed only through numbered,
  append-only SQL files in `migrations/`.
- `chat_thread_binding` maps one `(openwebui_chat_id, user_id)` pair to a stable
  internal LangGraph thread identifier.
- `conversation_task_binding` stores the authorized SDAR task/context binding,
  last published status observation, pending input summary, event hash,
  terminal timestamp, and optimistic version.
- `request_idempotency` serializes message submission by key, user, and chat.
  The request hash prevents reuse with different content; a lease permits
  recovery after an interrupted process; completed claims replay the original
  Task identifier.
- `a2a_event_cache` deduplicates published A2A observations by Task and event
  hash. It is not an event cursor and does not imply Task resubscription.

The schema contains no SDAR Goal, Plan, Skill, Action, Workflow, Provider, MCP
Task, or Evidence records. SDAR remains authoritative for all of them.

## Invariants

- Task lookup is authorized by both Open WebUI chat ID and user ID.
- A partial unique index permits at most one nonterminal Task per chat thread.
- Task updates use optimistic versions. Once `terminal_at` is set, later stale
  nonterminal updates cannot clear it or roll the persisted status backward.
- Duplicate same-hash claims are either reported as in progress or replay the
  completed result. A different hash for the same key is a conflict.
- Startup reconciliation lists active bindings and reclaims only expired
  idempotency leases. It does not contact SDAR or assume an A2A event cursor.

## Operation

Set `DATABASE_URL`, then run:

```powershell
pnpm.cmd migrate
```

Server startup runs the same checksum-verified migrations, initializes the
checkpoint schema, and performs reconciliation before listening. A changed
checksum for an already applied migration fails startup. Add a new numbered
migration instead of editing a published one.

`DATABASE_POOL_MAX` defaults to 10 and `IDEMPOTENCY_LEASE_MS` defaults to 60000.
Keep PostgreSQL on a trusted network and use a least-privilege database role.

## Verification

The PostgreSQL integration suite requires a dedicated database literally named
`single_agent_chat_phase4`; this guard prevents its schema-reset checks from
targeting an ordinary database.

```powershell
$env:TEST_DATABASE_URL = "postgresql://.../single_agent_chat_phase4"
pnpm.cmd test:persistence
```

The suite verifies empty and append-only upgrade migrations, checkpoint schema
setup, concurrent claims, same-hash replay, different-hash conflict, expired
lease recovery, process restart, user/chat isolation, event deduplication, and
terminal monotonicity against real PostgreSQL.
