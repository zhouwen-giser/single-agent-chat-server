# Phase 12 — adversarial hardening

## Status

`COMPLETED` on `feature/single-sdar-chat-entry-v0.1`. The adversarial regression
was published as `15bf0897d1f0c4e09aaad3780c22a600d676bc2d`; the minimal production fix was
published as `0d05d52288c4acca55745fe137127dd91649e0ab`.

## Boundary result

The production service remains a thin entrance for one configured SDAR. The
repeatable architecture gate rejects direct database access outside persistence,
network access outside the A2A adapter, management/MCP routes, dynamic SDAR/MCP
environment access, and production dependencies associated with MCP, mesh,
registry, capability discovery, CopilotKit, AG-UI, or ClickHouse.

## Actionable findings and fixes

| Finding                                                                                                       | Risk                                              | Minimal fix                                                                                                                 | Regression evidence                                          |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| A2A payloads were normalized without aggregate, collection, timestamp, URL, or JSON-complexity bounds         | resource exhaustion and ambiguous malformed state | validate roles, IDs, identity links, RFC 3339 timestamps, URLs, collection counts, JSON depth/nodes, and serialized sizes   | `adversarial.security.test.ts`, adapter contract             |
| A stream could change Task/context identity after its first event                                             | cross-task state corruption                       | fail closed on every event whose identity differs from the persisted binding                                                | stream identity-drift security test                          |
| published text/JSON could retain active Markdown/HTML and response aggregation was unbounded                  | UI injection, secret publication, memory growth   | redact secrets, encode HTML, escape Markdown, bound JSON, fragments, characters, and A2A event count                        | publication-injection and response-bound tests               |
| an Agent Card could redirect operations to another origin                                                     | server-side endpoint pivot                        | require the selected endpoint to share the configured SDAR base origin; keep explicit configuration as the only override    | same-origin adapter contract                                 |
| distinct concurrent Follow-up/cancel requests could both pass idempotency and reach SDAR                      | duplicate Task mutation                           | serialize all mutating Task interactions with the per-chat lease; abandon an unsent idempotency claim when the slot is busy | concurrent Follow-up security test                           |
| a stale observation rejected by PostgreSQL could still be rendered to the user                                | state rollback in the UI                          | render only when the persisted status/hash confirms acceptance                                                              | stale-observation security test                              |
| signed identity accepted any nonempty role                                                                    | authorization ambiguity                           | restrict the signed role to `user` or `admin`                                                                               | JWT adversarial matrix                                       |
| an accepted terminal stream update could be hidden when immediate `getTask()` enrichment was already terminal | lost final status and artifact publication        | preserve accepted stream fragments when monotonic persistence correctly rejects the redundant terminal enrichment           | terminal-enrichment security test and PostgreSQL integration |

## Verification

The pinned local toolchain was Node `22.14.0` and pnpm `11.13.1`.

- `pnpm verify:phase12`: passed.
- Formatting, ESLint, LangGraph JSON, and TypeScript: passed.
- Unit: 31 passed.
- Contract: 26 passed.
- Security: 8 passed.
- PostgreSQL integration: 36 passed against PostgreSQL 16.9.
- Architecture: 42 production files passed.
- Build: passed.

Existing unit, contract, integration, and Phase 11 evidence supplies additional
coverage for service-key rejection, signed identity, isolation, idempotency,
recovery, rate/body/message limits, outage behavior, and allowed A2A operations.
Those inherited tests were not relabeled as newly executed real E2E.

## Remaining risk and environment boundary

Phase 12's database-backed gate was rerun against an isolated PostgreSQL 16.9
container. Docker, Open WebUI, the frozen SDAR runtime, Redis, and real MCP
transport remain Phase 13 final-head gates; they are not claimed by this report.

Remote GitHub Actions passed for exact fix commit `0d05d52`:

- push: <https://github.com/zhouwen-giser/single-agent-chat-server/actions/runs/31391810117>
- pull request: <https://github.com/zhouwen-giser/single-agent-chat-server/actions/runs/31391813711>

## Continuation audit — 2026-08-10

The published feature HEAD `36d9bd8` did not satisfy the Phase 12 or final
quality gate. Both push and pull-request `quality` jobs failed in
`task-coordinator.postgres.int.test.ts` because a persisted terminal stream
update was suppressed when the immediate `getTask()` enrichment observed an
already-terminal binding.

The failure was reproduced against an isolated PostgreSQL 16.9 container:
35/36 integration tests passed and the terminal streaming case failed. The
test-only commit then reproduced the same boundary without PostgreSQL at 7/8
security tests. The fix preserves the accepted terminal stream fragments when
an immediate already-terminal `getTask()` snapshot is rejected as redundant by
monotonic persistence. After the fix, security is 8/8, PostgreSQL integration is
36/36, `pnpm verify:phase12` passes, and both exact-commit CI runs are green.
