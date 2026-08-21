# P03 completion

Status: `PASSED_PUBLISHED`

## Identity

- Phase: P03
- Start SHA: `61b43cfe33998d281560ab9f6f7704831c422027`
- Timestamp UTC: `2026-08-21T11:36:57.666Z`
- Published candidate SHA: `0cb938b72101a0b550c7a5a0eeca1a4fef315da2`
- Exact-head CI: run `32478206127`; quality `96758849400`; container
  `96759157656`; all passed.

## Scope completed

- Added append-only migration `0007_conversation_history.sql`. Published
  migrations `0001` through `0006` remain byte-identical to the P00 source lock.
- Added protocol-neutral `conversation_message` and `conversation_summary`
  tables and a Thread-owned stable message-sequence counter.
- Added one shared `ConversationPersistenceRepository` to the production
  persistence runtime for both OpenAI and AG-UI callers.
- Implemented server-authoritative user ingestion, assistant append,
  assistant-history reconciliation, external-ID/content-hash deduplication,
  deterministic server IDs when a request lacks a message ID, recent-message
  loading, interrupted-assistant marking, summary loading, and optimistic
  summary save.
- Concurrent writes serialize only on their internal Thread and allocate unique
  monotonic sequence values. Duplicate replays do not consume a sequence.
- Client assistant history is reconciliation-only: it cannot create or replace
  a server assistant fact. Repository APIs never accept a client-selected
  system/developer role, and database checks allow only user/assistant.
- LangGraph checkpoints remain execution state and are not used as the sole
  transcript source. Existing v0.2 databases receive empty history tables and
  begin accumulating at sequence 1 without fabricated rows.

## Database migration

- New migration SHA-256:
  `dcb052c107810b4b9ec8d6d03e6ef84a3d0670e730a36f1b53f45a8e4bf4d91f`.
- `0001` through `0006` checksums exactly match
  `reports/v0.3/P00-source-lock.json`.
- Empty install and a representative database containing all `0001`–`0006`
  migrations passed.
- The v0.2 upgrade retained the existing principal/Thread, created no message or
  summary, and initialized the next sequence to 1.

## Tests

| Command / gate             | Environment              | Result                                      | Required skips |
| -------------------------- | ------------------------ | ------------------------------------------- | -------------: |
| `pnpm verify:phase3`       | isolated PostgreSQL 16.9 | 83 unit, 64 contract, 62 integration, build |              0 |
| P03 PostgreSQL suite       | isolated PostgreSQL 16.9 | 1 suite / 11 tests passed                   |              0 |
| `pnpm test:security`       | local                    | 1 suite / 9 tests passed                    |              0 |
| `pnpm verify:migrations`   | local                    | 7 append-only files passed                  |              0 |
| `pnpm verify:architecture` | local                    | 67 production source files passed           |              0 |
| `pnpm verify:licenses`     | package-store-capable    | 89 production entries, allowed SPDX set     |              0 |
| `pnpm verify:secrets`      | local                    | passed                                      |              0 |

## Acceptance criteria

- AC-007: protocol-neutral messages persist with stable sequence and strict
  external-ID/content-hash replay semantics.
- AC-008: the assistant append path durably stores the exact published A2A text,
  Task/request association, and interrupted boundary. P10/P11 will connect this
  shared path to both northbound renderers.
- AC-009: a new repository instance loads messages and optimistic summaries from
  PostgreSQL after restart.

## Security and privacy review

- Content, summary, identifiers, limits, roles, protocols, hashes, and sequence
  constraints are enforced in the repository and/or database.
- Every read/write is scoped by the internal Thread and principal; unauthorized
  reads return no data and unauthorized mutations fail.
- No prompt, message, summary, identifier, or hash is logged or added to metric
  attributes.
- The tables store conversation continuity only; no SDAR Goal, Plan, Skill,
  Workflow, Provider, MCP Task, Evidence, or hidden reasoning is copied.

## Follow-up

- P04 assembles bounded model context and advances summaries through this
  repository.
- P10/P11 persist text actually published by OpenAI and AG-UI, including partial
  output on disconnect, through the P03 assistant append path.
