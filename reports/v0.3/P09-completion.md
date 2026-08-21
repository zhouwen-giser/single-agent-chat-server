# P09 completion

Status: `PASSED_PUBLISHED`

## Identity

- Phase: P09
- Start SHA: `f55c9ed5afba34cb49fa57e23c826ca12449abdf`
- Timestamp UTC: `2026-08-21T15:17:14.037Z`
- Functional SHA: `fc05c96b654a82ba64df2611935c2dfffa0408be`
- Exact-head CI: run `32496491328`; quality job `96816017831` passed;
  container job `96816442562` passed.

## Scope completed

- Removed `AUTH_REQUIRED` from the internal `NormalizedTaskState` union. The
  official SDK value `TASK_STATE_AUTH_REQUIRED` now throws the typed,
  sanitized `UnexpectedA2aAuthenticationStateError` with stable code
  `UNEXPECTED_A2A_AUTH_REQUIRED` and HTTP status 502.
- Rejected Agent Cards when either the card or any advertised Skill declares a
  security requirement. The trusted southbound profile has no interactive
  credential flow.
- Confirmed that unexpected authentication stops before Task persistence,
  fallback polling, cancellation, credential prompting, or AG-UI Interrupt
  creation. The request slot remains non-completed and therefore cannot replay
  an invented result.
- Kept one lazy, process-scoped SDAR client promise under concurrent access.
  Strict request schemas and architecture checks prohibit per-request endpoint,
  base URL, or Agent Card injection.
- Added the attribute-free `a2a_unexpected_auth_required_total` counter without
  Task, endpoint, principal, credential, or error labels.
- Moved the Compose default SDAR address to `http://sdar:9999` on a distinct
  internal network while preserving all northbound service-key, JWT,
  authorization, rate-limit, and CORS controls.

## Tests

| Command / gate             | Environment              | Result                                        | Required skips |
| -------------------------- | ------------------------ | --------------------------------------------- | -------------: |
| `pnpm verify:phase9`       | isolated PostgreSQL 16.9 | 99 unit, 70 contract, 83 integration, build   |              0 |
| PostgreSQL suites          | isolated PostgreSQL 16.9 | 7 suites / 78 tests passed                    |              0 |
| `pnpm test:security`       | local                    | 1 suite / 11 tests passed                     |              0 |
| `pnpm verify:migrations`   | local                    | 9 append-only files passed                    |              0 |
| `pnpm verify:architecture` | local                    | 73 production source files passed             |              0 |
| `pnpm verify:licenses`     | workspace pnpm store     | 89 allowed production entries                 |              0 |
| `pnpm verify:secrets`      | local                    | passed                                        |              0 |
| `pnpm docker:build`        | local Docker             | candidate image built                         |              0 |
| `pnpm verify:compose`      | isolated Compose project | healthy, ready 200, 16 tables, cleanup passed |              0 |

## Acceptance criteria

- AC-030: the process exposes one fixed, concurrency-safe SDAR client and
  rejects request-level routing or Agent Card injection before an operation.
- AC-031: the trusted A2A connection rejects Agent Card security requirements
  and the SDK auth-required state with a bounded deployment mismatch error.
- AC-032: no internal auth-required state, credential prompt, Task persistence,
  poll, cancel, or Interrupt occurs; northbound authentication and Task
  authorization remain enforced.

## Security and privacy review

- The typed failure contains no endpoint, Task identity, credential, SDK
  payload, or Agent Card content.
- The telemetry counter has no attributes. Architecture gates keep the SDK enum
  isolated to normalization and prohibit the internal state from returning.
- The unauthenticated SDAR endpoint is not published by Compose and is reached
  through its own internal network by default.

## Follow-up

- P10 integrates durable conversation history and the shared multi-Task
  application path into the OpenAI/OpenWebUI endpoint while preserving the
  predecessor API contract.
