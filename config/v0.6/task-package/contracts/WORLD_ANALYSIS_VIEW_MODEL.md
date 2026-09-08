# Contract — World Analysis View Model

## 1. Canonical outward model

```ts
interface WorldAnalysisViewModel {
  schemaVersion: "sacs-world-analysis-view/1.0";
  analysisId: string;
  revisionId: string;
  runId: string;
  groundingId: string;
  status:
    | "RUNNING"
    | "COMPLETED"
    | "PARTIAL"
    | "WAITING_SELECTION"
    | "UNRESOLVED"
    | "FAILED"
    | "CANCELLED";
  source: {
    kind: "WSGS_GROUNDING_JOB" | "WSGS_NATIVE_ANALYSIS" | "FIXTURE";
    sourceId: string;
    sourceHash: string;
    contractVersion: string;
    resultProfile?: string;
    resultHash?: string;
  };
  summary: {
    title: string;
    primaryText: string;
    qualifiers: string[];
  };
  findings: SacsWorldAnalysisFinding[];
  map: {
    sceneRevision: number;
    layers: MapLayerDescriptor[];
    executionFocus?: FocusTarget;
    interventionFocus?: FocusTarget;
  };
  timeline: {
    analysisTimeWindow?: TimeRange;
    items: WorldAnalysisTimelineItem[];
    sources: WorldAnalysisTimelineSource[];
  };
  choices: WorldAnalysisChoice[];
  actionTargets: HistoricalActionTargetCandidate[];
  evidenceItemIds: string[];
  typedGaps: TypedGapSummary[];
  warnings: string[];
  currentness: "CURRENT" | "STALE" | "UNKNOWN";
}
```

## 2. Determinism

Given the same verified WSGS result, consumer lock and renderer policy, the view model must have the same canonical hash.

Ordering must be deterministic:

```text
findings by upstream order or stable finding ID
layers by semantic role then layer ID
timeline by start/instant then stable ID
choices by upstream-authorized order
evidence IDs lexically deduplicated
warnings/qualifiers stably deduplicated
```

## 3. Size limits

Set and test explicit limits. Recommended upper bounds:

```text
findings: 1,000
map layers: 128
timeline items: 1,000
choices: 100
action targets: 100
evidence IDs: 2,000
warnings: 256
summary text: 8 KiB
view model canonical JSON: 4 MiB
```

Truncation must add a typed gap and a qualifier; silent truncation is forbidden.

## 4. Authority separation

The model distinguishes:

```text
upstream world facts/findings
SACS presentation metadata
user-selected constraints
local UI focus
```

Local map pan/zoom/hover never mutates shared analysis truth.

## 5. Currentness

`currentness` is derived from authoritative WSGS data. SACS cannot change `UNKNOWN` to `CURRENT` because the answer is recent or plausible.
