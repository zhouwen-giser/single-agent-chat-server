# P02 completion

Status: `PASSED_LOCAL`

## Identity

- Phase: P02
- Start SHA: `f06f0b8082e5a357942d84d3dd70abbff141b649`
- Timestamp UTC: `2026-08-21T11:08:49.330Z`

## Scope completed

- Added a production OpenAI-compatible Chat Completions client with a fixed
  startup-configured base URL, model name, optional API key, strict timeout,
  bounded retry, abort, response-size limit, and strict response validation.
- Implemented `decideTurn`, `answerGeneral`, `summarize`, optional published
  result explanation, and a cached bounded readiness probe.
- Added strict JSON Schema or JSON-object response-format selection. Every
  `TurnDecision` is still parsed and validated locally; malformed JSON, extra
  fields, endpoint fields, and illegal actions fail closed.
- Removed the production regex/fixed-text model and its architecture allowlist.
  Missing configuration leaves liveness available but makes readiness fail and
  chat requests fail safely.
- Kept all HTTP access inside `packages/conversation-model`. Request content
  cannot replace the configured URL, model, key, or SDAR endpoint, and request
  bodies never expose tools or functions.
- Added content-free low-cardinality telemetry for decision, answer, summary,
  and published-result explanation operations.
- Added model configuration to `.env.example` and Compose, plus deployment,
  operations, API-readiness, and troubleshooting documentation.
- Added an explicit temporary bridge from the v0.3 model port to the existing
  thin v0.2 graph. It passes no durable history; P04/P06 replace this bridge
  with the shared persisted context and native decision path.

## Tests

| Command / gate                        | Environment                       | Result                                  | Required skips |
| ------------------------------------- | --------------------------------- | --------------------------------------- | -------------: |
| `pnpm test:unit`                      | local                             | 14 suites / 83 tests passed             |              0 |
| `pnpm test:contract`                  | loopback-capable                  | 7 suites / 64 tests passed              |              0 |
| `pnpm test:integration`               | isolated PostgreSQL 16.9          | 6 suites / 51 tests passed              |              0 |
| `pnpm test:security`                  | local                             | 1 suite / 9 tests passed                |              0 |
| format/lint/LangGraph/typecheck/build | local                             | passed                                  |              0 |
| `pnpm verify:architecture`            | local                             | 66 production source files passed       |              0 |
| `pnpm verify:licenses`                | package-store-capable             | 89 production entries, allowed SPDX set |              0 |
| `pnpm verify:secrets`                 | local                             | passed                                  |              0 |
| `docker compose config --quiet`       | explicit non-production variables | passed                                  |              0 |

The P02 client tests use an injected local HTTP transport. This is valid for
the P02 client/configuration gate and is not represented as a live model call.
The required current-head real-model gate remains P13.

## Acceptance criteria

- AC-004: production constructs the configured OpenAI-compatible client and no
  longer constructs a local fallback.
- AC-005: absent configuration produces `conversationModel=unavailable` at
  readiness and cannot silently classify or answer locally.
- AC-006: user/model content cannot modify either configured endpoint; model
  requests contain no tool/function surface.

## Security and privacy review

- API keys exist only in startup configuration and the outbound Authorization
  header. Telemetry receives only operation/outcome/duration.
- Prompts, responses, identities, Task text, URLs, and credentials are never
  telemetry attributes or application logs.
- Model input is serialized as bounded untrusted data under fixed system
  prompts and cannot grant network, tool, A2A, database, or execution access.
- Non-HTTP(S), credential-bearing, query-bearing, and fragment-bearing model
  base URLs are rejected at startup.

## Blockers / follow-up

- P03 adds protocol-neutral message/summary persistence.
- P04 assembles and summarizes real durable conversation context.
- P06 removes the temporary legacy graph bridge.
- P13 must run a genuine configured model E2E; no such evidence is claimed in
  this phase.
