# P10 completion

Status: `PASSED_PUBLISHED`

## Identity

- Phase: P10
- Start SHA: `077ef907e6f0958bc953208025125c827254fa71`
- Timestamp UTC: `2026-08-21T15:55:13.224Z`
- Functional SHA: `8515f2dde83e470ead695744d9a1f360f0c63bc3`
- Exact-head CI: run `32499909972`; quality job `96826950287` passed;
  container job `96827333827` passed.

## Scope completed

- Added one protocol-neutral Conversation Application Service that owns durable
  context preparation, thin-graph inference, deterministic Task resolution,
  Task reference updates, and explicit Coordinator dispatch. The OpenAI route
  no longer contains a private classification or A2A orchestration path.
- Imported the complete OpenAI `messages[]` envelope with stable current-user,
  historical, and parent-assistant identities. Tool messages are ignored and
  system/developer messages cannot become persisted server authority.
- Deduplicated repeated client history against server-authored PostgreSQL
  messages and restored bounded prior user/assistant context on later turns.
- Preserved general chat, new Task creation with existing active Tasks, Task
  listing/status, explicit/focused mutation targeting, clarification, utility
  behavior, stream/non-stream responses, usage, headers, and error shapes.
- Persisted exactly the assistant text published through OpenAI. Normal streams
  write one complete message; disconnect, failure, or safety truncation writes
  only the published prefix with `truncated=true`, associated to request and
  observed Task when available.
- Kept utility/background requests outside history import, context/Task lookup,
  model inference, A2A, Focus, and conversation-message persistence.

## Tests

| Command / gate                         | Environment              | Result                                      | Required skips |
| -------------------------------------- | ------------------------ | ------------------------------------------- | -------------: |
| `pnpm verify:phase10`                  | isolated PostgreSQL 16.9 | 99 unit, 76 contract, 85 integration, build |              0 |
| OpenAI predecessor regression          | local                    | 1 suite / 22 tests passed                   |              0 |
| OpenAI durable conversation vertical   | isolated PostgreSQL 16.9 | 1 suite / 2 tests passed                    |              0 |
| `pnpm test:security`                   | local                    | 1 suite / 11 tests passed                   |              0 |
| `pnpm test:e2e:fixture`                | local                    | 1 suite / 1 test passed                     |              0 |
| `pnpm verify:migrations`               | local                    | 9 append-only files passed                  |              0 |
| `pnpm verify:architecture`             | local                    | 74 production source files passed           |              0 |
| `pnpm verify:licenses`                 | workspace pnpm store     | 89 allowed production entries               |              0 |
| `pnpm verify:secrets`                  | local                    | passed                                      |              0 |
| `pnpm smoke` / `pnpm verify:workflows` | local                    | passed                                      |              0 |

## Acceptance criteria

- AC-033: the OpenAI endpoint uses the durable multi-turn context and shared
  multi-Task application path, deduplicates full client history, and persists
  the actual complete or truncated streaming assistant output.
- AC-034: the predecessor OpenAI API retains its models, response, streaming,
  query, mutation, utility, security, and safe-error behaviors.

## Security and privacy review

- Client system/developer/tool content is not promoted to trusted instructions.
  Assistant history only reconciles exact server-published content.
- The model still receives no tool surface and cannot select an endpoint.
- Assistant persistence contains only northbound-rendered safe text and stable
  internal associations; hidden reasoning and raw A2A payloads are not stored.
- Disconnect aborts observation only and never invokes A2A cancellation.

## Follow-up

- P11 reuses the same Conversation Application Service from AG-UI and proves
  shared context, result, Focus, and restart behavior with the official client.
