import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { EventEncoder } from "@ag-ui/encoder";
import {
  HeadlessAnalysisReferenceClient,
  HeadlessMapEngineAdapter,
  type AnalysisClientMapAction,
} from "../packages/analysis-client/src/index.js";
import { projectAnalysisStateSnapshot } from "../packages/ag-ui-analysis-adapter/src/index.js";
import {
  mapLayerDescriptorSchema,
  type FocusTarget,
} from "../packages/analysis-contract/src/index.js";
import { isLocalOnlyMapAction } from "../packages/analysis-map/src/index.js";
import { analysisStateBody } from "./v05-analysis-fixtures.js";

const encoder = new EventEncoder({ accept: "text/event-stream" });
const focus: FocusTarget = {
  focusId: "focus-1",
  targetKind: "FINDING_FEATURE",
  findingId: "finding-1",
  featureId: "feature-1",
  layerId: "layer-1",
  semanticRole: "SELECTED_RESULT",
  currentness: "UNKNOWN",
};
const body = () => {
  const state = analysisStateBody();
  for (const [id, coordinates] of [
    ["layer-1", [1, 2]],
    ["layer-2", [3, 4]],
  ] as const) {
    state.map.layersById[id] = mapLayerDescriptorSchema.parse({
      schemaVersion: "sacs-map-layer/1.0",
      layerId: id,
      title: "Published point",
      role: "FINAL_FINDING",
      representation: "INLINE_GEOJSON",
      access: { kind: "INLINE_GEOJSON", data: { type: "Point", coordinates } },
      sourceAuthority: "WSGS",
      visibleByDefault: true,
      selectable: true,
      editable: false,
      analysisId: "analysis-1",
      revisionId: "revision-1",
      findingIds: ["finding-1"],
      loadStatus: "READY",
      relevanceStatus: "ACTIVE",
      currentness: "UNKNOWN",
      styleToken: "finding.primary",
    });
  }
  return state;
};
async function setup() {
  const engine = new HeadlessMapEngineAdapter(),
    client = new HeadlessAnalysisReferenceClient(engine);
  const state = body();
  await client.acceptSseChunk(
    encoder.encodeSSE(
      projectAnalysisStateSnapshot({ stateRevision: 1, state }),
    ),
  );
  const network = jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(Error("LOCAL_ACTION_NETWORK_FORBIDDEN"));
  return { engine, client, state, network };
}
const polygon: [number, number][][] = [
  [
    [1, 2],
    [3, 2],
    [3, 4],
    [1, 2],
  ],
];
const actions: AnalysisClientMapAction[] = [
  { type: "PAN", viewport: { longitude: 1, latitude: 2 } },
  { type: "ZOOM", zoom: 9 },
  { type: "HOVER", hover: { featureId: "feature-1" } },
  { type: "INSPECT", focus },
  { type: "FOCUS", focus },
  { type: "FOCUS_PIN", focus },
  { type: "FOCUS_UNPIN", focusId: "focus-1" },
  { type: "FIT_LAYER", layerId: "layer-1" },
  { type: "FIT_FINDING", findingId: "finding-1" },
  { type: "TOGGLE_LAYER", layerId: "layer-1" },
  { type: "DRAW_POINT", coordinates: [1, 2] },
  {
    type: "DRAW_LINE",
    coordinates: [
      [1, 2],
      [3, 4],
    ],
  },
  { type: "DRAW_POLYGON", coordinates: polygon },
  { type: "DRAW_RADIUS", center: [1, 2], radiusMeters: 100 },
  {
    type: "SET_QUERY_SCOPE",
    scope: { geometry: { type: "Point", coordinates: [1, 2] } },
  },
  {
    type: "REPLACE_QUERY_SCOPE",
    scope: { geometry: { type: "Point", coordinates: [3, 4] } },
  },
  { type: "CLEAR_QUERY_SCOPE" },
];
afterEach(() => {
  jest.restoreAllMocks();
});
describe("headless local map navigation and drafts", () => {
  it.each(actions)(
    "$type remains local, with zero network and no shared revision/hash change",
    async (action) => {
      const { client, engine, network } = await setup();
      const before = client.state;
      await client.dispatchMapAction(action);
      expect(isLocalOnlyMapAction(action.type)).toBe(true);
      expect(client.state).toEqual(before);
      expect(client.mapPresentation.shared).toEqual(before.sharedState?.map);
      expect(engine.localMapActions.at(-1)).toEqual(action);
      expect(network).not.toHaveBeenCalled();
    },
  );
  it("focus, pin, unpin and visibility affect renderer-only state and survive a full snapshot", async () => {
    const { client, state } = await setup();
    await client.dispatchMapAction({ type: "FOCUS", focus });
    await client.dispatchMapAction({ type: "FOCUS_PIN", focus });
    await client.dispatchMapAction({
      type: "TOGGLE_LAYER",
      layerId: "layer-1",
      visible: false,
    });
    expect(client.mapPresentation.local.inspectionFocus).toEqual(focus);
    expect(client.mapPresentation.shared?.pinnedFocusById).toEqual({});
    expect(
      client.mapPresentation.rendered?.pinnedFocusById[focus.focusId],
    ).toEqual(focus);
    expect(
      client.mapPresentation.shared?.layersById["layer-1"]?.visibleByDefault,
    ).toBe(true);
    expect(
      client.mapPresentation.rendered?.layersById["layer-1"]?.visibleByDefault,
    ).toBe(false);
    await client.acceptSseChunk(
      encoder.encodeSSE(
        projectAnalysisStateSnapshot({ stateRevision: 2, state }),
      ),
    );
    expect(
      client.mapPresentation.rendered?.layersById["layer-1"]?.visibleByDefault,
    ).toBe(false);
    expect(
      client.mapPresentation.rendered?.pinnedFocusById[focus.focusId],
    ).toEqual(focus);
    await client.dispatchMapAction({
      type: "FOCUS_UNPIN",
      focusId: focus.focusId,
    });
    expect(client.mapPresentation.rendered?.pinnedFocusById).toEqual({});
    expect(client.state.sharedState?.map).toEqual(state.map);
  });
  it("FIT uses the explicitly identified published layers, not feature labels or lookup requests", async () => {
    const { client } = await setup();
    await client.dispatchMapAction({ type: "FIT_LAYER", layerId: "layer-1" });
    expect(client.mapPresentation.local.viewport).toMatchObject({
      west: 1,
      east: 1,
      south: 2,
      north: 2,
    });
    await client.dispatchMapAction({
      type: "FIT_FINDING",
      findingId: "finding-1",
    });
    expect(client.mapPresentation.local.viewport).toMatchObject({
      west: 1,
      east: 3,
      south: 2,
      north: 4,
    });
    await expect(
      client.dispatchMapAction({ type: "FIT_FINDING", findingId: "unknown" }),
    ).rejects.toThrow("ANALYSIS_LAYER_NOT_FOUND");
  });
  it("draw/update/clear are local revisions, never authoritative layers or automatic submissions", async () => {
    const { client } = await setup();
    await client.dispatchMapAction({
      type: "DRAW_RADIUS",
      center: [1, 2],
      radiusMeters: 100,
    });
    expect(client.mapPresentation.local.unsubmittedEditDraft).toEqual({
      scope: {
        geometry: { type: "Circle", center: [1, 2], radiusMeters: 100 },
      },
      draftRevision: 1,
      basedOnRevisionId: "revision-1",
    });
    await client.dispatchMapAction({
      type: "REPLACE_QUERY_SCOPE",
      scope: { geometry: { type: "Polygon", coordinates: polygon } },
    });
    expect(
      client.mapPresentation.local.unsubmittedEditDraft?.["draftRevision"],
    ).toBe(2);
    expect(Object.keys(client.state.sharedState?.map.layersById ?? {})).toEqual(
      ["layer-1", "layer-2"],
    );
    await client.dispatchMapAction({ type: "CLEAR_QUERY_SCOPE" });
    expect(client.mapPresentation.local.unsubmittedEditDraft).toBeUndefined();
  });
  it.each([
    { type: "DRAW_POINT", coordinates: [181, 0] },
    { type: "DRAW_LINE", coordinates: [[1, 2]] },
    {
      type: "DRAW_POLYGON",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
    },
    { type: "DRAW_RADIUS", center: [0, 0], radiusMeters: -1 },
    { type: "DRAW_RADIUS", center: [0, 0], radiusMeters: Infinity },
    {
      type: "SET_QUERY_SCOPE",
      scope: { geometry: { type: "Point", coordinates: [1, NaN] } },
    },
    { type: "ZOOM", zoom: Infinity },
    { type: "TOGGLE_LAYER", layerId: "missing" },
    { type: "RESOLVE_SELECTION" },
    { type: "SUBMIT_NEW_QUERY" },
    { type: "CANCEL_ANALYSIS" },
  ])("rejects malformed or backend action $type atomically", async (input) => {
    const { client, engine, network } = await setup();
    const before = client.mapPresentation;
    await expect(
      client.dispatchMapAction(input as AnalysisClientMapAction),
    ).rejects.toThrow();
    expect(client.mapPresentation).toEqual(before);
    expect(engine.localMapActions).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  });
  it("does not allow caller-owned actions or state getters to mutate authoritative or local state", async () => {
    const { client } = await setup();
    const action: AnalysisClientMapAction = {
      type: "DRAW_POINT",
      coordinates: [1, 2],
    };
    await client.dispatchMapAction(action);
    action.coordinates[0] = 40;
    const snapshot = client.state;
    if (snapshot.sharedState) snapshot.sharedState.map.layersById = {};
    expect(client.mapPresentation.local.unsubmittedEditDraft).toMatchObject({
      scope: { geometry: { coordinates: [1, 2] } },
    });
    expect(
      Object.keys(client.state.sharedState?.map.layersById ?? {}),
    ).toHaveLength(2);
  });
});
