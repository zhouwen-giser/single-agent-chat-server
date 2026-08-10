# Durable AG-UI Run recovery

SACS persists an AG-UI request claim and an `interaction_run` before the thin
LangGraph graph can submit work. A Run is an observation boundary; it is not an
A2A Task and never becomes an event cursor or a Task subscription.

## Two idempotency scopes

- The outer request uses the official AG-UI `runId` and a canonical hash of the
  validated `RunAgentInput`. Same ID and hash replays; changed input conflicts.
- A possible Task submission uses the stable `${runId}:task` A2A message ID.
  Its durable request claim and per-thread submission lease reuse the existing
  single-SDAR coordinator.

The two scopes let local chat/query Runs replay without inventing a Task while
Task Runs recover through their authorized binding. Concurrent submissions for
one internal thread cannot both acquire the PostgreSQL submission slot.

## Recovery matrix

| Boundary                         | Durable fact                                     | Recovery behavior                                                    |
| -------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| before A2A submission            | request and `RUNNING` Run                        | expired owner can execute the original input                         |
| after submission, before binding | stable A2A message ID and claimed request        | retry uses the same message ID; it cannot choose a new Task identity |
| after Task binding               | principal/thread/Task/context and request result | call `getTask()` for that exact authorized Task                      |
| after Run finish                 | bounded public outcome and optional Task binding | replay local outcome or query the bound Task                         |

There is no stream cursor and no arbitrary stream resubscription. A live
`sendMessageStream` remains bounded; a nonterminal stream end uses the existing
bounded `getTask()` polling. Later retries observe a bound Task with `getTask()`
only.

## Disconnect semantics

The HTTP close signal aborts only the current observation. It can stop the
bounded stream/poll loop and release a local submission lease, but it never
calls `cancelTask()`, sends `cancel_goal`, or changes SDAR state. If a Task was
already bound, SACS persists that identity and completes the outer request
claim before ending the disconnected observation. A later Run query rebuilds
state from PostgreSQL and the authorized `getTask()` result.

An explicit top-level cancellation remains a separate user operation routed to
the frozen A2A adapter. Browser lifecycle is not cancellation authority.

## PostgreSQL invariants

Migration `0006_durable_agui_runs.sql` adds protocol-neutral submission leases
to `conversation_thread` and recovery indexes without modifying previous
migrations. Run sequence updates are monotonic. Task/context identity is
write-once for a Run, and all reads join the principal-owned internal thread.
Application process restart creates new repository/coordinator instances over
the same durable rows; no in-memory event cursor is required.
