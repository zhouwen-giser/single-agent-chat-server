# SACS v0.4 S08 genuine WSGS multi-turn gate

## Decision

S08 is `BLOCKED_WSGS_PINNED_VALIDATION_UNAVAILABLE`. The
`SACS_MULTITURN_WORLD_GROUNDING_READY` marker remains withheld.

The authorized runner is locked to WSGS commit
`47c248cf2ee3553287dde97aaecea34ea3fc961a`. Credentials are consumed only
from the authorized process environment and are not present in this report,
runner output, or repository.

## Repaired upstream semantics

The current GOWM 0.6.4 and WSGS instance has proved the previously blocked
reference-validation transition:

- WSGS readiness returned HTTP 200 with `status=ready` and no reasons across a
  full readiness cache interval.
- GOWM reported 12/12 required operations and 36/36 canary PASS.
- `GROUND_REFERENCES` completed with one mention and one reference.
- `VALIDATE_REFERENCES` completed with
  `sourceOperation=VALIDATE_REFERENCES`, `revalidationRequired=false`, and a
  present future `validUntil` at receipt.
- The redacted validation evidence file hash is
  `sha256:3c5638a2eab2fad89a3f4e49e447c22d2f5661a232babf2eef3371f68f2923aa`.

These facts close the earlier typed-stale semantic blocker, but do not by
themselves pass the SACS multi-turn matrix.

## Deadline repair and current redacted live failure

The earlier deadline was traced upstream to a duplicate per-request semantic
model probe. WSGS 47c248c removes that duplicate work and preserves the actual
pipeline stage in deadline errors. The S08 harness now uses an explicit
120000 ms execution policy while the production default remains unchanged.

With that repair, the initial vehicle query completed and its result contract
and request/source identity all passed. The immediate pronoun follow-up then
terminated as follows:

- Operation: `EXECUTE_WORLD_QUERY`.
- Create request: HTTP 202.
- Poll requests: HTTP 200.
- Terminal job status: `FAILED`.
- Result present: false.
- WSGS `error.code`: `PINNED_VALIDATION_OPERATION_UNAVAILABLE`.
- WSGS `error.stage`: `REFERENCE_GROUNDING`.

The follow-up used the persisted `KnownWorldReference`; an independent positive
`VALIDATE_REFERENCES` canary cannot substitute for this pinned-reference path.
AC-M001 therefore remains blocked; AC-M005 and the remaining ordered scenarios
were not reached and are not reported as passed.

## SACS corrections and regression evidence

SACS preserves completed stale and expired references so they can be validated
fail-closed instead of silently disappearing. Focused unit and PostgreSQL
regression tests passed 14/14.

The live failure also exposed a separate error-mapping bug: a contract-valid
terminal `FAILED` job with an error and no result was incorrectly classified as
`WORLD_GROUNDING_CONTRACT_VIOLATION`. SACS now maps that shape through the
published WSGS error boundary and safely returns `WORLD_GROUNDING_FAILED`.
The runtime unit suite passed 8/8; lint and typecheck passed.

The harness records only bounded status, error code/stage, schema issue paths,
field names, counts, booleans, and hashes. It does not print credentials, raw
reference identifiers, or raw upstream business payloads.

## Required upstream resolution

WSGS must support the pinned-reference validation path used by a follow-up
`EXECUTE_WORLD_QUERY` with `KnownWorldReference`. After the instance is
refreshed and readiness is reconfirmed, rerun every S08 scenario from the
beginning.

The SACS verification process did not restart or modify any shared WSGS, GOWM,
GDPS, or database fixture.
