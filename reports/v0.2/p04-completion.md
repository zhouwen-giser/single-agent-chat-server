# P04 completion

Status: `PASSED`

P04 adds a deterministic, read-only query service for all nine frozen query
intents. Explicit queries are resolved before LangGraph classification and
before the legacy Task lookup. The execution-level test proves the graph,
model, and legacy coordinator path are not entered for a query.

Capability facts come from the safe projection of the current Agent Card.
Successful discovery writes a bounded, endpoint-hashed last-known-good (LKG)
snapshot. LKG is used only for a clearly labelled degraded response and is
never reported as Runtime readiness. Agent Card persistence failure does not
replace an otherwise valid current-card response.

Every Task-specific query first resolves a principal + internal thread + Task
binding. An unbound explicit Task ID is rejected before the A2A client is even
created. Authorized status, result, history, allowed-action, and Capability Gap
queries use only `getTask`; query code has no submit, Follow-up, or cancel
branch. Returned Task and history Message identities must match the authorized
Task/context before any published content is rendered.

Conversation listing is local-only. Completed Task facts fall back to the most
recent authorized binding, while `query_active_task` remains strictly active
only. Fresh `getTask` observations are persisted through an authorized,
timestamp-monotonic update. The three `INPUT_REQUIRED` phases publish distinct
allowed-action sets.

Final verification passed: unit 56/56, contract 30/30, PostgreSQL integration
43/43, security 8/8, format, lint, LangGraph paths, typecheck, build,
architecture, and migration gates. Three failed required attempts are retained.
