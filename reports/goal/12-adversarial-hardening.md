# Phase 12 — adversarial hardening

## Status

`COMPLETED_LOCAL` at functional commit
`a93e953eebe1f342667a8e7005fc55c9ff3b2759`. The work is committed only on
`work/local-phase12-phase13-handoff`; it has not been pushed and no remote check
has run for it.

## Boundary result

The production service remains a thin entrance for one configured SDAR. The
repeatable architecture gate rejects direct database access outside persistence,
network access outside the A2A adapter, management/MCP routes, dynamic SDAR/MCP
environment access, and production dependencies associated with MCP, mesh,
registry, capability discovery, CopilotKit, AG-UI, or ClickHouse.

## Actionable findings and fixes

| Finding                                                                                               | Risk                                              | Minimal fix                                                                                                                 | Regression evidence                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A2A payloads were normalized without aggregate, collection, timestamp, URL, or JSON-complexity bounds | resource exhaustion and ambiguous malformed state | validate roles, IDs, identity links, RFC 3339 timestamps, URLs, collection counts, JSON depth/nodes, and serialized sizes   | `adversarial.security.test.ts`, adapter contract |
| A stream could change Task/context identity after its first event                                     | cross-task state corruption                       | fail closed on every event whose identity differs from the persisted binding                                                | stream identity-drift security test              |
| published text/JSON could retain active Markdown/HTML and response aggregation was unbounded          | UI injection, secret publication, memory growth   | redact secrets, encode HTML, escape Markdown, bound JSON, fragments, characters, and A2A event count                        | publication-injection and response-bound tests   |
| an Agent Card could redirect operations to another origin                                             | server-side endpoint pivot                        | require the selected endpoint to share the configured SDAR base origin; keep explicit configuration as the only override    | same-origin adapter contract                     |
| distinct concurrent Follow-up/cancel requests could both pass idempotency and reach SDAR              | duplicate Task mutation                           | serialize all mutating Task interactions with the per-chat lease; abandon an unsent idempotency claim when the slot is busy | concurrent Follow-up security test               |
| a stale observation rejected by PostgreSQL could still be rendered to the user                        | state rollback in the UI                          | render only when the persisted status/hash confirms acceptance                                                              | stale-observation security test                  |
| signed identity accepted any nonempty role                                                            | authorization ambiguity                           | restrict the signed role to `user` or `admin`                                                                               | JWT adversarial matrix                           |

## Verification

The pinned local toolchain was Node `22.14.0` and pnpm `11.13.1`.

- `pnpm verify:phase12`: passed.
- Formatting, ESLint, LangGraph JSON, and TypeScript: passed.
- Unit: 31 passed.
- Contract: 26 passed.
- Security: 7 passed.
- Architecture: 42 production files passed.
- Build: passed.

Existing unit, contract, integration, and Phase 11 evidence supplies additional
coverage for service-key rejection, signed identity, isolation, idempotency,
recovery, rate/body/message limits, outage behavior, and allowed A2A operations.
Those inherited tests were not relabeled as newly executed real E2E.

## Remaining risk and environment boundary

Native PostgreSQL, Docker, Open WebUI, SDAR, Redis, and MCP transport are absent
from this workspace. Therefore database-backed integration cases and the final
real Open WebUI-to-SDAR slice must be rerun at the final local HEAD before an
unblocked release claim. A PGlite wire probe was diagnostic only and is not
accepted as PostgreSQL evidence.

Remote GitHub Actions: NOT RUN FOR LOCAL HEAD
