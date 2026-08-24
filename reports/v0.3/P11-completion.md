# P11 completion

Status: `PASSED_PUBLISHED`

## Identity

- Phase: P11
- Start SHA: `5e7503a92efad2a6c472b8f38fd6a5235af6e292`
- Timestamp UTC: `2026-08-21T16:34:33.720Z`
- Functional SHA: `e03a8570ea0dd51b97c37ed1fc33c633c6f88ca0`
- Exact-head CI: run `32503356579`; quality job `96837914040` passed;
  container job `96838341355` passed.

## Scope completed

- Replaced AG-UI's private last-message/single-active-Task path with the same
  Conversation Application Service used by OpenAI. Context assembly,
  TurnDecision, Task Directory, deterministic resolution, Focus/reference
  updates, authorization, and Coordinator dispatch now have one implementation.
- Imported supported AG-UI messages by official message ID and reconciled
  repeated full history. OpenAI and AG-UI bindings for the same signed principal
  and external thread converge on one internal Thread, while different
  principals remain isolated.
- Persisted exactly the assistant deltas published as official AG-UI text
  events. Normal completion is complete; failure or disconnect persists only
  the emitted prefix with `truncated=true`.
- Preserved the strict completed-result discriminator for Durable Runs. An
  accepted Message, including a Task-associated Message, remains `MESSAGE` and
  replays without querying changed Task state. A `TASK` Run recovers its own
  persisted Task ID rather than Focus or another active Task.
- Kept official event schema, sequence, SSE ordering, bounded public state,
  safe error output, and no-tool profile.
- Proved multiple open Task interrupts are independent. Querying/focusing B
  leaves A and C open; Resume by A's interrupt ID follows up only A with the
  exact persisted Task/context/input-request identity.

## Tests

| Command / gate                       | Environment              | Result                                      | Required skips |
| ------------------------------------ | ------------------------ | ------------------------------------------- | -------------: |
| `pnpm verify:phase11`                | isolated PostgreSQL 16.9 | 99 unit, 78 contract, 89 integration, build |              0 |
| `pnpm verify:v03:agui`               | isolated PostgreSQL 16.9 | 10 suites / 35 tests passed                 |              0 |
| OpenAI predecessor regression        | local                    | 1 suite / 22 tests passed                   |              0 |
| `pnpm test:security`                 | local                    | 1 suite / 11 tests passed                   |              0 |
| `pnpm test:e2e:fixture`              | local fixture            | 1 suite / 1 test passed                     |              0 |
| `pnpm verify:migrations`             | local                    | 9 append-only files passed                  |              0 |
| `pnpm verify:architecture`           | local                    | 74 production source files passed           |              0 |
| `pnpm verify:licenses`               | workspace pnpm store     | 89 allowed production entries               |              0 |
| `pnpm verify:secrets` / `pnpm smoke` | local                    | passed                                      |              0 |

## Acceptance criteria

- AC-035: AG-UI and OpenAI use the same Conversation Context, resolver,
  Coordinator, request-result repository, internal Thread, message ledger, and
  authorization boundary.
- AC-036: each AG-UI Run and interrupt retains exact Task/context identity;
  restart/replay recovers the selected Task even while another Task is active.

## Security and privacy review

- Official client IDs are untrusted reconciliation keys, never authorization.
  Principal and internal Thread authorization gate every message, Run, Task,
  interrupt, and result access.
- Client tools remain rejected and AG-UI cannot select the model endpoint or
  SDAR endpoint. The configured model still has no tools.
- Only safe public event deltas are persisted or replayed; hidden reasoning,
  raw SDK objects, credentials, and private failure details are excluded.
- Browser disconnect and Focus changes never imply cancellation or interrupt
  authority.

## Follow-up

- P12 performs the dedicated security, privacy, observability, and adversarial
  hardening pass across the now-shared OpenAI/AG-UI runtime.
