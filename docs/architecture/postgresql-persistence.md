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
  internal LangGraph thread identifier. Its bounded submission lease serializes
  active-count validation and the start of a new Task submission.
- `conversation_task_binding` stores the authorized SDAR task/context binding,
  stable short ID, last interaction, Task-scoped mutation lease, last published
  status observation, pending input summary, event hash, terminal timestamp,
  and optimistic version.
- `conversation_task_focus` and `conversation_task_reference` use same-thread
  composite foreign keys, so Focus and last reference cannot cross a Thread.
- `interaction_request` is the protocol-neutral OpenAI/AG-UI idempotency store.
  It serializes a request by protocol, principal, Thread, key, and request hash;
  a lease permits bounded recovery after an interrupted process. A completed
  row contains exactly one normalized `TASK` or `MESSAGE` result plus a
  SHA-256 result hash. The older OpenAI-only request API is not used by the
  production Coordinator.
- `a2a_event_cache` deduplicates published A2A observations by Task and event
  hash. It is not an event cursor and does not imply Task resubscription.
- `conversation_message` is the protocol-neutral, server-authoritative user and
  assistant transcript. `(protocol, thread_id, external_message_id)` prevents
  repeated client history from being appended again, while a Thread-owned
  counter allocates a unique stable sequence under concurrent OpenAI/AG-UI
  writes. Assistant rows contain only text actually published to the client and
  record truncation when an observation was interrupted.
- `conversation_summary` stores a bounded summary, the exact sequence it covers,
  and an optimistic version. Original message rows are never deleted when a
  summary advances.

The schema contains no SDAR Goal, Plan, Skill, Action, Workflow, Provider, MCP
Task, or Evidence records. SDAR remains authoritative for all of them.

## Invariants

- Task lookup is authorized by both Open WebUI chat ID and user ID.
- A Thread may contain multiple nonterminal Tasks. The deterministic directory
  orders active Tasks first, then by last interaction, creation time, and Task
  ID. The configurable active limit defaults to eight.
- Task updates use optimistic versions. A conflict performs at most three
  reread/merge attempts; a newer timestamp or terminal row wins. Once
  `terminal_at` is set, later stale nonterminal updates cannot clear it or roll
  the persisted status backward.
- Duplicate same-hash claims are either reported as in progress or replay the
  exact completed result. A different hash for the same key is a conflict.
- Request completion and the full result union are committed in one update.
  Database constraints reject `COMPLETED` without a result, both result kinds,
  unbounded rendered text, or malformed Message JSON. A `MESSAGE` replay never
  queries a potentially changed Task; a `TASK` replay is authorized against
  the original Task and Context before refresh.
- Older published observations cannot overwrite a newer persisted observation;
  optimistic versions still advance so callers can detect concurrent writes.
- Startup reconciliation lists every active binding and reclaims expired
  idempotency, submission, and Task-interaction leases. It does not contact SDAR
  or assume an A2A event cursor.
- LangGraph checkpoints remain execution state, not the sole conversation
  history. Message and summary recovery uses the protocol-neutral repository.
- Client-supplied assistant history is reconciliation-only: it may match a
  server-persisted message but cannot create or overwrite an assistant fact.
  Only `user` and `assistant` roles can exist in the table.

## Operation

Set `DATABASE_URL`, then run:

```powershell
pnpm.cmd migrate
```

Server startup runs the same checksum-verified migrations, initializes the
checkpoint schema, and performs reconciliation before listening. A changed
checksum for an already applied migration fails startup. Add a new numbered
migration instead of editing a published one.

`DATABASE_POOL_MAX` defaults to 10, `IDEMPOTENCY_LEASE_MS` defaults to 60000,
and `CHAT_MAX_ACTIVE_TASKS_PER_CHAT` defaults to 8.
Keep PostgreSQL on a trusted network and use a least-privilege database role.
Idle PostgreSQL connection failures are delegated back to the pool so a later
query can reconnect after a temporary database restart. SIGINT and SIGTERM
close Fastify once; the close hook then drains both persistence pools.

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
terminal monotonicity against real PostgreSQL. The v0.3 conversation suite also
verifies external-ID/content-hash deduplication, concurrent message sequence,
published assistant text, interrupted output, restart loading, optimistic
summary conflicts, system-role exclusion, and representative v0.2 upgrade with
no invented history. The P05 suite verifies three concurrent active bindings,
same-thread Focus enforcement, collision-safe short IDs, configurable active
limits, Task-level lease isolation, terminal counting, and v0.2 migration.
The P07 coordinator suite verifies explicit A/B/C targeting, read-only listing,
same-Task serialization, cross-Task mutation parallelism, status during another
Task mutation, Task/Context mismatch rejection, and bounded stale-write merge.
The P08 suite verifies atomic `TASK | MESSAGE` completion, exact message-only
replay without another A2A call, Message-then-Task precedence, direct Follow-up
Message replay without `getTask`, invalid-result rejection, and representative
upgrade backfill. It also retains submission-lease serialization/expiry/startup
recovery, stale-event rejection, database restart recovery in the same
production process, and service restart against the same persisted database.
