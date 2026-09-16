import { z } from "zod";
import {
  analysisIdSchema,
  focusTargetSchema,
  ANALYSIS_MAX_PINNED_FOCUS,
  type MapSharedState,
} from "../../analysis-contract/src/index.js";
import {
  queryPositionSchema,
  queryScopeSchema,
  queryGeometrySchema,
} from "../../analysis-contract/src/query-scope.js";
import {
  assertDurableFocusIdentity,
  type LocalMapState,
} from "../../analysis-map/src/index.js";

export const localMapActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("PAN"),
    viewport: z
      .record(z.string(), z.number().finite())
      .refine((v) => Object.keys(v).length <= 32),
  }),
  z.strictObject({ type: z.literal("ZOOM"), zoom: z.number().finite() }),
  z.strictObject({
    type: z.literal("HOVER"),
    hover: z.record(z.string(), z.json()).optional(),
  }),
  z.strictObject({
    type: z.literal("INSPECT"),
    focus: focusTargetSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("FOCUS"),
    focus: focusTargetSchema.optional(),
  }),
  z.strictObject({ type: z.literal("FOCUS_PIN"), focus: focusTargetSchema }),
  z.strictObject({ type: z.literal("FOCUS_UNPIN"), focusId: analysisIdSchema }),
  z.strictObject({ type: z.literal("FIT_LAYER"), layerId: analysisIdSchema }),
  z.strictObject({
    type: z.literal("FIT_FINDING"),
    findingId: analysisIdSchema,
  }),
  z.strictObject({
    type: z.literal("TOGGLE_LAYER"),
    layerId: analysisIdSchema,
    visible: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal("DRAW_POINT"),
    coordinates: queryPositionSchema,
  }),
  z.strictObject({
    type: z.literal("DRAW_LINE"),
    coordinates: z.array(queryPositionSchema).min(2).max(256),
  }),
  z.strictObject({
    type: z.literal("DRAW_POLYGON"),
    coordinates: z
      .array(z.array(queryPositionSchema).min(4).max(256))
      .min(1)
      .max(16),
  }),
  z.strictObject({
    type: z.literal("DRAW_RADIUS"),
    center: queryPositionSchema,
    radiusMeters: z.number().finite().positive().max(1_000_000),
  }),
  z.strictObject({
    type: z.literal("SET_QUERY_SCOPE"),
    scope: queryScopeSchema,
  }),
  z.strictObject({
    type: z.literal("REPLACE_QUERY_SCOPE"),
    scope: queryScopeSchema,
  }),
  z.strictObject({ type: z.literal("CLEAR_QUERY_SCOPE") }),
]);
export type AnalysisClientMapAction = z.infer<typeof localMapActionSchema>;

/** No transport dependency: every transition here is local-only. */
export function reduceClientMapAction(
  local: LocalMapState,
  action: AnalysisClientMapAction,
  shared: MapSharedState | undefined,
  revisionId: string | undefined,
): LocalMapState {
  switch (action.type) {
    case "PAN":
      return { ...local, viewport: { ...local.viewport, ...action.viewport } };
    case "ZOOM":
      return { ...local, viewport: { ...local.viewport, zoom: action.zoom } };
    case "HOVER":
      return { ...local, hover: action.hover };
    case "INSPECT":
    case "FOCUS":
      if (action.focus) assertDurableFocusIdentity(action.focus);
      return { ...local, inspectionFocus: action.focus };
    case "FOCUS_PIN": {
      assertDurableFocusIdentity(action.focus);
      const overrides = {
        ...local.pinnedFocusOverrides,
        [action.focus.focusId]: action.focus,
      };
      if (Object.keys(overrides).length > ANALYSIS_MAX_PINNED_FOCUS)
        throw Error("ANALYSIS_CLIENT_PIN_LIMIT");
      const visible = { ...shared?.pinnedFocusById, ...overrides };
      if (
        Object.values(visible).filter((f) => f !== null).length >
        ANALYSIS_MAX_PINNED_FOCUS
      )
        throw Error("ANALYSIS_CLIENT_PIN_LIMIT");
      return { ...local, pinnedFocusOverrides: overrides };
    }
    case "FOCUS_UNPIN": {
      const overrides = { ...local.pinnedFocusOverrides };
      delete overrides[action.focusId];
      if (shared?.pinnedFocusById[action.focusId])
        overrides[action.focusId] = null;
      if (Object.keys(overrides).length > ANALYSIS_MAX_PINNED_FOCUS)
        throw Error("ANALYSIS_CLIENT_PIN_LIMIT");
      return { ...local, pinnedFocusOverrides: overrides };
    }
    case "TOGGLE_LAYER": {
      const layer = shared?.layersById[action.layerId];
      if (!layer) throw Error("ANALYSIS_LAYER_NOT_FOUND");
      return {
        ...local,
        layerVisibilityPreference: {
          ...local.layerVisibilityPreference,
          [action.layerId]:
            action.visible ??
            !(
              local.layerVisibilityPreference[action.layerId] ??
              layer.visibleByDefault
            ),
        },
      };
    }
    case "FIT_LAYER":
    case "FIT_FINDING": {
      if (!shared) throw Error("ANALYSIS_CLIENT_MAP_SNAPSHOT_REQUIRED");
      const layers = Object.values(shared.layersById).filter((l) =>
        action.type === "FIT_LAYER"
          ? l.layerId === action.layerId
          : l.findingIds.includes(action.findingId),
      );
      if (!layers.length) throw Error("ANALYSIS_LAYER_NOT_FOUND");
      const positions = layers.flatMap((l) =>
        l.access.kind === "INLINE_GEOJSON"
          ? publishedPositions(l.access.data)
          : [],
      );
      if (!positions.length) throw Error("ANALYSIS_MAP_GEOMETRY_UNAVAILABLE");
      if (positions.length > 32768) throw Error("ANALYSIS_MAP_GEOMETRY_LIMIT");
      const bounds = positions.reduce(
        (b, p) => ({
          west: Math.min(b.west, p[0]),
          south: Math.min(b.south, p[1]),
          east: Math.max(b.east, p[0]),
          north: Math.max(b.north, p[1]),
        }),
        { west: 180, south: 90, east: -180, north: -90 },
      );
      return {
        ...local,
        viewport: {
          ...local.viewport,
          ...bounds,
        },
      };
    }
    case "CLEAR_QUERY_SCOPE":
      return { ...local, unsubmittedEditDraft: undefined };
    default: {
      const geometry =
        action.type === "SET_QUERY_SCOPE" ||
        action.type === "REPLACE_QUERY_SCOPE"
          ? action.scope.geometry
          : action.type === "DRAW_RADIUS"
            ? {
                type: "Circle",
                center: action.center,
                radiusMeters: action.radiusMeters,
              }
            : {
                type:
                  action.type === "DRAW_POINT"
                    ? "Point"
                    : action.type === "DRAW_LINE"
                      ? "LineString"
                      : "Polygon",
                coordinates: action.coordinates,
              };
      const scope = { geometry: queryGeometrySchema.parse(geometry) };
      const draftRevision =
        Number(local.unsubmittedEditDraft?.["draftRevision"] ?? 0) + 1;
      return {
        ...local,
        unsubmittedEditDraft: {
          scope,
          draftRevision,
          ...(revisionId ? { basedOnRevisionId: revisionId } : {}),
        },
      };
    }
  }
}

/** A renderer-only composition. It never becomes shared AG-UI state or increments its revision. */
export function renderLocalMap(
  shared: MapSharedState,
  local: LocalMapState,
): MapSharedState {
  const scene = structuredClone(shared);
  for (const layer of Object.values(scene.layersById)) {
    const visible = local.layerVisibilityPreference[layer.layerId];
    if (visible !== undefined) layer.visibleByDefault = visible;
  }
  for (const [id, focus] of Object.entries(local.pinnedFocusOverrides ?? {})) {
    if (focus === null) delete scene.pinnedFocusById[id];
    else scene.pinnedFocusById[id] = structuredClone(focus);
  }
  return scene;
}

function publishedPositions(
  geometry: Record<string, unknown>,
): [number, number][] {
  const result: [number, number][] = [];
  let visited = 0;
  const coordinates = (value: unknown, depth: number): void => {
    if (++visited > 32768 || depth > 8)
      throw Error("ANALYSIS_MAP_GEOMETRY_LIMIT");
    if (!Array.isArray(value)) return;
    const point = queryPositionSchema.safeParse(value);
    if (point.success) result.push(point.data);
    else for (const child of value) coordinates(child, depth + 1);
  };
  const visit = (value: unknown, depth: number): void => {
    if (++visited > 32768 || depth > 8)
      throw Error("ANALYSIS_MAP_GEOMETRY_LIMIT");
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const object = value as Record<string, unknown>;
    if (object["type"] === "Feature") visit(object["geometry"], depth + 1);
    else if (
      object["type"] === "FeatureCollection" &&
      Array.isArray(object["features"])
    )
      for (const f of object["features"]) visit(f, depth + 1);
    else if (
      object["type"] === "GeometryCollection" &&
      Array.isArray(object["geometries"])
    )
      for (const g of object["geometries"]) visit(g, depth + 1);
    else if (
      [
        "Point",
        "MultiPoint",
        "LineString",
        "MultiLineString",
        "Polygon",
        "MultiPolygon",
      ].includes(String(object["type"]))
    )
      coordinates(object["coordinates"], 0);
  };
  visit(geometry, 0);
  return result;
}
