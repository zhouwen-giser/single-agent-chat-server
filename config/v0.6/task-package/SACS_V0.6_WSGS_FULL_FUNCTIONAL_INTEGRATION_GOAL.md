# SACS v0.6 — WSGS Full Functional Integration Codex Goal

## 1. Goal statement

在不改变 WSGS、GOWM+、GDPS、SDAR 或分析 Provider 仓库的前提下，加强 `single-agent-chat-server`，使其完整接入 WSGS 的真实 Grounding Job 生命周期，并把 WSGS 返回的世界语义与空间分析结果统一投影为：

```text
安全文本回答
Analysis Session / Revision / Run
AG-UI v0.3 State / Activity
地图图层
时间轴
歧义候选与用户选择
多轮继续分析
历史行动目标候选
```

SACS 是交互与呈现层，WSGS 是世界语义理解、查询编译与能力组合层。

## 2. Target architecture

```text
Open WebUI / OpenAI-compatible client / AG-UI client
                         │
                         ▼
              SACS Turn Planner
                         │
             WORLD_ANSWER / GROUNDED
                         │
                         ▼
          World Grounding Coordinator
       ┌─────────────────┴─────────────────┐
       │ Context / Focus / Prior Grounding │
       │ Request idempotency               │
       │ Analysis binding                  │
       └─────────────────┬─────────────────┘
                         │
                         ▼
             AnalysisSourceAdapter
       ┌─────────────────┼─────────────────┐
       │                 │                 │
GROUNDING_JOB          NATIVE           FIXTURE
(required v0.6)       (deferred)        (test/dev)
       │
       ▼
WSGS Grounding API
       │
       ▼
WSGS → GOWM+ / GDPS / Analysis Providers
       │
       ▼
GroundingResult / geospatialFindings / Evidence / Gaps
       │
       ▼
WorldAnalysisViewModel
       │
       ├─ OpenAI text
       ├─ AG-UI v0.3
       ├─ map
       ├─ timeline
       └─ choices / action candidates
```

## 3. Required functional scope

### 3.1 WSGS contract negotiation

SACS must support both:

```text
sacs-wsgs-grounding/1.0
sacs-wsgs-grounding/1.1
```

The 1.1 path is explicit opt-in and must send the exact WSGS negotiation headers. The implementation must verify response headers and payload schemas against an authoritative lock copied or generated from the locked WSGS source. A provisional task-package schema can never authorize the 1.1 path.

### 3.2 Grounding Job as the production analysis transport

The real adapter must use only the WSGS northbound API:

```text
GET  /v1/capabilities
POST /v1/groundings
GET  /v1/groundings/:groundingId
POST /v1/groundings/:groundingId:cancel
```

It must support synchronous `200` results and asynchronous `202` jobs, bounded polling, caller cancellation, exact request/idempotency replay, response-size limits and error normalization.

### 3.3 Observed world grounding lifecycle

Refactor the current synchronous answer path into:

```ts
beginWorldGrounding()
observeWorldGrounding()
completeWorldGrounding()
```

Keep `answerWorld()` as a compatibility wrapper. OpenAI-compatible clients may still receive one final answer; AG-UI v0.3 can observe state transitions.

### 3.4 Analysis identity and persistence

Grounding Job is not a WSGS Native Plan. Revision identity must use a discriminated source record. Existing `wsgs_plan_id` rows require backward-compatible migration, but all new writes must carry truthful source kind/id/hash.

The migration must be additive, contiguous and verified both from an empty database and from the v0.5 schema. Do not destructively reinterpret legacy rows.

### 3.5 Runtime pump and recovery

There must be at most one active polling pump per analysis identity within a process. Repeated identical WSGS snapshots must not generate unbounded duplicate events.

On restart, recover nonterminal Grounding Job analyses from durable state. Stale revisions and stale runs must never overwrite the active projection. Cancellation uncertainty remains `CANCEL_REQUESTED` until a WSGS observation proves a terminal state.

### 3.6 Result consumption

SACS consumes WSGS northbound results only. It must not import or depend directly on Provider implementation packages.

Known result families may be normalized only when their schema URI/hash is authoritative. Unknown payloads are preserved by reference and projected as an unsupported typed gap; they are never guessed.

The internal view model must be capable of representing:

```text
ordinary grounding/reference results
geospatial world findings
historical road association
historical temporal events
historical metric ranking
historical action target candidates
typed gaps, warnings and completeness qualifiers
```

If WSGS does not yet expose an authoritative advanced-history schema or capability, SACS must finish the registry and safe unsupported path, and mark only the corresponding real-integration rows `BLOCKED_EXTERNAL`.

### 3.7 Map, timeline and answer truthfulness

Do not fabricate geometry. A road ID/name without geometry is rendered as text or entry/exit points, not as an invented road line. A bounded trajectory preview must not be connected and labeled as the full trajectory.

Off-network means “not associated with the current reference network”; it does not mean the trajectory is false. Paused periods, data gaps, off-network periods and ambiguity periods are distinct.

Metric ranking must use an actual representative visited position when provided. An H3 center may only be an auxiliary cell visualization, never the device target.

Historical “best” is not current “best.” Action candidates must remain:

```text
currentValidationRequired = true
routePlanningRequired = true
executionAuthorized = false
```

### 3.8 Multi-turn behavior

Required multi-turn flows include:

```text
trajectory → last junction
junction list → last item
top-K metric candidates → rank N
metric-series ambiguity → explicit user selection
change phase scope → new revision / new grounding
change threshold → new revision / new grounding
cancel in-flight grounding
historical candidate → non-executing action candidate
```

Prior Grounding IDs, result hashes and selected product IDs must be passed through the WSGS context contract. SACS must not locally simulate Provider recomputation.

### 3.9 Production wiring

The normal server bootstrap must be able to inject:

```text
GroundingJobAnalysisSourceAdapter
Analysis runtime/coordinator
analysisControl
runAgUiV03
```

`FIXTURE` is forbidden in production. `NATIVE` remains fail-closed unless its authoritative Handoff Bundle is present. Advanced optional capability absence must not make unrelated SACS functionality unhealthy.

## 4. Non-goals

The Goal does not authorize:

```text
WSGS Native Analysis Plan/Event/Revision API implementation
modification of WSGS/GOWM+/GDPS/SDAR/Provider repositories
direct Provider calls from SACS
direct database reads from upstream systems
route planning or device execution
new frontend application
HA/DR/load/SLO release qualification
automatic merge, tag, release or deployment
```

## 5. Required delivery tracks

### DEVELOPMENT

All S00–S07 required acceptance rows, scoped unit/contract/PostgreSQL/local E2E tests, migration checks and architecture checks.

### REAL_WSGS_INTEGRATION

S08 evidence from real source-built or approved deployed WSGS. Fixture, mock server, recorded response and copied JSON cannot satisfy real-integration rows.

Capability-dependent advanced cases may be `BLOCKED_EXTERNAL` only when the locked WSGS capability response and source contract prove they are unavailable.

### RELEASE

S09 is separate. Do not run deployment or merge operations unless explicitly requested.

## 6. Reporting rules

Maintain exactly one active v0.6 report directory:

```text
reports/v0.6/wsgs-full-functional-integration/
```

Recommended active files:

```text
SOURCE_LOCK.json
PROGRESSIVE_STATUS.json
ACCEPTANCE_LEDGER.json
DEVELOPMENT_VERIFICATION.json
INTEGRATION_EVIDENCE.json
FINAL_REPORT.md
```

Historical reports are not rewritten. Every PASS must identify a command, exit code, source SHA and bounded evidence. `BLOCKED_EXTERNAL` must identify the external capability or contract that is absent. `NOT_RUN` must remain distinct from failure.

## 7. Final completion rules

`SACS_WSGS_FULL_FUNCTIONAL_INTEGRATION_DEV_READY` requires all DEVELOPMENT rows PASS.

`SACS_WSGS_GROUNDING_JOB_REAL_INTEGRATION_READY` requires all unconditional integration rows PASS and every conditional row either PASS or valid `BLOCKED_EXTERNAL`.

`SACS_V06_GOAL_COMPLETE` requires both markers above, no unresolved Critical/Major defect in scope, and a clean source-bound evidence set.

Always state:

```text
SACS_WSGS_NATIVE_ANALYSIS_CONTROL_DEFERRED
```

until WSGS itself publishes and SACS verifies the Native Analysis contract.
