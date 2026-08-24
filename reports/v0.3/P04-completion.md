# P04 completion

Status: `PASSED_PUBLISHED`

## Identity

- Phase: P04
- Start SHA: `dea27ec58ff3b482a81d6295c30f1ee9cdca7fc2`
- Timestamp UTC: `2026-08-21T12:03:03.015Z`
- Functional SHA: `192b5f7e170843e9add7ca471bf1179c75ccf697`
- Published candidate SHA: `8177411eb2d1265b3898a0876daaf8be14044260`
- Exact-head CI: run `32481037950`; quality `96767244477`; container
  `96767589710`; all passed.

## Scope completed

- Added a deterministic Context Assembler that combines the persisted summary,
  newest non-overlapping messages, bounded active/recent Task summaries, Focus,
  and last reference in the required priority order.
- The assembler measures the exact untrusted model JSON envelope, reserves the
  current user turn before history, and fails explicitly if that turn alone
  cannot fit. Summary and Task text are clipped or omitted deterministically.
- Added rolling summarization over the oldest unsummarized sequence range.
  Successful summaries advance through an optimistic versioned save; failures
  return a safe outcome and never delete or rewrite original messages.
- Added OpenAI/AG-UI-neutral client history reconciliation. Stable historical
  user IDs deduplicate, assistant history is reconciliation-only, privileged
  roles are ignored, unstable copied history is not fabricated, and the current
  user message maps to its authoritative northbound ID/request boundary.
- Added context character/message histograms with boolean summary/truncation
  flags only. No prompt, message, identity, Task ID, or body becomes a metric
  label or log field.
- Documented and exposed the four bounded context environment settings in the
  example and Compose runtime configuration.

## Architecture and persistence

- Conversation context depends only on structural history and Task Directory
  ports; the production PostgreSQL repository implements both recent-window and
  forward sequence reads without importing model authority.
- The exact assistant text stored by P03 is present in the next assembled turn.
  Summary overlap and the current user row are excluded by stable sequence.
- A new repository/assembler instance reconstructed an identical summary,
  recent message window, Focus, and Task Directory after restart.
- No migration was added or modified in P04. The seven-file append-only
  migration checksum gate remains passed.

## Tests

| Command / gate             | Environment              | Result                                      | Required skips |
| -------------------------- | ------------------------ | ------------------------------------------- | -------------: |
| `pnpm verify:phase4`       | isolated PostgreSQL 16.9 | 93 unit, 64 contract, 64 integration, build |              0 |
| P04 PostgreSQL suite       | isolated PostgreSQL 16.9 | 1 suite / 13 tests passed                   |              0 |
| `pnpm test:security`       | local                    | 1 suite / 9 tests passed                    |              0 |
| `pnpm verify:migrations`   | local                    | 7 append-only files passed                  |              0 |
| `pnpm verify:architecture` | local                    | 72 production source files passed           |              0 |
| `pnpm verify:licenses`     | package-store-capable    | 89 allowed production entries               |              0 |
| `pnpm verify:secrets`      | local                    | passed                                      |              0 |

## Acceptance criteria

- AC-010: exact unit assertions cover summary, recent messages, Task Directory,
  Focus/reference, actual assistant visibility, deterministic truncation,
  prompt-injection isolation, and restart equality.
- AC-011: both memory and PostgreSQL tests replay a full client history twice;
  users remain deduplicated and assistants remain server-authoritative.
- AC-012: configuration bounds, total model-data envelope, current-turn
  reservation, summary threshold, non-overlap, optimistic save, failure fallback,
  and original-message retention are tested.

## Security and privacy review

- Client system/developer content cannot enter durable history as a privileged
  instruction. All conversation and Task data stays inside a JSON untrusted-data
  boundary under a fixed system prompt.
- The model still has no tool, URL, A2A, MCP, Provider, database, shell, or
  credential surface.
- Existing principal/Thread authorization checks remain on every PostgreSQL
  read and write. P04 did not weaken service key, JWT, or Task authorization.

## Follow-up

- P05 will replace the placeholder Task Directory port with multi-Task binding,
  Focus, last-reference, and Task-level lease persistence.
