# Design Baseline

## Shared state
`AgUiSharedStateV03` remains authoritative: meta, conversation, analysis, map, timeline, proposalsById, pendingIntervention, worldExplanation.

Only STATE_SNAPSHOT/STATE_DELTA change shared state.

## Grounding Activity
Create/freeze `io.sacs/grounding-activity/v1`:
- required: groundingId, analysisId, revisionId, status, meta.activityRevision
- optional: phase, message, progress
- deterministic messageId per analysis revision
- no fabricated phase/progress.

## Cross-view linkage
Project stable relations where authoritative:
- findingId
- layerIds
- featureIds/references
- timelineItemIds
- evidenceItemIds
- sourceProductIds

Missing relationship => omit/safe typed gap; never guess.

## Focus
Use existing FocusTarget. Shared: executionFocus/interventionFocus/pinnedFocusById. Local: hover/inspection/selection.

## Map local actions
PAN, ZOOM, HOVER, INSPECT, FOCUS, FOCUS_PIN, FOCUS_UNPIN, FIT_LAYER, FIT_FINDING, TOGGLE_LAYER.

## Draft actions
DRAW_POINT, DRAW_LINE, DRAW_POLYGON, DRAW_RADIUS, SET_QUERY_SCOPE, REPLACE_QUERY_SCOPE, CLEAR_QUERY_SCOPE are local only.

## Explicit backend actions
SUBMIT_NEW_QUERY, RESOLVE_SELECTION, CANCEL_ANALYSIS.

## Recovery
Revision mismatch => full Snapshot. Reconnect != rerun. Observer disconnect != cancel. Stale revisions/runs cannot overwrite active projection.
