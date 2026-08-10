# EP-02: SACS v0.2 single-SDAR interaction gateway

This ExecPlan is a living document. Update progress, decisions, discoveries,
and outcomes at every phase boundary.

## Purpose

Extend the existing single-SDAR OpenAI-compatible service with an official
AG-UI HTTP/SSE northbound protocol while keeping one protocol-neutral
interaction core and the existing isolated A2A 1.0 adapter.

```text
Open WebUI / OpenAI client     official AG-UI client
             \                 /
              SdarInteractionEvent
                       |
             existing A2A adapter
                       |
                  one SDAR
```

## Frozen boundaries

- Exactly one configured SDAR; no mesh, registry, router, discovery service,
  management API, SDAR database, ClickHouse, MCP, or node-control proxy.
- A2A specification patch `1.0.1`, wire `1.0`, HTTP+JSON, and exactly
  `@a2a-js/sdk@1.0.0-beta.0` behind `packages/sdar-a2a-adapter`.
- Only `sendMessageStream`, `sendMessage`, `getTask`, and `cancelTask` interact
  with SDAR.
- AG-UI source lock: release `release/2026-08-07`, commit
  `338708ca8b57deda9c82d0329f30944ab4b0dea6`, packages `0.0.57`.
- `@ag-ui/a2a@0.0.6` is reference-only because it uses A2A SDK `^0.2.2`.
- A2A streams are bounded. A nonterminal boundary uses `getTask()` polling;
  there is no event cursor or arbitrary task resubscription.

## Progress

- [x] 2026-08-10: Read and validate all 63 task-package artifacts.
- [x] 2026-08-10: Execute the mandatory waiting gate once; it waited because
      the authorized task package itself made the tree dirty.
- [x] 2026-08-10: Record the user's override to retain the current branch and
      finish with a pull request to `main`, without automatic merge.
- [x] 2026-08-10: Verify PR #1 is merged as `6a159aa`, connect the retained
      branch to that squash merge with non-rewriting merge commit `0a3cace`, and
      prove the v0.1 product tree is identical.
- [x] 2026-08-10: Lock current SACS, SDAR, and AG-UI sources.
- [x] 2026-08-10: Re-run the v0.1 hermetic and PostgreSQL baseline: unit 31,
      contract 26, security 8, integration 36, architecture, and build pass.
- [ ] P01: freeze dual-protocol contracts and ADRs.
- [ ] P02: implement the typed interaction event spine and OpenAI renderer.
- [ ] P03: add protocol-neutral persistence and migrations.
- [ ] P04: implement authorized, non-mutating query services.
- [ ] P05-P09: implement AG-UI SSE, mapping, interrupts, recovery, and security.
- [ ] P10-P12: run compatibility, persistence, official-client, and real E2E.
- [ ] P13: produce the release candidate evidence set.
- [ ] P14: merge latest `main`, run final gates, and open/update the PR. Do not
      merge it; the user's explicit authorization stops at PR delivery.

## Implementation sequence

Every phase closes implementation, tests, reports, a semantic commit, push,
and exact local/remote-head comparison. Required failures remain under
`reports/v0.2/failed-attempts/`; no skipped or mock-only result is relabeled.

1. Freeze types, wire profile, mappings, and architecture boundaries.
2. Introduce a typed, sequenced, deduplicated public interaction event stream.
3. Add append-only persistence for principals, threads, requests, runs,
   interrupts, and Agent Card snapshots without resetting v0.1 data.
4. Add authorized queries that cannot create or mutate SDAR tasks.
5. Serve authenticated AG-UI HTTP/SSE and capability discovery.
6. Render the public event spine into exact official AG-UI events; no RAW and
   no synthetic tool calls.
7. Implement durable, phase-specific Interrupt/Resume mappings.
8. Recover bounded observations via authorized `getTask()` and local durable
   state only.
9. Harden identity, CORS, rate limits, payload bounds, redaction, and audit.
10. Re-run OpenAI/Open WebUI regression and protocol/persistence matrices.
11. Run the official AG-UI client through a real SDAR vertical slice.
12. Run both northbound paths against one fixed SDAR and publish evidence.
13. Close all 22 acceptance cases and supply-chain gates.
14. Update from latest main, rerun exact-head gates, and create the PR.

## Decisions

- 2026-08-10: User authorization supersedes only the task package's branch,
  waiting, and automatic-merge mechanics. Product, protocol, test, evidence,
  phase-commit, push, and no-release constraints remain binding.
- 2026-08-10: Preserve the current published history. Do not rebase, amend,
  force-push, reset, stash, or discard operator changes.
- 2026-08-10: Treat AG-UI A2A integration as design reference only; SACS owns
  its stricter A2A-to-interaction mapping on the frozen beta.0 SDK adapter.

## Discoveries

- PR #1 was squash-merged and its remote feature branch deleted. The merge
  result and the retained branch had identical product trees but unrelated
  commit ancestry, so a normal non-ff merge safely connected them.
- A full AG-UI checkout reached the exact tag object but failed on Windows long
  filenames. A sparse detached checkout at the same SHA supplied the required
  packages and interrupt/A2A references.
- The v0.1 PostgreSQL tests intentionally assert the isolated database name;
  using another disposable name fails closed before persistence behavior.

## Validation

Phase-specific scripts are added as implementation progresses. Final validation
must include both real vertical slices, fresh and upgrade migrations, restart,
OpenAI compatibility, official AG-UI client behavior, Docker, CI, licenses,
SBOM, and exact-head publication evidence.
