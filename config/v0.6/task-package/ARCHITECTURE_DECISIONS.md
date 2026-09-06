# Architecture Decisions

These decisions are normative. Codex may refine implementation details but must not silently reverse them.

## ADR-01 — WSGS is the only world-analysis gateway

SACS never calls GOWM+, GDPS or historical-analysis Providers directly.

## ADR-02 — Grounding Job is the v0.6 production transport

`WSGS_GROUNDING_JOB` is the required default when analysis is enabled. Native Analysis remains a future transport.

## ADR-03 — Native Analysis remains fail-closed

The existing Native five-port interface and eight-artifact verifier are preserved. They are not required for Grounding Job mode and cannot block that mode.

## ADR-04 — Explicit 1.1 negotiation

The geospatial profile is selected only with the exact WSGS headers, an authorized service principal and an authoritative consumer lock. No heuristic negotiation and no silent downgrade for 1.1-required requests.

## ADR-05 — Truthful source identity

Grounding IDs are Grounding IDs. Native Plan IDs are Plan IDs. Fixture IDs are Fixture IDs. Legacy fields are not reused under false names.

## ADR-06 — No fabricated upstream progress

SACS can display its own submission, polling, persistence and rendering stages. It cannot claim unseen WSGS Provider nodes or percentages.

## ADR-07 — One normalization boundary

Raw WSGS results are normalized once into `WorldAnalysisViewModel`. Text, map, timeline and AG-UI layers consume that model.

## ADR-08 — Schema URI and hash are both required

A familiar field shape is not enough. Unknown or drifted schemas produce a typed unsupported gap.

## ADR-09 — Revision means new Grounding in Grounding Job mode

User changes and choices produce a new immutable revision and a new WSGS Grounding request.

## ADR-10 — User choices are authorized inputs, not world facts

Candidate selection does not create a new ReferenceKey or geometry. It passes an authorized choice back to WSGS.

## ADR-11 — Historical action targets are not commands

A historical candidate always requires current validation and route planning and has `executionAuthorized=false`.

## ADR-12 — Polling emits semantic transitions only

Identical GET responses do not create duplicate durable analysis events or unbounded AG-UI deltas.

## ADR-13 — Optional capability absence is isolated

Missing advanced-history, structured-selection or currentness support cannot break ordinary Grounding, SDAR task handling or the whole server readiness.

## ADR-14 — Additive migration and legacy readability

Existing v0.5 rows remain readable. New semantics are added, not retroactively invented.

## ADR-15 — Real integration requires a real WSGS process

Mocks, fixtures, copied payloads and recorded HTTP responses do not satisfy S08 real integration.

## ADR-16 — Upstream repositories are read-only

This Goal does not authorize commits, branches, PRs or configuration changes in WSGS, GOWM+, GDPS, SDAR or Provider repositories.

## ADR-17 — Existing SACS stacks are extended, not duplicated

Use the existing WSGS HTTP adapter, Grounding persistence, Analysis repository, projection reducer and AG-UI v0.3 implementation. Avoid a second parallel subsystem.

## ADR-18 — Release is a separate decision

Development and integration may complete without Docker publication, merge, tag, release or deployment.
