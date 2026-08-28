# EP-04: SACS v0.4 WSGS world grounding and authority fusion

This ExecPlan is a living document. Update progress, decisions, discoveries,
validation, and outcomes at every S00+ boundary.

## Purpose

Integrate SACS with the frozen WSGS northbound grounding contract while keeping
conversation routing and cross-authority composition in SACS, world semantics
in WSGS/GOWM, planning state in SDAR, and control transactions in SMPP/Provider.

## Frozen boundaries

- SACS never calls a GOWM Gateway, Provider, or database and never compiles
  CRS, geometry, H3, or spatial queries.
- The conversation model emits only a bounded TurnPlan. Deterministic code owns
  WSGS operation and product selection; the model never chooses operation,
  Provider, ReferenceKey, or Product ID.
- Transport identity, actor, data scope, dataset scope, and permission data do
  not enter a GroundingRequest body.
- Operational use of world references requires grounding, ambiguity policy,
  validation, an OperationalGroundingBundle, and a typed SDAR A2A Data Part.
- Missing WSGS or SDAR capabilities fail closed. Raw text, silent Data Part
  dropping, text downgrade, suggested-unique auto-acceptance, and stale
  references are prohibited.
- Existing migrations 0001 through 0009 are immutable. New persistence is
  append-only and exactly-once across API, worker, database, model, WSGS, and
  SDAR restart boundaries.

## Progress

- [x] S00: fetch exact SACS, WSGS, and SDAR remote state.
- [x] S00: create `codex/sacs-v0.4-wsgs-world-grounding` from exact SACS main.
- [x] S00: copy and independently verify all 32 frozen WSGS contract hashes.
- [x] S00: prove WSGS 0.2.0 is a blocked candidate and withhold readiness claims.
- [x] S00: prove the required SDAR grounding extension is unavailable and lock
      the fail-closed disposition.
- [x] S00 publication: semantic commits pushed, Draft PR #15 opened, and initial
      exact-head quality/container CI passed.
- [x] S01: freeze bounded TurnPlan, deterministic request-plan ownership,
      validated operational bundle, hybrid authority roles, and architecture
      prohibitions with executable negative tests.
- [x] S01 publication: functional commit `33541ca` pushed to Draft PR #15;
      quality and container CI passed.
- [x] S02: implement the deterministic TurnPlan-to-WSGS planner and the only
      isolated WSGS HTTP adapter with fixed routes, bounded polling, contract
      validation, transport-only auth, and sanitized failure handling.
- [x] S02 publication: functional and evidence commits pushed to Draft PR #15;
      quality and container CI passed.
- [x] S03: add migration 0010, the seven-state append-only grounding lifecycle,
      exactly-once reservation keys, immutable events, and expired-lease
      recovery with real PostgreSQL validation.
- [ ] Later phases: server integration, safe operational bundle path,
      authority-fusion preview, genuine E2E, and final acceptance, subject to
      external prerequisite availability.

## S00 decisions

- Treat WSGS remote candidate `3f9aa7cb8542573d2658a132644a9c649544737b`
  and its tested development commit `75c6d2731094087efd0c203814fcb8fa8b6fefe3`
  as authoritative for internal development. The exact handoff, 63/63 ledger,
  real fourteen-stage pipeline, R1-R6, and recovery evidence are present and
  verified. `productionQualified=false` and the missing task-book Stable
  Candidate markers continue to block final promotion.
- Treat SDAR `b0caf69e9f83bc6702e1c0a85e7ca158c3781d4b` as authoritative.
  Exact-tree search finds no `sacs-sdar-operational-grounding/1.0` declaration,
  so no media type, schema hash, handler, validator, or real E2E is invented.
- Permit later internal work that does not claim final WSGS or SDAR integration.
  `HYBRID_WORLD_TO_SDAR_READY`, `AUTHORITY_FUSION_PREVIEW_READY`, and the v0.4
  stable-candidate marker remain blocked until genuine external evidence exists.
- Keep external publication user-controlled. The user explicitly authorized
  the S00 branch push and Draft PR creation; that authorization does not include
  merge, tag, release, or deploy.

## S00 validation

`pnpm verify:v04:s00` verifies the exact Git refs, the SACS base ancestry,
immutable migration hashes, WSGS version/tree/contract-lock blob, every frozen
artifact digest, WSGS blocked decision, and absence of the SDAR extension.

The repository contract suite independently validates the committed lock shape
and fail-closed disposition without requiring sibling repositories.

## S01 decisions

- Keep the qualified v0.3 runtime path unchanged while introducing strict
  parallel v0.4 contracts. Runtime activation waits for the isolated WSGS
  adapter and deterministic planner.
- Express world-focus usage as five booleans in model output. Reference keys,
  product IDs, WSGS operations, and products never cross the model boundary.
- Define the OperationalGroundingBundle as an internal SACS contract only.
  Because the SDAR extension is unavailable, do not invent a media type or
  claim that SDAR consumes it.
- Freeze hybrid output as a read-only comparison: SDAR owns published plan
  state, WSGS/GOWM owns world state, and SACS owns only bounded composition.

## S01 validation

`pnpm verify:v04:s01` reruns the S00 exact-source Gate, executes 17 positive and
negative contract tests, runs an executable authority-boundary verifier,
checks all 76 production TypeScript files against the architecture rules, and
passes TypeScript typecheck.

Remote CI run `33149718205` passed quality job `98778638464` and container job
`98779103132` for the exact S01 functional commit.

## S02 decisions

- Map semantic grounding requirements to WSGS operations and requested
  products in deterministic code only. `NONE` cannot create a WSGS request.
- Use one configured WSGS origin with no per-request routing override.
  Authentication remains a transport header and is rejected from bodies.
- Treat injected-transport tests as contract evidence, not real WSGS E2E.
  Server construction and durable lifecycle integration remain later work.

## S02 validation

`pnpm verify:v04:s02` cumulatively runs S00 and S01, then executes 12 planner
and adapter tests, checks 78 production files against the architecture Gate,
and passes lint and typecheck.

## S03 decisions

- Add new migration 0010 without changing the byte-frozen 0001 through 0009
  chain. The database, not an in-memory worker, owns the seven-state lifecycle,
  immutable results, transition legality, terminal closure, and event history.
- Bind each grounding to the exact authorized principal, Thread, and
  interaction request. Use unique WSGS request, grounding idempotency, and SDAR
  submission keys for the external side-effect boundaries.
- Replay any request already beyond `GROUNDING_PENDING` instead of reacquiring
  a WSGS lease. Recover only expired pending/reserved leases with row locking
  and `SKIP LOCKED`.
- Treat persistence proof as internal runtime substrate only. Do not claim that
  the server invokes WSGS or that SDAR consumes the unavailable extension.

## S03 validation

Real PostgreSQL 16.9 validation passed 11 static persistence contracts, 3
database lifecycle/recovery groups, and the full 92-test integration suite
with zero database skips. Migration, architecture across 79 production files,
lint, typecheck, and build are included in `pnpm verify:v04:s03`.

## Current outcome

S00 through S03 may pass as truthful internal development phases while the
overall v0.4 stable candidate remains externally blocked. No fixture, WSGS
v0.1 artifact, text downgrade, or unimplemented SDAR extension is accepted as
completion evidence.
