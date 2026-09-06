# Contract — Text, Map, Timeline and AG-UI Projection

## 1. Text projection

Generate a bounded `AnalysisAnswerProjection` first:

```ts
interface AnalysisAnswerProjection {
  headline: string;
  facts: string[];
  qualifiers: string[];
  choices: string[];
  unavailableCapabilities: string[];
}
```

A language model may polish this projection but cannot add facts, geometry, certainty or causality absent from it.

Required phrasing behavior:

- `PARTIAL` explicitly says the answer is based on available partial data.
- unconfirmed `LAST` says it is the last confirmed item, not the absolute last.
- off-network says “未关联到当前参考路网,” not “轨迹错误.”
- historical best says “在可用历史样本中,” not “当前最佳.”
- no data is not zero.
- no event found is not proof that the event did not happen when coverage is incomplete.

## 2. Map projection

Use existing `MapLayerDescriptor` and source authority.

### Allowed

- upstream-provided inline GeoJSON;
- upstream ReferenceKey/reference sets;
- payload references;
- entry/exit/event/candidate points published upstream;
- auxiliary H3 boundary when published upstream;
- local UI focus independent of shared state.

### Forbidden

- invented road lines from road names/IDs;
- full trajectory line created from a bounded point preview;
- H3 center used as actual visit position or device target;
- network-local node promoted to world reference;
- stale layer marked current.

Recommended roles/styles:

```text
trajectory preview      INTERMEDIATE_RESULT / analysis.intermediate
road visit points       FINAL_FINDING / finding.primary
off-network             GAP / gap.coverage
ambiguity               GAP / gap.ambiguity
temporal event          FINAL_FINDING / finding.primary
metric candidate        FINAL_FINDING / finding.candidate
historical target       FOCUS / focus.execution
stale source            source.stale
```

## 3. Timeline projection

Add `WSGS` as a timeline source kind if the current contract lacks it. It means WSGS-organized derived analysis, not original evidence authority.

Distinct timeline concepts:

```text
task interval
active phase
paused excluded phase
trajectory defined period
data gap
quality break
off-network interval
ambiguity interval
instant event
interval event
metric observation time/period
```

## 4. AG-UI v0.3

Grounding Job mode may emit:

```text
RUN_STARTED
STATE_SNAPSHOT
ACTIVITY_SNAPSHOT
STEP_STARTED(world-grounding)
STATE_DELTA / ACTIVITY_DELTA on truthful changes
STEP_FINISHED(world-grounding)
TOOL_CALL_RESULT with bounded safe references
TEXT_MESSAGE events
RUN_FINISHED or interrupt outcome
```

It must not emit fake Provider step names or fake progress percentages.

Interrupt outcomes require state and activity snapshots before `RUN_FINISHED`.

## 5. Reconnect

A reconnect requests full State and Activity snapshots. Delta gaps, hash mismatches or revision discontinuity also trigger full snapshot recovery.

## 6. OpenAI and v0.2 compatibility

OpenAI-compatible requests may await terminal Grounding and return one text answer.

AG-UI v0.2 behavior and event contracts remain unchanged. v0.3 is negotiated explicitly.
