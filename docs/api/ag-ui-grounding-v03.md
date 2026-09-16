# Grounding analysis reference client (v0.3)

This is the headless/reference presentation API, not a browser application or an
Open WebUI extension. Use the existing authenticated AG-UI endpoint with
`SACS_AG_UI_V03_PROFILE_ID`, then feed its official SSE to
`HeadlessAnalysisReferenceClient.acceptSseChunk`. WSGS analysis requires the
configured frozen 1.2 source path; generic SDAR Task interaction remains separate.

Only State snapshots/deltas change the shared view. `mapPresentation.shared` is
the authoritative scene; `mapPresentation.rendered` applies local visibility and
pin preferences. Grounding lifecycle is a revision-scoped `grounding.job`
Activity, not a fabricated tool/DAG execution. Published source status is retained.

## Inspect then confirm a Choice

```ts
const presentation = await client.inspectFrozenChoice(choiceId, candidateId);
// Render presentation.choice, message and enabled; inspection sends nothing.
// On a separate, explicit user confirmation gesture:
if (presentation.enabled) {
  await client.resolveSelection(control, {
    confirmed: true,
    commandId,
    idempotencyKey,
    originalText: "采用此历史候选",
  });
}
```

Confirmation rechecks the current saved projection, intervention, Revision and
clock. The server reauthorizes the complete persisted source, selector and TTL.
Historical/expired candidates remain readable, but cannot be selected. No
candidate gesture calls SDAR, plans a route or authorizes device execution.

## Draw then submit a query scope

```ts
await client.dispatchMapAction({
  type: "DRAW_POLYGON",
  coordinates: [
    [
      [120, 30],
      [121, 30],
      [121, 31],
      [120, 30],
    ],
  ],
});
const draft = client.mapPresentation.local.unsubmittedEditDraft;
// Retain the displayed draft generation with the confirmation UI.
await client.submitNewQuery(control, {
  confirmed: true,
  expectedDraftRevision: Number(draft?.["draftRevision"]),
  commandId,
  idempotencyKey,
  originalText: "查询此范围内的历史位置",
  contextMode: "CONTINUE", // or REPLACE to omit prior Grounding context
});
```

DRAW/SET/REPLACE/CLEAR are local and never call Control. A clear/redraw also
advances the local generation, so an old confirmation cannot silently submit a
different geometry. The draft must have been created against the active Revision.
An HTTP acknowledgement does not turn a draft into an authoritative map layer;
only the subsequent new Revision/State can update the shared scene.

The Control proposal uses the existing `GROUNDING_SOURCE_QUERY` kind, adding
optional `queryScope: { geometry }`. Both the route and service validate its
bounded shape. Point/LineString/closed Polygon use longitude/latitude coordinates;
Circle retains its exact `center` and positive bounded `radiusMeters`, without
polygon approximation. The planner sends one public `contextCapsule.mapSelections`
entry (`POINT`, `LINE` or `AREA`), with a command-scoped selection ID, revision 1
and canonical geometry hash. It never fabricates an authoritative reference key,
Finding or Native `compileRevision` call. Changed geometry under the same command
identity conflicts instead of silently replacing the saved request.

The frozen public MapSelection schema accepts an opaque geometry object. Schema
acceptance alone does **not** prove that a live WSGS supports every spatial
operation or Circle semantics. Preserve its real response, including unsupported,
PARTIAL or empty results; do not approximate geometry or report business success
from HTTP success. Execution remains read-only with approximation disabled.

## Observe the new authoritative view

After a successful Control operation, reconnect the same analysis using a new
observation Run and `forwardedProps: { mode: "RECONNECT", analysisId }`, without
resubmitting the original user message. Call `client.reconnect()` before feeding
the new SSE stream. It requests full State and Activity snapshots and does not
create another Grounding request. A disconnected observer does not cancel work.

Transport errors do not trigger automatic command retries. Explicit identical
replay may use the same command/idempotency identity; a genuinely different query
requires a new identity. Stale or expired selection/draft errors require a fresh
authoritative view and another explicit user decision.
