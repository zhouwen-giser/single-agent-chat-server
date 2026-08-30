import {
  canonicalJson,
  hashCanonicalJson,
} from "../../world-explanation-contract/src/index.js";
import {
  mapSelectionSchema,
  type MapSelection,
} from "../../wsgs-http-adapter/src/index.js";

import type { ConversationWorldFocus } from "./index.js";

export const MAP_SELECTION_MAX_GEOMETRY_BYTES = 1_048_576;

export const mapSelectionValidationReasons = [
  "INVALID_SELECTION",
  "FOCUS_SCOPE_MISMATCH",
  "NO_STABLE_IDENTITY",
  "REFERENCE_NOT_IN_SCOPE",
  "REFERENCE_REVALIDATION_REQUIRED",
  "GEOMETRY_HASH_REQUIRED",
  "GEOMETRY_REQUIRED",
  "GEOMETRY_TOO_LARGE",
  "GEOMETRY_HASH_MISMATCH",
] as const;

export type MapSelectionValidation =
  | {
      readonly status: "VALID";
      readonly identity:
        "REFERENCE_KEY" | "GEOMETRY_HASH" | "REFERENCE_KEY_AND_GEOMETRY_HASH";
      readonly selection: MapSelection;
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: (typeof mapSelectionValidationReasons)[number];
    };

export function validateMapSelectionForFocus(input: {
  readonly principalId: string;
  readonly threadId: string;
  readonly focus: ConversationWorldFocus;
  readonly selection: unknown;
  readonly now?: string;
}): MapSelectionValidation {
  if (
    input.focus.principalId !== input.principalId ||
    input.focus.threadId !== input.threadId
  ) {
    return { status: "UNAVAILABLE", reason: "FOCUS_SCOPE_MISMATCH" };
  }
  const parsed = mapSelectionSchema.safeParse(input.selection);
  if (!parsed.success) {
    return { status: "UNAVAILABLE", reason: "INVALID_SELECTION" };
  }
  const selection = parsed.data;
  const hasReference = selection.referenceKey !== undefined;
  const hasGeometry = selection.geometry !== undefined;
  const hasGeometryHash = selection.geometryHash !== undefined;
  if (!hasReference && !hasGeometry && !hasGeometryHash) {
    return { status: "UNAVAILABLE", reason: "NO_STABLE_IDENTITY" };
  }
  if (hasGeometry && !hasGeometryHash) {
    return { status: "UNAVAILABLE", reason: "GEOMETRY_HASH_REQUIRED" };
  }
  if (!hasGeometry && hasGeometryHash) {
    return { status: "UNAVAILABLE", reason: "GEOMETRY_REQUIRED" };
  }
  if (selection.geometry !== undefined) {
    let canonical: string;
    try {
      canonical = canonicalJson(selection.geometry);
    } catch {
      return { status: "UNAVAILABLE", reason: "INVALID_SELECTION" };
    }
    if (
      Buffer.byteLength(canonical, "utf8") > MAP_SELECTION_MAX_GEOMETRY_BYTES
    ) {
      return { status: "UNAVAILABLE", reason: "GEOMETRY_TOO_LARGE" };
    }
    if (hashCanonicalJson(selection.geometry) !== selection.geometryHash) {
      return { status: "UNAVAILABLE", reason: "GEOMETRY_HASH_MISMATCH" };
    }
  }
  if (selection.referenceKey !== undefined) {
    const reference = input.focus.references.find(
      (candidate) =>
        referenceObjectIdentity(candidate.referenceKey) ===
        referenceObjectIdentity(
          selection.referenceKey as NonNullable<MapSelection["referenceKey"]>,
        ),
    );
    if (reference === undefined) {
      return { status: "UNAVAILABLE", reason: "REFERENCE_NOT_IN_SCOPE" };
    }
    if (
      reference.referenceKey.version !== selection.referenceKey.version ||
      reference.status !== "VALID" ||
      reference.revalidationRequired ||
      (reference.validUntil !== undefined &&
        Date.parse(reference.validUntil) <=
          Date.parse(input.now ?? new Date().toISOString()))
    ) {
      return {
        status: "UNAVAILABLE",
        reason: "REFERENCE_REVALIDATION_REQUIRED",
      };
    }
  }
  return {
    status: "VALID",
    identity:
      hasReference && hasGeometry
        ? "REFERENCE_KEY_AND_GEOMETRY_HASH"
        : hasReference
          ? "REFERENCE_KEY"
          : "GEOMETRY_HASH",
    selection,
  };
}

export function validateMapSelectionsForFocus(input: {
  readonly principalId: string;
  readonly threadId: string;
  readonly focus: ConversationWorldFocus;
  readonly selections: readonly unknown[];
  readonly now?: string;
}): readonly MapSelection[] | undefined {
  if (input.selections.length > 32) return undefined;
  const validated = input.selections.map((selection) =>
    validateMapSelectionForFocus({
      principalId: input.principalId,
      threadId: input.threadId,
      focus: input.focus,
      selection,
      ...(input.now === undefined ? {} : { now: input.now }),
    }),
  );
  if (validated.some(({ status }) => status !== "VALID")) return undefined;
  return validated.map((result) => {
    if (result.status !== "VALID") {
      throw new Error("MAP_SELECTION_VALIDATION_INVARIANT");
    }
    return result.selection;
  });
}

function referenceObjectIdentity(
  referenceKey: NonNullable<MapSelection["referenceKey"]>,
): string {
  return [referenceKey.namespace, referenceKey.kind, referenceKey.id].join(
    "\u0000",
  );
}
