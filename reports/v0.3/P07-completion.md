# P07 completion

Status: `PASSED_PUBLISHED`

## Identity

- Phase: P07
- Start SHA: `ceb75b35eac54becf42f486fb1d0c7cd969f6257`
- Timestamp UTC: `2026-08-21T14:04:54.472Z`
- Functional SHA: `14e98e1cd2c243747b06f8fb12252dcf534971ef`
- Exact-head CI: run `32489959546`; quality job `96795025944` passed;
  container job `96795413523` passed.

## Scope completed

- Existing-Task Coordinator operations now require an explicit full `taskId`.
  The Coordinator no longer performs implicit active-Task selection.
- Status without a selected target lists every active Task from persisted state;
  targeted status authorizes the exact user/chat/Task tuple before A2A.
- Follow-up and Cancel use a Task-binding lease. Mutations for the same Task are
  serialized while different Tasks in one Chat can proceed independently.
- Every `getTask` and Task-valued mutation result is checked against the
  persisted Task and Context identity before observation, Focus, or rendering.
- OpenAI and AG-UI pass the same locally resolved full Task ID into the shared
  Coordinator contract. Ambiguous mutable operations remain local and do not
  contact A2A.
- Optimistic Task updates use a bounded three-attempt reread/merge loop. A stale
  observation cannot overwrite terminal or newer persisted state.

## Tests

| Command / gate             | Environment              | Result                                      | Required skips |
| -------------------------- | ------------------------ | ------------------------------------------- | -------------: |
| `pnpm verify:phase7`       | isolated PostgreSQL 16.9 | 97 unit, 66 contract, 81 integration, build |              0 |
| PostgreSQL suites          | isolated PostgreSQL 16.9 | 7 suites / 76 tests passed                  |              0 |
| P07 targeted shared paths  | local fixtures           | 3 suites / 8 tests passed                   |              0 |
| `pnpm test:security`       | local                    | 1 suite / 11 tests passed                   |              0 |
| `pnpm verify:migrations`   | local                    | 8 append-only files passed                  |              0 |
| `pnpm verify:architecture` | local                    | 72 production source files passed           |              0 |
| `pnpm verify:licenses`     | workspace pnpm store     | 89 allowed production entries               |              0 |
| `pnpm verify:secrets`      | local                    | passed                                      |              0 |

## Acceptance criteria

- AC-022: explicit Follow-up, Cancel, and status contracts authorize the exact
  full Task ID; no Coordinator implicit-selection API remains.
- AC-023: A/B/C tests prove list-all status, Cancel B only, same-Task
  serialization, cross-Task mutation concurrency, and status concurrency.
- AC-024: wrong Task/Context identity fails closed, while bounded optimistic
  merge preserves terminal and newer state under stale writers.

## Security and privacy review

- Client-supplied AG-UI state remains non-authoritative; only the local resolver
  candidate plus repository authorization can select a Task.
- Status listing is a persisted, authorized, read-only operation and acquires no
  mutation lease. Mutable ambiguity returns safe text without an A2A call.
- Task/Context mismatch is rejected before persistence, Focus, or output.

## Follow-up

- P08 will make completed A2A Message results first-class, atomically persisted,
  and replayable without a second SDAR call.
