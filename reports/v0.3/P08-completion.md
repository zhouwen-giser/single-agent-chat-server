# P08 completion

Status: `PASSED_PUBLISHED`

## Identity

- Phase: P08
- Start SHA: `727beb85937dddc9ab685a67cb08f18114e7e4d2`
- Timestamp UTC: `2026-08-21T14:47:31.557Z`
- Functional SHA: `2aef667e3f7e9e9552bf98975f54cbf134cda0f6`
- Exact-head CI: run `32493711915`; quality job `96807094991` passed;
  container job `96807552281` passed.

## Scope completed

- Added migration `0009_request_result_union.sql`, which backfills historical
  completed Task requests and constrains every completed protocol-neutral
  request to exactly one `TASK` or `MESSAGE` result.
- Replaced the Task-only completion API with the strict shared
  `CompletedRequestResult` union. Normalized Message parts are bounded and
  exclude raw SDK payloads; completion persists status, result, rendered text,
  and result hash atomically.
- Unified the OpenAI and AG-UI Coordinator persistence boundary through
  `InteractionTaskCoordinatorRepository`; production no longer uses the
  OpenAI-only request-idempotency API.
- Initial Message-only streams complete as `MESSAGE` and replay the exact stored
  rendered text without another model, A2A, or `getTask` call.
- A stream that publishes Message content before creating a Task completes as
  `TASK`, while the earlier safe content remains an observed conversational
  event.
- Follow-up direct Messages persist their related Task/Context identity and
  replay exactly without querying a Task whose state may have changed.
- Task replay continues to refresh current state only after the original
  Task/Context binding is authorized. Invalid or empty streams never invent a
  completed result.
- Durable AG-UI startup and replay paths now understand both completed result
  variants.

## Tests

| Command / gate             | Environment              | Result                                      | Required skips |
| -------------------------- | ------------------------ | ------------------------------------------- | -------------: |
| `pnpm verify:phase8`       | isolated PostgreSQL 16.9 | 97 unit, 66 contract, 82 integration, build |              0 |
| PostgreSQL suites          | isolated PostgreSQL 16.9 | 7 suites / 77 tests passed                  |              0 |
| `pnpm test:security`       | local                    | 1 suite / 11 tests passed                   |              0 |
| `pnpm verify:migrations`   | local                    | 9 append-only files passed                  |              0 |
| `pnpm verify:architecture` | local                    | 72 production source files passed           |              0 |
| `pnpm verify:licenses`     | workspace pnpm store     | 89 allowed production entries               |              0 |
| `pnpm verify:secrets`      | local                    | passed                                      |              0 |

## Acceptance criteria

- AC-025: a normal Message-only initial stream atomically completes its request
  slot as `MESSAGE`.
- AC-026: sequential and concurrent same-hash replay returns identical text;
  the fake SDAR submit call count remains one and `getTask` remains zero.
- AC-027: a direct Follow-up Message replays byte-for-byte equal rendered text;
  `sendFollowUp` runs once and `getTask` remains zero.
- AC-028: Message-then-Task stream evidence stores `TASK`, while retaining the
  Message as published process content.
- AC-029: PostgreSQL rejects completed rows with no result or conflicting Task
  and Message fields using check violation `23514`.

## Security and privacy review

- Result parsing accepts no raw Part, credential header, SDK instance, or
  arbitrary URL scheme. Text, URL, part-count, and total serialized result
  budgets fail closed before persistence.
- Message replay reads only the normalized stored Message and safe rendered
  text. It does not expose database fields, hashes, endpoints, or exceptions.
- Task and related-Message replay compare persisted Task and Context identity
  before Focus, observation, or publication.

## Follow-up

- P09 removes internal `AUTH_REQUIRED` and treats the SDK auth-required state as
  a fail-closed trusted-network protocol/deployment mismatch while retaining all
  northbound authentication and Task authorization.
