# SACS v0.4 S09 Task observation and requirement compiler

## Decision

S09 passes all AC-T001 through AC-T013 requirements. The task package defines
no standalone S09 marker; the Authority Fusion marker remains reserved for
S11.

## Official SDAR observation

The official HTTP+JSON A2A adapter now explicitly projects
`Task.metadata.publishedStructuredPlan` into bounded `NormalizedTask`
state. `SdarTaskObservationAssembler` accepts that normalized read model and
preserves the official task ID, context ID, state, internal phase, phase
message, status timestamp, and published structured plan.

The observation path exposes no submit, Follow-up, or cancellation operation.
It does not construct a second SDAR state machine. The reachable official
adapter cancellation spelling remains `CANCELED`; SACS does not invent a
`CANCELLED` wire state to match prose labels.

## Deterministic requirement compilation

`PlanRealityRequirementCompiler` emits bounded, deterministic
`EXTERNAL_TASK` and `OPERATION_CORRELATION` hints from the published SDAR
task/context identity. It emits an external predicate only when
`publishedStructuredPlan.predicates` already contains a capsule accepted by
the frozen WSGS schema.

Free-text phase or plan messages produce `NOT_COMPARABLE` with no predicate.
Malformed structured input also fails closed to `NOT_COMPARABLE`. The
compiler has no dependency on the conversation model and never asks an LLM to
turn text into a hard world predicate.

`taskSnapshotHash` covers the published task state, phase, correlation, and
structured plan, while excluding the local observation clock. Re-observing an
unchanged Task therefore preserves replay identity.

## Contracts and validation

The two task-package schemas are preserved byte-for-byte:

- SDAR Task Observation v2:
  `sha256:613546f6ff6a1e24e8789f07cbd6fe49ee596db21fa1ca495b50c7c1868fe8df`.
- Plan Reality Requirements:
  `sha256:bd6c5193a9d087190aab1eb88d3477c78da1830f81df0bd72cf8f7a985050ba9`.

S09 tests passed 23/23, including official adapter projection, all required
Task lifecycle states, structured/free-text/malformed plans, deterministic
snapshot hashing, JSON Schema compilation, and frozen WSGS capsule parsing.
Architecture, format, lint, typecheck, and build passed.

## Publication boundary

The local semantic phase commit is permitted by the repository workflow.
Push and Draft PR #15 updates remain withheld until direct user authorization;
no merge, tag, release, or deployment is performed.
