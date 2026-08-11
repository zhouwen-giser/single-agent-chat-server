# SACS v0.2 Final Release Report

## Disposition

`READY_FOR_PR`

## Source Locks

- SACS baseline main: `6a159aa87883568c96f7190c211150843a4d8ad4`
- final product candidate: `80ed0bb5532a86feff2e2a374db9d7990301e7a7`
- SDAR exact SHA: `a9957c82c17ca01e77528f3817c03d86224aaf88`
- AG-UI release/SHA: `release/2026-08-07` / `338708ca8b57deda9c82d0329f30944ab4b0dea6`
- AG-UI packages: `@ag-ui/core`, `@ag-ui/encoder`, `@ag-ui/client` 0.0.57
- A2A SDK: `@a2a-js/sdk@1.0.0-beta.0`

## Phase History

P00 established source locks and the non-rewriting branch baseline. P01–P06
froze contracts and introduced the protocol-neutral interaction spine,
persistence, safe queries, authenticated AG-UI, and strict A2A projection.
P07–P09 added phase-specific Interrupt/Resume, durable recovery, and security
hardening. P10 preserved the OpenAI/Open WebUI predecessor. P11–P12 proved the
official AG-UI and both real northbound paths against one SDAR. P13 built the
exact release gates and fixed durable execution-error closure. P14 incorporated
the latest main state and reran every real and release gate.

## Architecture

Open WebUI/OpenAI and official AG-UI are adapters over one typed interaction
event runtime. The thin LangGraph graph classifies conversational intent only.
All SDAR business interaction remains inside the isolated frozen A2A adapter;
there is no mesh, router, registry, management API, SDAR database, ClickHouse,
or MCP access.

## OpenAI / OpenWebUI

The existing OpenAI-compatible API remains backward compatible. A real
pip-installed Open WebUI 0.10.2 instance passed model discovery, ordinary and
utility chat isolation, Task creation, status/history/result, all allowed
Follow-ups, cancellation, retry/disconnect recovery, Capability Gap, and user
isolation under run `p14-80ed0bb-northbound`.

## AG-UI

Authenticated HTTP/SSE capabilities, Run, Interrupt, Resume, idempotency, and
abort/reconnect passed through official `@ag-ui/client@0.0.57`. Only typed
State, Activity, Text, Custom, Interrupt, and Run events are published. RAW A2A
events and inferred internal Tool Calls are absent.

## A2A / SDAR

The live card advertised HTTP+JSON wire 1.0 streaming. SACS explicitly selected
`http://127.0.0.1:9999/a2a`; no silent rewrite occurred. Only
`sendMessageStream`, `sendMessage`, `getTask`, and `cancelTask` are exposed by
the adapter. Existing-Task messages enforce the frozen `sdar_action` allowlist
and strict metadata. `INPUT_REQUIRED` handling remains phase-specific.

## PostgreSQL Migration

Six append-only, checksum-locked migrations preserve the v0.1 schema and add
protocol-neutral principals, threads, requests, Runs, interrupts, events, and
Agent Card snapshots. Native PostgreSQL integration passed 51/51, including
restart, lease/idempotency, durable replay, and failed-Run closure.

## Security

Independent service credentials and a signed HS256 principal profile protect
both northbound protocols. The candidate enforces deny-by-default CORS,
protocol-isolated rate limits, body/state/artifact bounds, safe URL projection,
Task identity monotonicity, redacted logs, and nonauthority of client-authored
state. Adversarial security passed 9/9; the exact product candidate secret scan
covered 414 tracked files and the indexed P14 evidence scan covered 417.

## Real E2E

All five required P14 real gates passed with zero skips. Same-Task consistency
used Task `30ea9744-4e67-4fe1-ac3c-3d27cfe21235`; bounded recovery used Task
`85d12597-b183-44b4-ad7d-5be4466881ac` and only `getTask()` polling after the
bounded stream ended. All retained nonterminal test Tasks were cleaned through
the official adapter.

## Docker / SBOM / Licenses

The production image runs as non-root with a healthcheck. Hardened Compose
proved ready HTTP 200, read-only root, capability drop ALL,
`no-new-privileges`, 12 migrated tables, and cleanup. CycloneDX 1.7 contains
3718 components with SHA-256
`b664fa438fb9bfd5edc8a8718f7f72983abad949fe2094f9f3e579047598a096`.
Production license inventory passed for 89 entries.

## Known Limitations

- The current SDAR A2A endpoint has no authentication and must remain on a
  trusted isolated network.
- SACS intentionally supports one configured SDAR; it is not a mesh, router,
  registry, or capability-discovery service.
- Open WebUI remains an external installation and is not developed here.
- A2A streams are bounded; recovery uses polling, not an event cursor or Task
  resubscription.
- Browser screenshots are not claimed because the Windows in-app browser
  runtime was unavailable. Real installed-service HTTP/SSE evidence is used.
- Merge, tag, GitHub Release, and production deployment require separate user
  control.

## Final PR

[PR #11](https://github.com/zhouwen-giser/single-agent-chat-server/pull/11)
is open and Ready for review from `feature/single-sdar-chat-entry-v0.1` to
`main`. Push and pull-request quality/container checks passed. Codex did not
merge it.

## Merge Proof

AC-21 passed: latest `origin/main` at `6a159aa8...` is an ancestor of the final
candidate. AC-22 remains pending because the user authorized PR submission but
not PR merge. It can be proven only after the protected PR is merged.
