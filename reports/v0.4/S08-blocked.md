# SACS v0.4 S08 genuine WSGS multi-turn gate

## Decision

S08 is `BLOCKED_GOWM_AREA_LAYER_FEATURE_AUTHORITY_VERSION_BINDING`. The
`SACS_MULTITURN_WORLD_GROUNDING_READY` marker remains withheld.

The authorized runner is locked to WSGS commit
`7c7340a602b2c9c7963b1d8dc2ca210bd1baaefa`. Credentials are consumed only
from the authorized process environment and are not present in this report,
runner output, or repository.

## Closed vehicle-reference and replay blockers

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

## Current redacted live blocker

The runner then used the exact AC-M002 task-package sequence:
`A区有哪些车？` then `那里附近还有什么？`. The initial turn persisted an
area reference. The follow-up performed fail-closed validation:

- Operation: `VALIDATE_REFERENCES`.
- Create request: HTTP 202.
- Poll requests: HTTP 200.
- Terminal job and result status: `COMPLETED`.
- Reference product count: 1.
- `sourceOperation`: `VALIDATE_REFERENCES`.
- `revalidationRequired`: true.
- `validUntil`: absent.
- WSGS `error.code` and `error.stage`: absent.
- Persisted SACS Focus status: `STALE`.
- Safe SACS outcome: `WORLD_GROUNDING_CONTEXT_UNAVAILABLE`.

SACS therefore did not supply stale context for the pronoun follow-up. AC-M002
is blocked on a positive area-reference validation lease; later ordered S08
scenarios remain `NOT_REACHED`, not passed.

Upstream isolated the failure to the shared GOWM A区 `LAYER_FEATURE`
authority/version binding. The resolved identity matches the authoritative
handoff object, excluding a same-name parse error. WSGS sends the resolved
pinned version unchanged with `requireCurrentSnapshot=true`; GOWM returns
`STALE` with reason `Pinned data snapshot is stale`. No SACS or WSGS layer
may replace that version with a current/handoff value.

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

Shared GOWM must make the persisted A区 reference validate with
`revalidationRequired=false` and a future `validUntil`, or publish a typed
terminal error explaining why the area reference cannot be validated. After
the authorized instance is refreshed and readiness is reconfirmed, rerun every
S08 scenario from the beginning.

The SACS verification process did not restart or modify any shared WSGS, GOWM,
GDPS, or database fixture.
