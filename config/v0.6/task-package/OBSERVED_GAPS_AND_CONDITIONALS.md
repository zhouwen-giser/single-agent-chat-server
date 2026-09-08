# Observed WSGS Baseline and Conditional Gaps

This file records observations made when the task package was generated. S00 must re-check every item against the then-current source.

## Observed sources

```text
SACS v0.5 branch:
  codex/sacs-v0.5-observer-first-interactive-analysis
  observed HEAD: 0cce422873f69df1ea7b78f72067dcd48e3c6b51

WSGS main:
  observed HEAD: 565e52705bb7656d4623a04655001325ca61acd0

WSGS geospatial branch:
  codex/wsgs-v0.2.1-sacs-geospatial-handoff
  observed HEAD: 8c78600a8886f13cd9f4f418f9297cf9ecf39c32
```

## Observed authoritative WSGS contract

```text
contractVersion: sacs-wsgs-grounding/1.1
profile: sacs-wsgs-geospatial-findings/1.0
transport: RESULT_EXTENSION
contract directory: contracts/wsgs-v0.2.1-sacs-geospatial
release lock: contract-release-lock.json
```

The contract includes capabilities, grounding-result extension, geospatial findings, world findings, source products, typed gaps, structured selection and source-currentness schemas/examples.

## Observed runtime status

At package generation, WSGS production capability projection advertised:

```text
RESOLVE_WORLD_SELECTION
VALIDATE_SOURCE_CURRENTNESS
```

but marked both unavailable:

```text
IMPLEMENTATION_PENDING_N05
IMPLEMENTATION_PENDING_N06
```

Therefore SACS must implement capability gating and safe unavailability handling. It must not infer those operations are executable merely because they appear in `supportedOperations`.

## Native Analysis

No authoritative WSGS Native Analysis Plan/Event/Revision/Intervention control surface was observed. The existing SACS eight-artifact Native verifier remains valid as a future gate, but it does not block Grounding Job mode.

## Advanced historical findings

The package defines SACS internal models for road association, temporal events, metric ranking and historical action targets. S00/S04 must bind these models only to authoritative WSGS northbound schemas found at execution time.

If those schemas/capabilities remain absent:

```text
SACS registry and safe unsupported behavior → required DEVELOPMENT PASS
real advanced-history E2E → BLOCKED_EXTERNAL with locked evidence
copying Provider contracts into SACS → forbidden
modifying WSGS in this Goal → forbidden
```

## Development handoff caution

A WSGS `sacs-development-handoff-v1.json` was observed, but it identifies the legacy `sacs-wsgs-grounding/1.0` contract and is not a substitute for the 1.1 geospatial release lock. SACS must lock the exact artifacts it actually consumes.
