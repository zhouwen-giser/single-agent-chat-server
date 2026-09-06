# Design Baseline

## 1. Existing baseline to preserve

The v0.5 branch already contains:

```text
Analysis contracts
Analysis Session / Revision / Run / Event / Projection
principal/thread-scoped PostgreSQL repository
event pump and projection reducer
Observer-first policy
AG-UI v0.3 contracts and headless client
map focus and timeline state
proposal/cancel/intervention coordination
fixture WSGS analysis adapter
local PostgreSQL/HTTP/AG-UI development E2E
```

Codex must extend this implementation. It must not rebuild a second parallel analysis stack.

The existing ordinary `WorldGroundingRuntime`, WSGS HTTP adapter, World Focus and Authority Fusion path must remain compatible.

## 2. Core runtime split

```ts
interface WorldGroundingExecution {
  beginWorldGrounding(
    turn: WorldGroundingRuntimeTurn
  ): Promise<WorldGroundingHandle>;

  observeWorldGrounding(
    handle: WorldGroundingHandle
  ): AsyncIterable<WorldGroundingUpdate>;

  completeWorldGrounding(
    handle: WorldGroundingHandle
  ): Promise<WsgsGroundingResult>;
}
```

`answerWorld()` remains a wrapper over these operations.

## 3. Analysis source abstraction

```ts
type AnalysisSourceMode =
  | "WSGS_GROUNDING_JOB"
  | "WSGS_NATIVE_ANALYSIS"
  | "FIXTURE"
  | "LEGACY_PLAN";

interface AnalysisSourceHandle {
  sourceMode: Exclude<AnalysisSourceMode, "LEGACY_PLAN">;
  sourceId: string;
  sourceHash: string;
  sourceRevision?: number;
  groundingId?: string;
  upstreamRunId?: string;
}

interface AnalysisSourceAdapter {
  readonly mode: Exclude<AnalysisSourceMode, "LEGACY_PLAN">;

  start(request: StartWorldAnalysisRequest): Promise<AnalysisSourceHandle>;

  get(handle: AnalysisSourceHandle): Promise<AnalysisSourceSnapshot>;

  observe(
    handle: AnalysisSourceHandle,
    cursor?: AnalysisSourceCursor
  ): AsyncIterable<AnalysisSourceEvent>;

  cancel(
    handle: AnalysisSourceHandle,
    request: AnalysisCancelRequest
  ): Promise<AnalysisSourceSnapshot>;

  revise(
    request: ReviseWorldAnalysisRequest
  ): Promise<AnalysisSourceHandle>;

  resolveChoice(
    request: ResolveWorldAnalysisChoiceRequest
  ): Promise<AnalysisSourceHandle>;
}
```

`LEGACY_PLAN` is read-only compatibility. It is never a selectable adapter mode and never used for a new row.

## 4. Grounding Job observation

WSGS currently exposes polling, not a native analysis event stream. The Grounding Job adapter therefore emits SACS-owned observation events only when a truthful semantic change occurs:

```text
SOURCE_ACCEPTED
SOURCE_RUNNING
SOURCE_COMPLETED
SOURCE_PARTIAL
SOURCE_AMBIGUOUS
SOURCE_UNRESOLVED
SOURCE_FAILED
SOURCE_CANCELLED
```

Each event records the WSGS Grounding ID, optional Job ID, result hash, observed source status and observation time. It does not claim an upstream event sequence unless WSGS actually publishes one.

## 5. Status mapping

| WSGS | SACS Run | Session | Interaction |
|---|---|---|---|
| `ACCEPTED` | `STARTING` | `ACTIVE` | submitted |
| `RUNNING` | `RUNNING` | `ACTIVE` | analyzing |
| `COMPLETED` | `SUCCEEDED` | `COMPLETED` | final result |
| `PARTIAL` | `PARTIAL` | `COMPLETED` | final result with limits |
| `AMBIGUOUS` | `WAITING_INTERVENTION` | `ACTIVE` | explicit choice |
| `UNRESOLVED` | `PARTIAL` | `ACTIVE` or `COMPLETED` by deterministic rule | add context or stop |
| `FAILED` | `FAILED` | `COMPLETED` | safe error |
| `CANCELLED` | `CANCELLED` | `CANCELLED` | stopped |

The mapping must be centralized and tested.

## 6. Source identity migration

The existing `wsgs_plan_id`/`plan_hash` shape is not truthful for Grounding Jobs.

Use an additive migration that introduces source-kind, source-id, source-hash and optional source-revision semantics. Preserve legacy columns until all existing code and rows can be read safely. Existing rows are backfilled as `LEGACY_PLAN`; new rows cannot use that kind.

Do not rename or drop columns in the same phase unless a real v0.5 upgrade test proves the change safe.

## 7. WSGS 1.1 negotiation

The client must negotiate 1.1 only when an authoritative lock is READY. Every 1.1 request carries the exact header pair and validates the exact response header pair.

A service principal not authorized by WSGS, a duplicate/ambiguous header, schema hash drift or missing profile is fail-closed. The adapter may fall back to 1.0 only when configuration explicitly permits it; it must not silently downgrade a request that requires 1.1 findings.

## 8. Result registry

```ts
interface WsgsResultSchemaBinding {
  schemaUri: string;
  schemaHash: string;
  findingKind: string;
  parse(value: unknown): unknown;
}
```

The registry is constructed from checked-in authoritative consumer locks. Parsing is selected by both URI and hash.

Unknown or mismatched payload:

```text
status = unsupported
typed gap = UNSUPPORTED_FINDING_SCHEMA
no inferred geometry
no inferred world identity
no invented facts
```

## 9. Unified presentation model

```ts
interface WorldAnalysisViewModel {
  analysisId: string;
  groundingId: string;
  status:
    | "RUNNING"
    | "COMPLETED"
    | "PARTIAL"
    | "WAITING_SELECTION"
    | "UNRESOLVED"
    | "FAILED"
    | "CANCELLED";

  summary: {
    title: string;
    primaryText: string;
    qualifiers: string[];
  };

  findings: SacsWorldAnalysisFinding[];
  mapLayers: MapLayerDescriptor[];
  timeline: WorldAnalysisTimeline;
  choices: WorldAnalysisChoice[];
  actionTargets: HistoricalActionTargetCandidate[];
  evidenceItemIds: string[];
  warnings: string[];
}
```

All outward projections consume this model. They do not independently reinterpret raw WSGS payloads.

## 10. Revision behavior

A Grounding Job revision is a new immutable semantic request:

```text
parent revision
  → user change/choice
  → new WSGS request
  → new groundingId/jobId
  → new run
```

It is not a patch to WSGS internal execution state.

## 11. Recovery

- Use the existing grounding lifecycle and idempotency storage.
- Replaying the same start must use the same WSGS idempotency key and canonical request.
- Polling resumes from durable Grounding ID after process restart.
- Only the active revision/run can update the active projection.
- Repeated identical source states are deduplicated.
- Cancellation transport ambiguity keeps `CANCEL_REQUESTED` and continues observation.
- Terminal states are monotonic.

## 12. Compatibility

Must preserve:

```text
OpenAI-compatible text flow
AG-UI v0.2
existing v0.3 analysis fixture flow
SDAR task routes
World Focus
Authority Fusion
existing PostgreSQL data
```
