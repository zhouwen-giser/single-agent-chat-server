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
Task Runs recover through their authorized binding. New-Task submission remains
serialized per internal Thread, while operations on existing Tasks use
independent Task-level mutation leases.

## Recovery matrix

| Boundary                         | Durable fact                                            | Recovery behavior                                                    |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| before A2A submission            | request and `RUNNING` Run                               | expired owner can execute the original input                         |
| after submission, before binding | stable A2A message ID and claimed request               | retry uses the same message ID; it cannot choose a new Task identity |
| after Task binding               | principal/thread/Run/Task/context and request result    | call `getTask()` for that exact authorized Task                      |
| after Run finish                 | public outcome, exact result, optional Task association | replay MESSAGE or query that Run's TASK                              |

There is no stream cursor and no arbitrary stream resubscription. A live
`sendMessageStream` remains bounded; a nonterminal stream end uses the existing
bounded `getTask()` polling. Later retries observe a bound Task with `getTask()`
only.

The focused Task is never a recovery key. Multiple Runs in one Thread can bind
different active Tasks; replay or restart recovery uses the Run's persisted
result/task ID. A Task-associated Message result remains `MESSAGE` and replays
its stored content without consulting later Task state.

## Disconnect semantics

The HTTP close signal aborts only the current observation. It can stop the
bounded stream/poll loop and release a local submission lease, but it never
calls `cancelTask()`, sends `cancel_goal`, or changes SDAR state. If a Task or
Message result was already accepted, SACS persists that exact result and the
Run's optional Task identity before ending the disconnected observation. A
later retry replays Message content or rebuilds Task state from PostgreSQL and
authorized `getTask()` for that exact Task.

An explicit top-level cancellation remains a separate user operation routed to
the frozen A2A adapter. Browser lifecycle is not cancellation authority.

## PostgreSQL invariants

Migration `0006_durable_agui_runs.sql` adds protocol-neutral submission leases
to `conversation_thread` and recovery indexes without modifying previous
migrations. Run sequence updates are monotonic. Task/context identity is
write-once for a Run, and all reads join the principal-owned internal thread.
Application process restart creates new repository/coordinator/application
service instances over the same durable rows; no in-memory focus assumption or
event cursor is required.
