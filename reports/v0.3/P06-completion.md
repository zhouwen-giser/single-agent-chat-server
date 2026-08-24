# P06 completion

Status: `PASSED_PUBLISHED`

## Identity

- Phase: P06
- Start SHA: `df908e7b284c14ac4ed82f4f283c738d9fc034d0`
- Timestamp UTC: `2026-08-21T13:31:04.432Z`
- Functional SHA: `b29a005a125536ff9728bc3b011e7ff452aea919`
- Exact-head CI: run `32486976750`; quality job `96785597252` passed;
  container job `96785948295` passed.

## Scope completed

- Replaced the single active-Task Graph state with bounded active/recent Task
  arrays, Focus, last reference, selected target, task text, and the shared full
  Conversation Context.
- Replaced regex classification with the configured model's `decideTurn`, then
  strict local schema validation. Utility requests remain deterministic; model
  failure or invalid output returns a local safe response and cannot call A2A.
- Added deterministic resolution for full Task IDs, unique short IDs, stable
  ordinals, Focus, latest/previous, unique bounded summaries, and the sole
  active Task. Resolution never grants authorization.
- Routed Provider, Resource, Action, execution, and diagnostic requests through
  `new_task` to the one fixed SDAR A2A client. Removed the legacy regex Query
  Service from both production northbound paths and added an architecture ban.
- Untargeted multi-Task status renders the complete active directory locally.
  Ambiguous mutable operations render bounded candidates, increment a
  content-free counter, and do not call A2A.
- Successful resolution updates last reference. Explicit status, Follow-up,
  Cancel, and new Task creation update Focus only after the relevant A2A result
  succeeds; failed operations leave Focus unchanged.
- OpenAI and AG-UI now use the same assembled Conversation Context and the same
  graph/resolver/coordinator behavior.

## Tests

| Command / gate             | Environment              | Result                                      | Required skips |
| -------------------------- | ------------------------ | ------------------------------------------- | -------------: |
| `pnpm verify:phase6`       | isolated PostgreSQL 16.9 | 96 unit, 64 contract, 74 integration, build |              0 |
| PostgreSQL suites          | isolated PostgreSQL 16.9 | 7 suites / 69 tests passed                  |              0 |
| P06 resolution integration | local fixtures           | 1 suite / 4 tests passed                    |              0 |
| `pnpm test:security`       | local                    | 1 suite / 11 tests passed                   |              0 |
| `pnpm verify:migrations`   | local                    | 8 append-only files passed                  |              0 |
| `pnpm verify:architecture` | local                    | 72 production source files passed           |              0 |
| `pnpm verify:licenses`     | package-store-capable    | 89 allowed production entries               |              0 |
| `pnpm verify:secrets`      | local                    | passed                                      |              0 |

## Acceptance criteria

- AC-017: JSON Schema and Zod reject extra decision fields, malformed
  selectors, and illegal Follow-up actions before execution.
- AC-018: a model fixture routes Provider fleet status to `new_task` even when
  two Tasks are active, and the coordinator receives the model's bounded task
  text.
- AC-019: resolver tests cover full/short ID, ordinal, Focus,
  latest/previous, unique/ambiguous summary, sole active, and not-found cases.
- AC-020: ambiguous cancellation returns both authorized candidates without
  invoking Cancel, acquiring a Task mutation lease, or contacting A2A.
- AC-021: untargeted status with multiple active Tasks lists every active Task
  and does not issue a Task query.

## Security and privacy review

- The model receives only bounded protocol-neutral context and has no tool,
  endpoint, URL, A2A, MCP, Provider, database, shell, or credential surface.
- Model output selects only a candidate. Repository authorization over the
  principal/Thread/full Task ID tuple remains mandatory before reference or
  execution.
- Metrics contain only a counter increment; candidate summaries, identities,
  Task IDs, prompts, and message bodies are never attributes.

## Follow-up

- P07 will freeze explicit target contracts and prove Task-scoped mutation
  concurrency and cross-Task parallelism at the coordinator boundary.
