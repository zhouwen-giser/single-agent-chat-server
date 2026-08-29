# SACS v0.4 S08 genuine WSGS multi-turn gate

## Decision

S08 is `BLOCKED_WSGS_PENDING_CHOICE_RESUME_PERSISTENCE`. The
`SACS_MULTITURN_WORLD_GROUNDING_READY` marker remains withheld.

The authorized runner is locked to WSGS commit
`7c7340a602b2c9c7963b1d8dc2ca210bd1baaefa`. Credentials are consumed only
from the authorized process environment and are not present in this report,
runner output, or repository.

## Closed vehicle, area, and replay blockers

The WSGS EXECUTE path now merges resolver output with supplied
`KnownWorldReference` values before reference validation. With the exact task
package sequence `2号车在哪里？` then `它现在呢？`, the initial grounding
persisted one reference and the follow-up passed AC-M001 with
`knownWorldReferences=true` and `priorGrounding=false`.

That context policy follows the package's authoritative example. A
`priorGrounding` is an independent pinned replay source and is not required by
AC-M001 or AC-M005.

The same live run exposed and closed a SACS replay defect. The outer idempotency
hash included mutable Focus context, so the first result's Focus revision made
an identical turn appear new. Focus context is now excluded from turn identity
while the persisted WSGS request hash still covers the actual context capsule.
The exact replay no longer sends a duplicate WSGS POST, passing AC-M010.

The repaired shared GOWM area `LAYER_FEATURE` authority/version binding was
then exercised by SACS from a new isolated database. The exact sequence
`A区有哪些车？` then `那里附近还有什么？` completed validation and produced
a safe no-error `PARTIAL` follow-up using one validated area reference.
AC-M002 now passes from SACS's own real chain.

## Current redacted live blocker

The runner next executed the exact AC-M003 sequence:
`滨河路附近有哪些设备？` → `AMBIGUOUS` → `第二个` → validate → resume.
The initial result created a durable open choice with two candidates. SACS
deterministically selected the second candidate and preserved the origin
message and source text for both continuation requests.

- Operations emitted: `VALIDATE_REFERENCES`, then `EXECUTE_WORLD_QUERY`.
- Resume create request: HTTP 202.
- Resume poll requests: HTTP 200.
- Resume terminal status: `FAILED`.
- Result present: false.
- WSGS `error.code`: `WORKER_PIPELINE_FAILED`.
- WSGS `error.stage`: `PERSISTENCE`.
- Safe SACS outcome: `WORLD_GROUNDING_FAILED`.

AC-M003 is blocked at the WSGS resume EXECUTE persistence stage. Later ordered
S08 scenarios remain `NOT_REACHED`, not passed.

## Regression evidence

- S08 harness contract: 3/3 PASS.
- World-grounding runtime regression: 8/8 PASS.
- Focused reference/unit/PostgreSQL regression: 14/14 PASS.
- Lint: PASS with zero warnings.
- Typecheck: PASS.
- Real WSGS readiness: HTTP 200, `status=ready`, reasons empty.
- Isolated disposable PostgreSQL: accepting connections.

The harness records only bounded status, error code/stage, schema issue paths,
field names, counts, booleans, and hashes. It does not print credentials, raw
reference identifiers, or raw upstream business payloads.

## Required upstream resolution

WSGS must complete the PendingChoice resume `EXECUTE_WORLD_QUERY` after the
selected reference validates. After the authorized instance is refreshed and
readiness is reconfirmed, rerun every S08 scenario from the beginning.

The SACS verification process did not restart or modify any shared WSGS, GOWM,
GDPS, or database fixture.
