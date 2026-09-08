# Contract — API, Configuration, Readiness and Telemetry

## 1. Configuration

Add bounded, documented configuration equivalent to:

```text
SACS_WSGS_ANALYSIS_ENABLED=false
SACS_WSGS_ANALYSIS_TRANSPORT=GROUNDING_JOB
SACS_WSGS_ANALYSIS_CONTRACT_VERSION=sacs-wsgs-grounding/1.1
SACS_WSGS_ANALYSIS_RESULT_PROFILE=sacs-wsgs-geospatial-findings/1.0
SACS_WSGS_ANALYSIS_POLL_INTERVAL_MS=250
SACS_WSGS_ANALYSIS_MAX_WAIT_MS=120000
SACS_WSGS_ANALYSIS_MAX_CONSECUTIVE_POLL_FAILURES=8
SACS_WSGS_ANALYSIS_MAX_MAP_LAYERS=128
SACS_WSGS_ANALYSIS_MAX_TIMELINE_ITEMS=1000
SACS_WSGS_ANALYSIS_MAX_RESULT_CANDIDATES=100
SACS_WSGS_ANALYSIS_MAX_SAFE_PAYLOAD_BYTES=262144
SACS_WSGS_ANALYSIS_ALLOW_LEGACY_1_0=true
```

Exact names may be refined, but semantics and bounded validation are required.

## 2. Transport selection

```text
GROUNDING_JOB
NATIVE
FIXTURE
```

- `GROUNDING_JOB`: production-eligible with verified WSGS Grounding contract.
- `NATIVE`: production-eligible only with authoritative Native Handoff.
- `FIXTURE`: test/development only.
- Unknown or contradictory settings fail startup safely.

## 3. API

Preserve existing analysis routes and add only what is necessary. Recommended read/control surface:

```text
GET  /api/v1/analyses/:analysisId
GET  /api/v1/analyses/:analysisId/snapshot
POST /api/v1/analyses/:analysisId/proposals
POST /api/v1/analyses/:analysisId/cancel
POST /api/v1/analyses/:analysisId/interventions/:interventionId:resolve
GET  /api/v1/analysis-capabilities
```

Analysis creation may remain driven by AG-UI/OpenAI world turns; do not add a duplicate public creation API without a clear need.

## 4. Readiness

Base server readiness must remain independent of optional advanced-history capabilities.

Expose a bounded analysis readiness/capability projection including:

```text
enabled
transport
grounding contract ready
result profile ready
optional capabilities
native analysis ready/deferred
last successful capability check time
safe reason codes
```

Never expose endpoints, tokens, internal stack traces or upstream response bodies.

## 5. Telemetry

Record aggregate counters/timers:

```text
analysis starts
source status transitions
poll attempts
poll deduplications
poll failures
terminal outcomes
cancellations
revisions
interventions
schema unsupported/drift
snapshot recoveries
map/timeline truncations
```

Labels must be bounded; no user text, geometry, tokens, raw payload or high-cardinality IDs.

## 6. Logging

Structured logs include safe request/run correlation and reason codes. Redact:

```text
authorization
cookies
request/response bodies
user source text
safePayload
geometry
tokens
database URLs
stack traces in public responses
```

## 7. Rate limits

Analysis control endpoints use existing authenticated principal rate limits. Polling is internal and separately bounded; one user must not create unbounded pumps.
