import { describe, expect, it, jest } from "@jest/globals";

import {
  FindingReferenceResolver,
  MAP_SELECTION_MAX_GEOMETRY_BYTES,
  validateMapSelectionForFocus,
  worldReferenceIdentityHash,
  type ConversationWorldFocus,
  type ScopedFindingProjection,
} from "../packages/conversation-world-focus/src/index.js";
import {
  finalizeWorldExplanation,
  hashCanonicalJson,
  type WorldExplanationV1,
} from "../packages/world-explanation-contract/src/index.js";

const explanationHashPattern = "sha256:" + "1".repeat(64);
const resultHash = "sha256:" + "2".repeat(64);
const keyOne = {
  namespace: "gowm" as const,
  kind: "DERIVED_REFERENCE",
  id: "wrf_" + "1".repeat(32),
  version: "world-7",
};
const keyTwo = {
  namespace: "gowm" as const,
  kind: "DERIVED_REFERENCE",
  id: "wrf_" + "2".repeat(32),
  version: "world-7",
};

describe("SACS v0.4 S20 FindingReferenceResolver", () => {
  it("AC-M004/M005/M006 resolves an exact second feature with a projected stable ReferenceKey", async () => {
    const projection = storedProjection();
    const lookup = {
      findFindingProjection: jest.fn(async () => projection),
    };
    const resolver = new FindingReferenceResolver(lookup);

    await expect(
      resolver.resolve(selector({ featureId: "feature-2", featureOrdinal: 2 })),
    ).resolves.toMatchObject({
      status: "RESOLVED",
      focusRevision: 9,
      findingId: "finding-nearby",
      findingOrdinal: 1,
      featureId: "feature-2",
      featureOrdinal: 2,
      referenceIdentityHash: worldReferenceIdentityHash(keyTwo),
      knownWorldReference: {
        alias: "第二处",
        referenceKey: keyTwo,
        sourceMessageId: "message-2",
      },
    });
  });

  it("AC-M007/M009 clarifies a feature without ReferenceKey and rejects a bare array ordinal before lookup", async () => {
    const lookup = {
      findFindingProjection: jest.fn(async () => storedProjection()),
    };
    const resolver = new FindingReferenceResolver(lookup);

    await expect(
      resolver.resolve(selector({ featureId: "feature-3", featureOrdinal: 3 })),
    ).resolves.toEqual({
      status: "CLARIFY",
      reason: "STABLE_REFERENCE_REQUIRED",
    });
    await expect(
      resolver.resolve({ findingOrdinal: 2, featureOrdinal: 2 }),
    ).resolves.toEqual({
      status: "CLARIFY",
      reason: "INVALID_SELECTOR",
    });
    expect(lookup.findFindingProjection).toHaveBeenCalledTimes(1);
  });

  it("AC-M012/M013/M016 does not reveal cross-scope explanation existence", async () => {
    const lookup = {
      findFindingProjection: jest.fn(
        async (value: { principalId: string; threadId: string }) =>
          value.principalId === "principal-1" && value.threadId === "thread-1"
            ? storedProjection()
            : undefined,
      ),
    };
    const resolver = new FindingReferenceResolver(lookup);

    await expect(
      resolver.resolve(selector({ threadId: "thread-other" })),
    ).resolves.toEqual({
      status: "UNAVAILABLE",
      reason: "EXPLANATION_UNAVAILABLE",
    });
    await expect(
      resolver.resolve(selector({ principalId: "principal-other" })),
    ).resolves.toEqual({
      status: "UNAVAILABLE",
      reason: "EXPLANATION_UNAVAILABLE",
    });
  });

  it("fails closed on explanation hash, finding id, and ordinal mismatch", async () => {
    const resolver = new FindingReferenceResolver({
      findFindingProjection: async () => storedProjection(),
    });

    await expect(
      resolver.resolve(selector({ explanationHash: explanationHashPattern })),
    ).resolves.toEqual({
      status: "UNAVAILABLE",
      reason: "EXPLANATION_INTEGRITY_MISMATCH",
    });
    await expect(
      resolver.resolve(selector({ findingId: "finding-other" })),
    ).resolves.toEqual({
      status: "CLARIFY",
      reason: "FINDING_IDENTITY_MISMATCH",
    });
    await expect(
      resolver.resolve(selector({ findingOrdinal: 2 })),
    ).resolves.toEqual({
      status: "CLARIFY",
      reason: "FINDING_IDENTITY_MISMATCH",
    });
    await expect(
      resolver.resolve(
        selector({ featureId: "feature-other", featureOrdinal: 2 }),
      ),
    ).resolves.toEqual({
      status: "CLARIFY",
      reason: "FEATURE_IDENTITY_MISMATCH",
    });
  });

  it("AC-M015 requires revalidation for stale or expired projected references", async () => {
    const stale = storedProjection();
    const staleReference = stale.references[1];
    if (staleReference === undefined) throw new Error("missing fixture");
    const resolver = new FindingReferenceResolver({
      findFindingProjection: async () => ({
        ...stale,
        references: [
          {
            ...staleReference,
            focusReference: {
              ...staleReference.focusReference,
              status: "STALE",
              revalidationRequired: true,
            },
          },
        ],
      }),
    });

    await expect(
      resolver.resolve(selector({ featureId: "feature-2", featureOrdinal: 2 })),
    ).resolves.toMatchObject({
      status: "REVALIDATION_REQUIRED",
      reason: "REFERENCE_REVALIDATION_REQUIRED",
      knownWorldReference: {
        referenceKey: keyTwo,
      },
    });
  });

  it("AC-M019 never auto-selects an ambiguous finding-level projection", async () => {
    const resolver = new FindingReferenceResolver({
      findFindingProjection: async () => storedProjection(),
    });

    await expect(resolver.resolve(selector())).resolves.toEqual({
      status: "CLARIFY",
      reason: "AMBIGUOUS_REFERENCE",
    });
  });
});

describe("SACS v0.4 S20 MapSelection integrity validation", () => {
  it("AC-M010 accepts only a scoped, currently usable ReferenceKey", () => {
    const focus = worldFocus();
    expect(
      validateMapSelectionForFocus({
        principalId: focus.principalId,
        threadId: focus.threadId,
        focus,
        now: "2026-08-29T12:00:00.000Z",
        selection: {
          selectionId: "selection-ref",
          kind: "FEATURE",
          revision: 1,
          referenceKey: keyTwo,
        },
      }),
    ).toMatchObject({ status: "VALID", identity: "REFERENCE_KEY" });
    expect(
      validateMapSelectionForFocus({
        principalId: "principal-other",
        threadId: focus.threadId,
        focus,
        selection: {
          selectionId: "selection-cross-scope",
          kind: "FEATURE",
          revision: 1,
          referenceKey: keyTwo,
        },
      }),
    ).toEqual({
      status: "UNAVAILABLE",
      reason: "FOCUS_SCOPE_MISMATCH",
    });
    expect(
      validateMapSelectionForFocus({
        principalId: focus.principalId,
        threadId: focus.threadId,
        focus,
        now: "2026-08-29T12:00:00.000Z",
        selection: {
          selectionId: "selection-old-version",
          kind: "FEATURE",
          revision: 1,
          referenceKey: { ...keyTwo, version: "world-6" },
        },
      }),
    ).toEqual({
      status: "UNAVAILABLE",
      reason: "REFERENCE_REVALIDATION_REQUIRED",
    });
  });

  it("AC-M011 verifies a bounded canonical geometry hash without interpreting geometry", () => {
    const focus = worldFocus();
    const geometry = {
      arbitraryPublishedShape: { z: 1, a: [3, 2, 1] },
      type: "NotSpatiallyInterpretedHere",
    };
    const result = validateMapSelectionForFocus({
      principalId: focus.principalId,
      threadId: focus.threadId,
      focus,
      selection: {
        selectionId: "selection-geometry",
        kind: "AREA",
        revision: 1,
        geometry,
        geometryHash: hashCanonicalJson({
          type: "NotSpatiallyInterpretedHere",
          arbitraryPublishedShape: { a: [3, 2, 1], z: 1 },
        }),
      },
    });
    expect(result).toMatchObject({
      status: "VALID",
      identity: "GEOMETRY_HASH",
    });
  });

  it("rejects missing, mismatched, and oversized geometry hashes", () => {
    const focus = worldFocus();
    const common = {
      principalId: focus.principalId,
      threadId: focus.threadId,
      focus,
    };
    expect(
      validateMapSelectionForFocus({
        ...common,
        selection: {
          selectionId: "selection-no-hash",
          kind: "AREA",
          revision: 1,
          geometry: { type: "Polygon" },
        },
      }),
    ).toEqual({ status: "UNAVAILABLE", reason: "GEOMETRY_HASH_REQUIRED" });
    expect(
      validateMapSelectionForFocus({
        ...common,
        selection: {
          selectionId: "selection-bad-hash",
          kind: "AREA",
          revision: 1,
          geometry: { type: "Polygon" },
          geometryHash: "sha256:" + "f".repeat(64),
        },
      }),
    ).toEqual({ status: "UNAVAILABLE", reason: "GEOMETRY_HASH_MISMATCH" });
    const oversized = { payload: "x".repeat(MAP_SELECTION_MAX_GEOMETRY_BYTES) };
    expect(
      validateMapSelectionForFocus({
        ...common,
        selection: {
          selectionId: "selection-too-large",
          kind: "AREA",
          revision: 1,
          geometry: oversized,
          geometryHash: hashCanonicalJson(oversized),
        },
      }),
    ).toEqual({ status: "UNAVAILABLE", reason: "GEOMETRY_TOO_LARGE" });
  });
});

function selector(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const explanation = explanationFixture();
  return {
    principalId: "principal-1",
    threadId: "thread-1",
    explanationId: explanation.explanationId,
    explanationHash: explanation.explanationHash,
    findingId: "finding-nearby",
    findingOrdinal: 1,
    now: "2026-08-29T12:00:00.000Z",
    ...overrides,
  };
}

function storedProjection(): ScopedFindingProjection {
  return {
    focusRevision: 9,
    explanation: explanationFixture(),
    references: [
      projectedReference("第一处", "message-1", keyOne),
      projectedReference("第二处", "message-2", keyTwo),
    ],
  };
}

function projectedReference(
  displayName: string,
  sourceMessageId: string,
  referenceKey: typeof keyOne,
) {
  const explanation = explanationFixture();
  return {
    sourceMessageId,
    focusReference: {
      referenceIdentityHash: worldReferenceIdentityHash(referenceKey),
      referenceKey,
      productId: "product-" + referenceKey.id.slice(-1),
      displayName,
      referenceType: "derived-feature",
      sourceGroundingId: explanation.grounding.groundingId,
      sourceResultHash: explanation.grounding.resultHash,
      sourceWorldVersion: 7,
      sourceExplanationId: explanation.explanationId,
      sourceExplanationHash: explanation.explanationHash,
      sourceFindingId: "finding-nearby",
      sourceFindingOrdinal: 1,
      validUntil: "2026-08-29T13:00:00.000Z",
      revalidationRequired: false,
      status: "VALID" as const,
      lastUsedAt: "2026-08-29T11:00:00.000Z",
    },
  };
}

function worldFocus(): ConversationWorldFocus {
  const explanation = explanationFixture();
  return {
    schemaVersion: "1.0",
    principalId: "principal-1",
    threadId: "thread-1",
    revision: 9,
    lastGroundingId: explanation.grounding.groundingId,
    lastGroundingResultHash: explanation.grounding.resultHash,
    lastExplanationId: explanation.explanationId,
    lastExplanationHash: explanation.explanationHash,
    references: storedProjection().references.map(
      ({ focusReference }) => focusReference,
    ),
    updatedAt: "2026-08-29T11:00:00.000Z",
  };
}

function explanationFixture(): WorldExplanationV1 {
  return finalizeWorldExplanation({
    schemaVersion: "sacs-world-explanation/1.0",
    explanationId: "explanation-nearby",
    locale: "zh-CN",
    grounding: {
      groundingId: "grounding-nearby",
      resultHash,
      status: "COMPLETED",
    },
    explanationStatus: "COMPLETE",
    questionKind: "FEATURES_NEARBY",
    renderedText: "附近有三处要素。",
    findings: [
      {
        findingId: "finding-nearby",
        findingKind: "SPATIAL_FEATURE_COLLECTION",
        semanticConcept: "nearby_feature",
        headline: "附近要素",
        details: [],
        returnedCount: 3,
        truncated: false,
        featureSummaries: [
          {
            featureId: "feature-1",
            displayName: "第一处",
            referenceKey: keyOne,
          },
          {
            featureId: "feature-2",
            displayName: "第二处",
            referenceKey: keyTwo,
          },
          { featureId: "feature-3", displayName: "第三处" },
        ],
        evidenceItemIds: ["evidence-1"],
        sourceProductIds: [],
      },
    ],
    references: [],
    sourceProducts: [],
    gaps: [],
    mapProjection: {
      schemaVersion: "sacs-map-projection/1.0",
      features: [
        {
          projectionId: "projection-1",
          findingId: "finding-nearby",
          featureId: "feature-1",
          semanticRole: "RESULT",
          referenceKey: keyOne,
        },
        {
          projectionId: "projection-2",
          findingId: "finding-nearby",
          featureId: "feature-2",
          semanticRole: "RESULT",
          referenceKey: keyTwo,
        },
        {
          projectionId: "projection-3",
          findingId: "finding-nearby",
          featureId: "feature-3",
          semanticRole: "RESULT",
          geometry: { type: "Point", coordinates: [0, 0] },
        },
      ],
      truncated: false,
    },
    provenance: {
      evidenceItemIds: ["evidence-1"],
      receiptIds: [],
      operationKeys: ["feature.nearby@1.0"],
      consumerLockHash: "sha256:" + "3".repeat(64),
      findingProfileHash: "sha256:" + "4".repeat(64),
      rendererPolicyHash: "sha256:" + "5".repeat(64),
    },
    createdAt: "2026-08-29T11:00:00.000Z",
  });
}
