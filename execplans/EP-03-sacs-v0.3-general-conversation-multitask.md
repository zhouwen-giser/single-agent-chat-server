# EP-03: SACS v0.3 general conversation and multi-task chat

This ExecPlan is a living document. Update progress, decisions, discoveries,
validation, and outcomes at every P00-P14 boundary.

## Purpose

Upgrade the existing single-SDAR dual-northbound gateway with a configured
real general conversation model, server-authoritative durable conversation
context, multiple active Tasks per Chat, deterministic Task targeting, and a
strict `TASK | MESSAGE` completed-request result.

## Frozen boundaries

- One SACS process constructs and reuses one fixed SDAR A2A client.
- Southbound is A2A 1.0 HTTP+JSON only on the pinned beta SDK; there is no
  registry, mesh, router, request-selected endpoint, SDAR management API, SMPP,
  MCP, Provider, or device access.
- The conversation model has no tools and can only produce text or locally
  validated decisions. Deterministic code owns authorization and execution.
- PostgreSQL owns protocol-neutral conversation, Task binding/focus, request
  result, durable Run, and Interrupt state. SDAR owns Task truth.
- Internal Task state excludes `AUTH_REQUIRED`; the SDK state fails closed as a
  protocol/deployment mismatch. Northbound keys, JWTs, and authorization remain.
- Existing migrations `0001` through `0006` are immutable; upgrades are
  append-only and must preserve v0.2 data.

## Progress

- [x] 2026-08-21: Read and validate all task-package files.
- [x] 2026-08-21: Refresh and lock SACS, SDAR, and SMPP `origin/main` sources.
- [x] 2026-08-21: Complete frozen install and authoritative `verify:ci` baseline.
- [x] 2026-08-21: Create the requested feature branch from exact verified main.
- [x] 2026-08-21: Diagnose exact-head CI's expired open-Interrupt fixture and
      replace only its stale absolute expiry with the established 2099 test date.
- [x] P00: publish evidence, pass exact-head quality/container CI, and open Draft PR #12.
- [x] P01: freeze ADR, contracts, domain types, and architecture gates; pass exact-head CI.
- [ ] P02: implement the configured OpenAI-compatible conversation model.
- [ ] P03-P04: persist and assemble durable bounded conversation context.
- [ ] P05-P07: implement multi-task persistence, resolution, focus, and coordination.
- [ ] P08-P09: implement request-result union and trusted A2A fail-closed behavior.
- [ ] P10-P11: integrate the shared application service with OpenAI and AG-UI.
- [ ] P12: complete security, privacy, observability, and adversarial hardening.
- [ ] P13: qualify real model, current SDAR, migration, restart, and network boundary.
- [ ] P14: close docs, container, CI, full gate, evidence, and Ready PR.

## Implementation sequence

Each phase closes a minimum complete vertical slice, required tests, three
evidence artifacts, reviewed diff, semantic commit, push, Draft PR update, and
exact local/remote comparison before the next phase begins.

## Decisions

- 2026-08-21: Inspect upstream repositories via fetched `origin/main` objects;
  do not switch or clean their user-owned working branches.
- 2026-08-21: Treat the first sandboxed loopback failure as environment-only
  evidence and use the successful unsandboxed rerun as the P00 code baseline.
- 2026-08-21: Do not count the 50 environment-skipped PostgreSQL tests in
  `verify:ci` toward any v0.3 required gate. P03/P05/P08/P13 must run them on a
  real PostgreSQL service with zero required skips.

## Discoveries

- Execution-time main SHAs equal the task package reference SHAs after fresh
  fetch, so no source drift decision is required at P00.
- Current SDAR Agent Card uses HTTP+JSON wire `1.0`, streaming, empty security
  requirements, and no-auth HTTP user builder, matching the trusted isolated
  southbound assumption.
- Existing SACS `verify` intentionally fails before running when P13 real
  environment variables are absent; the v0.3 gate must preserve that fail-closed
  behavior while adding explicit real-model variables.
- Main's last green CI ran one day before a hard-coded Interrupt test expiry.
  Current exact-head PostgreSQL CI correctly treats that row as expired; this is
  a baseline test-data defect, not a v0.3 production regression.

## Validation

P00 authoritative baseline: `pnpm verify:ci` passed unit 78, contract 57,
security 9, fixture E2E 1, architecture/build/smoke/migration/OpenAI/A2A/
workflow/license/secret gates. PostgreSQL tests remained environment-skipped and
are not release evidence.

## Outcomes

In progress. Completion requires all AC-001 through AC-044, zero required skip,
exact-head CI, real-model and current-SDAR evidence, and a Ready unmerged PR.
