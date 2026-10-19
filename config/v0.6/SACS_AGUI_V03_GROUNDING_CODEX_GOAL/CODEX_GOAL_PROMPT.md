# Codex Goal Prompt — SACS AG-UI v0.3 Grounding Presentation Closure

Work in `zhouwen-giser/single-agent-chat-server`, branch `codex/sacs-v0.6-wsgs-full-functional-integration`.

## Before coding

Read the repository `AGENTS.md`, root active goal, complete `config/v0.6/task-package/`, then this complete package. Inspect current source and run the existing v0.6 DEVELOPMENT verification. Reconcile this package with current code; do not regress already-correct v0.6 behavior.

## Goal

Implement the missing SACS functional closure:

```text
natural-language Grounding request
-> real WSGS Grounding Job
-> truthful observable lifecycle
-> durable Analysis Session/Revision/Run
-> AG-UI v0.3 State + Activity
-> World Analysis View
   summary/findings/gaps/warnings/map/timeline/evidence/choices
-> local map inspection/focus
-> explicit candidate resolution OR explicit query edit
-> Analysis Control
-> new Revision + new Grounding
-> authoritative new Snapshot
-> reconnect/recovery
```

## Mandatory decisions

1. Do not add a parallel Grounding CUSTOM event protocol. Use v0.3 RUN/STEP/TEXT/STATE/ACTIVITY; TOOL_CALL only for real authoritative public tool interactions.
2. Add `activityType="grounding.job"` with public status only. Minimum UI status: `QUEUED|RUNNING|WAITING_SELECTION|COMPLETED|PARTIAL|FAILED|CANCEL_REQUESTED|CANCELLED`.
3. `phase`, `message`, `progress` are optional and must never be inferred from unavailable WSGS internals.
4. Do not use `analysis.dag` for a single Grounding Job unless an actual DAG exists.
5. Complete stable Finding/Map/Timeline/Evidence/Choice linkage through IDs and `FocusTarget`. Never infer linkage from labels, rank, coordinates, array indexes or geometry equality.
6. Shared AG-UI state and client-local map state remain separate. PAN/ZOOM/HOVER/INSPECT/FOCUS/FIT/TOGGLE_LAYER have no Analysis Control side effect.
7. DRAW_POINT/LINE/POLYGON/RADIUS only create local draft geometry. A backend change requires explicit `SUBMIT_NEW_QUERY`.
8. Map/card candidate click is local selection only. `RESOLVE_SELECTION` requires explicit confirmation and exact selector identity: priorGroundingId/priorResultHash/findingSetHash/choiceId/candidateId.
9. Grounding-mode query edits create a new SACS Revision and new WSGS Grounding. Never call Native compileRevision.
10. Preserve revision-guarded State/Activity deltas. Mismatch => request full Snapshot; never force-apply.
11. Disconnecting an observer does not cancel the analysis. Reconnect restores authoritative Snapshot.
12. Preserve `NO_DATA`, `INDETERMINATE`, `PARTIAL`, `STALE`, `UNKNOWN`, `DATA_GAP`, `OFF_NETWORK`, `AMBIGUITY`.
13. Never connect trajectory segments across a data gap.
14. Historical action candidates remain `currentValidationRequired=true`, `routePlanningRequired=true`, `executionAuthorized=false`.
15. Do not modify upstream repositories or fabricate missing external capabilities.

## Execution

Execute S00-S07 in order. Each phase must have tests and evidence. Do not stop at design.

DEVELOPMENT completion marker:

`SACS_AGUI_V03_GROUNDING_PRESENTATION_DEV_READY`

REAL WSGS marker requires real WSGS, never fixture/mock/recorded JSON:

`SACS_AGUI_V03_GROUNDING_PRESENTATION_REAL_WSGS_READY`

Do not merge/tag/release/deploy without separate user authorization.
