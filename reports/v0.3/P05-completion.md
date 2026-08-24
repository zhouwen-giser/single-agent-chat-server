# P05 completion

Status: `PASSED_PUBLISHED`

## Identity

- Phase: P05
- Start SHA: `90e2b4f64bbd2de0012b98577f8436f8ae057794`
- Timestamp UTC: `2026-08-21T12:51:10.590Z`
- Functional SHA: `1b36914a5d6240e658585b62c3d242e44831aaea`
- Exact-head CI: run `32483598648`; quality job `96775091214` passed in
  1m27s; container job `96775463612` passed in 1m14s.

## Scope completed

- Added append-only migration `0008_multi_task_directory.sql`, removed the
  one-active-Task partial unique index, and retained the per-Thread Task identity
  uniqueness invariant.
- Added deterministic active/recent directory indexes and persisted stable
  short IDs, last interaction timestamps, Task-level mutation leases, Focus,
  and last reference.
- Focus and last reference use same-Thread composite foreign keys. New Tasks
  become Focus; explicit query, Follow-up, Cancel, and direct status operations
  update Focus/reference without making Focus an execution constraint.
- Replaced both implicit singular active-Task repository APIs with authorized
  list/count/focus APIs. The architecture gate now rejects either legacy API in
  any production source.
- Changed new-Task concurrency control to a Chat/Thread submission lease plus a
  transactional configurable active-count check. The default is eight and the
  configured bound is one through 32.
- Moved Follow-up/Cancel locking to the selected Task binding. Concurrent
  mutations of one Task are exclusive; different Tasks can proceed in parallel.
- Mutable operations with multiple active candidates return a local
  clarification and do not call A2A. Untargeted status lists every active Task.
- Startup reconciliation now clears expired Task-interaction leases and reports
  that count while active metrics include every nonterminal binding.

## Tests

| Command / gate             | Environment              | Result                                      | Required skips |
| -------------------------- | ------------------------ | ------------------------------------------- | -------------: |
| `pnpm verify:phase5`       | isolated PostgreSQL 16.9 | 93 unit, 64 contract, 70 integration, build |              0 |
| P05 PostgreSQL suite       | isolated PostgreSQL 16.9 | 1 suite / 6 tests passed                    |              0 |
| PostgreSQL suites          | isolated PostgreSQL 16.9 | 7 suites / 69 tests passed                  |              0 |
| `pnpm test:security`       | local                    | 1 suite / 10 tests passed                   |              0 |
| `pnpm verify:migrations`   | local                    | 8 append-only files passed                  |              0 |
| `pnpm verify:architecture` | local                    | 72 production source files passed           |              0 |
| `pnpm verify:licenses`     | package-store-capable    | 89 allowed production entries               |              0 |
| `pnpm verify:secrets`      | local                    | passed                                      |              0 |

## Acceptance criteria

- AC-013: migration inspection and the architecture gate prove the old partial
  unique index and implicit singular repository APIs are absent.
- AC-014: PostgreSQL creates and restores three active Tasks in one Thread with
  deterministic directory order and stable collision-expanded short IDs.
- AC-015: adversarial Focus attempts using a sibling Thread or another principal
  fail before any row can violate the same-Thread foreign key.
- AC-016: concurrent submission claims serialize, the configurable limit cannot
  be exceeded through the coordinator path, and terminal Tasks do not count.

## Security and privacy review

- Every directory, Focus, reference, and Task lease operation joins the
  principal/Thread authorization tuple; client Task IDs do not grant authority.
- Ambiguous mutable requests do not acquire a request/Task lease and do not call
  the trusted SDAR A2A endpoint.
- No model, A2A, MCP, Provider, database, shell, credential, URL, or user content
  was added to metric labels or startup logs.

## Follow-up

- P06 will add the deterministic selector resolver over full Task IDs, short
  IDs, ordinals, Focus, recency, and bounded summary candidates.
