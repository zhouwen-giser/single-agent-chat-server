# SACS v0.4 S04 completion report

## Decision

S04 passes internal production routing, safe world-answer rendering, durable
WSGS request replay, and fail-closed operational grounding preparation. It
uses real PostgreSQL and the production WSGS adapter code, but the WSGS
responses are injected test responses. This is not live WSGS E2E evidence and
does not make the v0.4 stable candidate eligible.

## Production routing and runtime

The production conversation model now emits the strict v0.4 `TurnPlan` first,
while the qualified v0.3 `TurnDecision` remains an explicit compatibility
fallback. Cross-field validation keeps route, grounding requirement, answer
mode, and Task directive consistent in both Zod and the published JSON Schema.

`WORLD_ANSWER` is routed to one shared `WorldGroundingRuntime` constructed by
the server for both OpenAI and AG-UI entry paths. The runtime:

- derives the WSGS operation and requested products through deterministic
  `GroundingRequestPlanner` code;
- claims a durable interaction request and grounding execution before any
  WSGS call, with a stable request timestamp and canonical request hash;
- checks frozen WSGS capabilities and validates strict reference, evidence,
  ambiguity, identity, status, and result-hash subcontracts;
- persists the WSGS result, completes the grounding lifecycle, stores one
  rendered Message, and replays that Message without a second WSGS POST;
- exposes no direct GOWM, Gateway, Provider, MCP, geometry, CRS, H3, spatial
  query, or database bypass.

Requests that declare use of world-focus capsule data currently return
`WORLD_GROUNDING_CONTEXT_UNAVAILABLE`; no empty capsule is silently substituted
for requested context. Busy claims return `WORLD_GROUNDING_IN_PROGRESS`.

## Safe answers and operational boundary

World answers are rendered deterministically from the strict published WSGS
result only. They may include bounded display names, safe summaries, safe
payloads, evidence status, counts, and result hash. They do not invoke a second
answer-model call or expose hidden reasoning. Ambiguity returns an explicit
clarification code and never auto-selects a candidate. `UNRESOLVED`, `NO_DATA`,
empty evidence, partial results, failure, and cancellation never become an
absence conclusion.

The OperationalGroundingBundle builder accepts only completed validation
results, selected unique live references, `VALIDATE_REFERENCES` provenance,
no unresolved mentions or capability gaps, and explicit confirmation for
ambiguous selections. Suggested-unique auto-accept remains false.

Current SDAR still lacks `sacs-sdar-operational-grounding/1.0`. A grounded
`SDAR_TASK` therefore returns exactly
`SDAR_GROUNDING_EXTENSION_UNAVAILABLE` before calling WSGS or SDAR. It does not
drop a Data Part, convert the bundle to text, modify SDAR, or downgrade to an
ordinary ungrounded Task.

## Validation

`pnpm verify:v04:s04` passed cumulatively on an isolated PostgreSQL 16.9
instance:

- S00 source/compatibility contracts: 6/6 PASS;
- S01 authority contracts, including JSON Schema/runtime tuple alignment:
  19/19 PASS;
- S02 deterministic planner and isolated adapter: 12/12 PASS;
- S03 persistence contracts and real PostgreSQL groups: 14/14 PASS;
- S04 world-runtime and application tests: 9/9 PASS, including one real
  PostgreSQL plus production-adapter/injected-fetch integration test;
- cumulative real PostgreSQL integration: 93/93 PASS, zero database skips;
- migration, 80-file architecture, lint, typecheck, and build Gates: PASS.

The complete repository CI baseline also passed 116 unit, 121 contract, 93
real PostgreSQL integration, 12 security, and one deterministic fixture E2E
test. OpenAI predecessor routing, A2A, AG-UI, smoke, workflow, license, secret,
format, and build Gates passed.

The rebuilt `single-agent-chat-server:0.4.0` image passed metadata validation.
Isolated Compose validation reached HTTP readiness 200 with 18 migrated tables,
non-root execution, read-only root, all capabilities dropped,
`no-new-privileges`, and complete temporary-resource cleanup. The verifier now
pins its qualified 2048-token model fixture instead of inheriting a larger host
override, and startup failures expose only bounded Zod issue codes and paths.
The CycloneDX 1.7 SBOM contains 3718 components with SHA-256
`c5c220d0eba1aeb253f1e671999ecefbaeae785981c9810f29a63ce4d154a80c`.

## Non-claims

No live WSGS process was contacted. The PostgreSQL integration uses the actual
adapter and runtime with an injected Fetch response, so it is not real WSGS,
GOWM, or end-to-end external evidence. No typed SDAR grounding Data Part was
constructed or submitted. World-focus capsule assembly and S05 hybrid
plan/reality composition are not implemented by this phase.

WSGS remains `productionQualified=false`; current SDAR still lacks the required
grounding extension. The overall disposition remains
`SACS_V0_4_STABLE_CANDIDATE_BLOCKED`.
