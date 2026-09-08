import {
  mapLayerDescriptorSchema,
  mapSharedStateSchema,
  type FocusTarget,
  type MapLayerDescriptor,
  type MapSharedState,
} from "../../analysis-contract/src/index.js";
import { canonicalJson } from "../../world-explanation-contract/src/index.js";

export const MAX_INLINE_GEOJSON_BYTES = 1_048_576;
export const MAX_INLINE_FEATURES = 256;

export interface LocalMapState {
  readonly viewport?: Readonly<Record<string, number>>;
  readonly hover?: Readonly<Record<string, unknown>>;
  readonly inspectionFocus?: FocusTarget;
  readonly layerVisibilityPreference: Readonly<Record<string, boolean>>;
  readonly unsubmittedEditDraft?: Readonly<Record<string, unknown>>;
  readonly playbackCursor?: string;
  readonly playbackRate?: number;
  readonly panelLayout?: string;
}

export type MapSceneCommand =
  | { readonly type: "LAYER_UPSERT"; readonly layer: MapLayerDescriptor }
  | {
      readonly type: "LAYER_LOAD_STATUS";
      readonly layerId: string;
      readonly loadStatus: MapLayerDescriptor["loadStatus"];
    }
  | { readonly type: "EXECUTION_FOCUS_SET"; readonly focus?: FocusTarget }
  | { readonly type: "INTERVENTION_FOCUS_SET"; readonly focus?: FocusTarget }
  | { readonly type: "FOCUS_PIN"; readonly focus: FocusTarget }
  | { readonly type: "FOCUS_UNPIN"; readonly focusId: string }
  | { readonly type: "REVISION_SUPERSEDED"; readonly revisionId: string };

export function emptyMapSharedState(): MapSharedState {
  return {
    schemaVersion: "io.sacs/map-scene/v1",
    sceneRevision: 0,
    layersById: {},
    pinnedFocusById: {},
  };
}

export function reduceMapSharedState(
  current: MapSharedState,
  command: MapSceneCommand,
): MapSharedState {
  const state = mapSharedStateSchema.parse(current);
  let next: MapSharedState;
  switch (command.type) {
    case "LAYER_UPSERT": {
      const layer = validateLayer(command.layer);
      next = {
        ...state,
        sceneRevision: state.sceneRevision + 1,
        layersById: { ...state.layersById, [layer.layerId]: layer },
      };
      break;
    }
    case "LAYER_LOAD_STATUS": {
      const layer = state.layersById[command.layerId];
      if (layer === undefined) throw new Error("ANALYSIS_LAYER_NOT_FOUND");
      next = {
        ...state,
        sceneRevision: state.sceneRevision + 1,
        layersById: {
          ...state.layersById,
          [layer.layerId]: { ...layer, loadStatus: command.loadStatus },
        },
      };
      break;
    }
    case "EXECUTION_FOCUS_SET":
      next = withoutUndefined({
        ...state,
        sceneRevision: state.sceneRevision + 1,
        executionFocus: command.focus,
      });
      break;
    case "INTERVENTION_FOCUS_SET":
      next = withoutUndefined({
        ...state,
        sceneRevision: state.sceneRevision + 1,
        interventionFocus: command.focus,
      });
      break;
    case "FOCUS_PIN":
      assertDurableFocusIdentity(command.focus);
      next = {
        ...state,
        sceneRevision: state.sceneRevision + 1,
        pinnedFocusById: {
          ...state.pinnedFocusById,
          [command.focus.focusId]: command.focus,
        },
      };
      break;
    case "FOCUS_UNPIN": {
      const pinnedFocusById = { ...state.pinnedFocusById };
      delete pinnedFocusById[command.focusId];
      next = {
        ...state,
        sceneRevision: state.sceneRevision + 1,
        pinnedFocusById,
      };
      break;
    }
    case "REVISION_SUPERSEDED": {
      const layersById = Object.fromEntries(
        Object.entries(state.layersById).map(([layerId, layer]) => [
          layerId,
          layer.revisionId === command.revisionId
            ? { ...layer, relevanceStatus: "SUPERSEDED" as const }
            : layer,
        ]),
      );
      next = {
        ...state,
        sceneRevision: state.sceneRevision + 1,
        layersById,
      };
      break;
    }
  }
  return mapSharedStateSchema.parse(next);
}

export function reduceLocalMapState(
  current: LocalMapState,
  patch: Partial<LocalMapState>,
): LocalMapState {
  return { ...current, ...patch };
}

export function isLocalOnlyMapAction(action: string): boolean {
  return new Set([
    "PAN",
    "ZOOM",
    "PITCH",
    "HEADING",
    "HOVER",
    "INSPECT",
    "VISIBILITY_PREFERENCE",
    "EDIT_DRAFT",
    "PLAYBACK_CURSOR",
    "PLAYBACK_RATE",
    "PANEL_LAYOUT",
  ]).has(action);
}

export function createUserOverrideLayer(
  input: Omit<
    MapLayerDescriptor,
    "schemaVersion" | "sourceAuthority" | "representation" | "editable"
  > & {
    readonly access: {
      readonly kind: "INLINE_GEOJSON";
      readonly data: Record<string, unknown>;
    };
  },
): MapLayerDescriptor {
  return validateLayer({
    ...input,
    schemaVersion: "sacs-map-layer/1.0",
    sourceAuthority: "USER",
    representation: "INLINE_GEOJSON",
    editable: true,
  });
}

export function validateLayer(layer: MapLayerDescriptor): MapLayerDescriptor {
  const parsed = mapLayerDescriptorSchema.parse(layer);
  if (parsed.access.kind === "INLINE_GEOJSON") {
    assertInlineGeoJsonBudget(parsed.access.data);
  }
  return parsed;
}

export function assertInlineGeoJsonBudget(
  value: Readonly<Record<string, unknown>>,
): void {
  const bytes = Buffer.byteLength(canonicalJson(value), "utf8");
  if (bytes > MAX_INLINE_GEOJSON_BYTES) {
    throw new Error("INLINE_GEOJSON_TOO_LARGE");
  }
  if (countFeatures(value) > MAX_INLINE_FEATURES) {
    throw new Error("INLINE_GEOJSON_TOO_MANY_FEATURES");
  }
}

export function assertDurableFocusIdentity(focus: FocusTarget): void {
  if (focus.targetKind === "WORLD_REFERENCE") {
    if (focus.referenceKey === undefined) {
      throw new Error("DURABLE_FOCUS_STABLE_IDENTITY_REQUIRED");
    }
    return;
  }
  if (focus.targetKind === "FINDING_FEATURE") {
    if (focus.findingId === undefined || focus.featureId === undefined) {
      throw new Error("DURABLE_FOCUS_STABLE_IDENTITY_REQUIRED");
    }
    return;
  }
  if (
    focus.analysisNodeId === undefined &&
    focus.layerId === undefined &&
    focus.featureId === undefined
  ) {
    throw new Error("DURABLE_FOCUS_STABLE_IDENTITY_REQUIRED");
  }
}

function countFeatures(value: Readonly<Record<string, unknown>>): number {
  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    return value.features.length;
  }
  return value.type === "Feature" ? 1 : 0;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
