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
- [ ] Later phases: internal contracts, adapter, TurnPlan/planner, persistence,
      safe operational bundle path, authority-fusion preview, genuine E2E, and
      final acceptance, subject to external prerequisite availability.

## S00 decisions

- Treat WSGS remote candidate `7ba29dc720bd67cf31915148dd657ff10b9a81ad`
  as authoritative. Its 0.2.0 version and frozen northbound contract pass, but
  its stable-candidate report records 195 PASS, 17 NOT_RUN, and 67 BLOCKED and
  withholds all required readiness/completion markers except the GOWM
  contract-lock milestone. Its separate `DEVELOPMENT_READY` manifest is not
  accepted because 7 referenced evidence artifacts are absent from the tree.
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

## Current outcome

S00 may pass as a truthful bootstrap phase while the overall v0.4 stable
candidate remains externally blocked. No fixture, WSGS v0.1 artifact, text
downgrade, or unimplemented SDAR extension is accepted as completion evidence.
