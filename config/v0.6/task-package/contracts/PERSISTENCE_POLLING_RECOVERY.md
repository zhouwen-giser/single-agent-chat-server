# Contract — Persistence, Polling and Recovery

## 1. Migration strategy

Discover the latest contiguous migration number at S00 and append the next number. Do not assume a fixed filename.

The migration must add truthful source semantics to `analysis_revision` or a normalized child table:

```text
source_kind
source_id
source_hash
source_revision nullable
upstream_run_id nullable
```

Allowed persisted kinds:

```text
WSGS_GROUNDING_JOB
WSGS_NATIVE_ANALYSIS
FIXTURE
LEGACY_PLAN
```

Existing v0.5 rows are backfilled as `LEGACY_PLAN`. New insert paths reject `LEGACY_PLAN`.

Legacy `wsgs_plan_id` and `plan_hash` columns remain readable during v0.6. They may be nullable for new Grounding Job rows only after upgrade tests prove all code paths use the new identity.

## 2. Grounding binding

One analysis revision binds to exactly one source identity. One Grounding ID cannot be rebound to a different principal/thread or different canonical request hash.

Required uniqueness is logically equivalent to:

```text
(analysis_id, revision_id) unique source identity
(source_kind, source_id) unique within authorized scope
```

Do not create a global cross-principal information oracle through uniqueness errors.

## 3. Polling lease

A durable or process-safe claim prevents duplicate active pumps. At minimum record:

```text
analysisId
revisionId
runId
leaseOwner
leaseExpiresAt
lastObservedSourceStatus
lastObservedResultHash
lastPolledAt
consecutiveFailureCount
```

A process restart may reclaim expired leases.

## 4. Event deduplication

Create a new analysis event only when one of these changes:

```text
source status
result hash
terminality
intervention/choice state
active revision/run
meaningful progress message code
```

Identical polls update operational telemetry but not append-only business events.

## 5. Monotonicity

Forbidden transitions include:

```text
COMPLETED → RUNNING
FAILED → ACCEPTED
CANCELLED → RUNNING
active revision N+1 overwritten by revision N
terminal run reopened in place
```

A retry after terminal failure is a new Run or new Revision according to the deterministic retry policy.

## 6. Crash windows

### Start

1. Persist or recover the canonical Grounding request claim.
2. Call WSGS with the stable idempotency key.
3. Persist Grounding ID/Job ID.
4. Bind the Analysis revision.
5. Start/ensure the pump.

If the process stops after step 2, replay the same request and idempotency key; do not issue a new semantic request.

### Cancel

Persist `CANCEL_REQUESTED` before or in the same local transaction that records the outgoing intent. After calling WSGS, poll authoritative source state. Transport failure does not equal cancellation failure or success.

### Revision

Persist the new immutable revision intent and canonical request. The old revision remains active until the switch rule is met. Never let the new revision partially overwrite the old active projection.

## 7. Recovery scan

On startup recover:

```text
STARTING
RUNNING
CANCEL_REQUESTED
```

`WAITING_INTERVENTION` needs no poll unless WSGS source is not terminal. Terminal rows need no pump.

## 8. Scope

Every repository read/write requires:

```text
analysisId
principalId
threadId
```

External user IDs must first resolve to the internal principal. A valid analysis ID under a different scope returns the same safe not-found result as an unknown ID.

## 9. Data limits

Enforce bounded sizes before persistence:

```text
source request
source result summary
map projection
timeline projection
choice set
warnings/unknowns
activity state
```

Do not duplicate the complete WSGS result when the Grounding repository already stores it. Store references, hashes and bounded projections.

## 10. PostgreSQL tests

Required:

```text
empty database migration
upgrade from v0.5 schema
legacy row read
new Grounding Job row write
LEGACY_PLAN new write rejection
scope isolation
lease reclaim
event deduplication
stale-run isolation
cancel recovery
revision activation atomicity
```
