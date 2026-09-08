# Contract — WSGS Result Consumer and Advanced Findings

## 1. Northbound-only rule

SACS consumes WSGS Grounding Result, geospatial findings, evidence items and typed gaps. It does not import Provider runtime packages or parse Provider-private contracts directly.

## 2. Registry

```ts
interface WsgsResultSchemaBinding<T> {
  readonly schemaUri: string;
  readonly schemaHash: string;
  readonly findingKind:
    | "WORLD_FINDING"
    | "HISTORICAL_ROAD_ASSOCIATION"
    | "HISTORICAL_TEMPORAL_EVENT"
    | "HISTORICAL_METRIC_RANKING"
    | "HISTORICAL_ACTION_TARGET_CANDIDATE";
  parse(value: unknown): T;
  normalize(value: T): SacsWorldAnalysisFinding;
}
```

Registry entries are loaded from checked-in, source-bound consumer locks. Both `schemaUri` and `schemaHash` must match.

## 3. Existing geospatial findings

The authoritative WSGS 1.1 profile includes world findings, source products and typed gaps. Preserve:

```text
finding status
semantic concept
query semantics
evidence item IDs
source product IDs
confidence
unknowns
warnings
profile hashes
finding set hash
source product set hash
```

Do not flatten away provenance or completeness qualifiers.

## 4. Historical road association

Internal normalized shape may include:

```ts
interface HistoricalRoadAssociationFinding {
  findingKind: "HISTORICAL_ROAD_ASSOCIATION";
  status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
  networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH";
  roadVisits: RoadVisitSummary[];
  offNetworkSegments: OffNetworkSegmentSummary[];
  ambiguousPeriods: TimeRange[];
  qualityBreakPeriods: TimeRange[];
  upstreamGapPeriods: TimeRange[];
  lastConfirmedRoad?: RoadSummary;
  associationSuffixComplete: boolean;
  evidenceItemIds: string[];
  warnings: string[];
}
```

No road geometry may be invented from a road ID or name.

## 5. Historical temporal event

```ts
interface HistoricalTemporalEventFinding {
  findingKind: "HISTORICAL_TEMPORAL_EVENT";
  status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
  eventType: "ENTER" | "EXIT" | "DWELL" | "STOP" | "PASS_NEAR" | "CROSS";
  events: TemporalEventSummary[];
  selection?: {
    kind: "FIRST" | "LAST";
    selectedEventId?: string;
    confirmed: boolean;
    reasonCode: string;
  };
  blockingPeriods: TimeRange[];
  evidenceItemIds: string[];
  warnings: string[];
}
```

An unconfirmed LAST must be qualified in text and UI.

## 6. Historical metric ranking

```ts
interface HistoricalMetricRankingFinding {
  findingKind: "HISTORICAL_METRIC_RANKING";
  status: "COMPLETED" | "PARTIAL" | "NO_DATA" | "INDETERMINATE";
  metricConceptId: string;
  candidateDomain: "PAST_OBSERVED_LOCATIONS";
  candidates: MetricCandidateSummary[];
  metricTemporalCompletenessKnown: false;
  evidenceItemIds: string[];
  warnings: string[];
}
```

The map point is `representativeVisitedPosition`. H3 cell center/boundary is auxiliary context.

## 7. Historical action target

```ts
interface HistoricalActionTargetCandidate {
  findingKind: "HISTORICAL_ACTION_TARGET_CANDIDATE";
  position: GeoJsonPoint;
  sourceRank: number;
  currentValidationRequired: true;
  routePlanningRequired: true;
  executionAuthorized: false;
  evidenceItemIds: string[];
  warnings: string[];
}
```

This is never converted directly into an SDAR task in v0.6.

## 8. Unknown schema

Unknown, absent or hash-drifted schema yields:

```text
finding not normalized
evidence reference retained
typed gap: UNSUPPORTED_FINDING_SCHEMA
safe bounded explanation
no geometry, reference or fact invention
```

## 9. Capability-dependent implementation

If the locked WSGS source has no authoritative schema for a historical family:

- implement the registry and safe unsupported path;
- permit local fixture tests only for SACS normalization mechanics;
- do not call the fixture evidence “real WSGS integration”;
- mark the relevant S08 row `BLOCKED_EXTERNAL`;
- do not change WSGS in this Goal.
