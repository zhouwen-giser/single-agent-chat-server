import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
  mapProjectionFeatureSchema,
  type ExplanationGap,
  type GroundingIdentity,
  type WorldFinding,
} from "../packages/world-explanation-contract/src/index.js";
import {
  assembleMapProjection,
  assembleWorldExplanation,
  determineExplanationStatus,
  determineQuestionKind,
  resolveExplanationLocale,
} from "../packages/world-explanation-runtime/src/index.js";
import {
  assemblyInput,
  pointMeasurement,
  sixFindings,
} from "./world-explanation-fixtures.js";

describe("S17 WorldExplanation assembler", () => {
  it("classifies typed findings without reading free-form payloads", () => {
    const expected = [
      "POINT_VALUE",
      "POINT_CLASSIFICATION",
      "FEATURES_IN_AREA",
      "PROFILE",
      "QUALIFIED_EXPLANATION",
      "REFERENCE_RESOLUTION",
    ];
    expect(
      sixFindings().map((finding) => determineQuestionKind([finding], [])),
    ).toEqual(expected);
    expect(determineQuestionKind(sixFindings().slice(0, 2), [])).toBe(
      "MULTI_FINDING",
    );
    expect(
      determineQuestionKind(
        [],
        [gap("REFERENCE_AMBIGUITY", "REFERENCE_AMBIGUOUS")],
      ),
    ).toBe("REFERENCE_RESOLUTION");
  });

  it("maps grounding and gap states without treating no data as false", () => {
    const completed: GroundingIdentity = {
      groundingId: "grounding-1",
      resultHash: assemblyInput().grounding.resultHash,
      status: "COMPLETED",
    };
    expect(
      determineExplanationStatus(
        completed,
        [],
        [gap("DATA_GAP", "PRODUCT_NOT_AVAILABLE")],
      ),
    ).toBe("DATA_UNAVAILABLE");
    expect(
      determineExplanationStatus(
        completed,
        [pointMeasurement()],
        [gap("TRUNCATED", "TRUNCATED")],
      ),
    ).toBe("PARTIAL");
    expect(
      determineExplanationStatus({ ...completed, status: "AMBIGUOUS" }, [], []),
    ).toBe("CLARIFICATION_REQUIRED");
    expect(
      determineExplanationStatus({ ...completed, status: "CANCELLED" }, [], []),
    ).toBe("CANCELLED");
  });

  it("builds one immutable explanation identity and sanitized source projection", () => {
    const first = assembleWorldExplanation(assemblyInput());
    const second = assembleWorldExplanation(assemblyInput());
    expect(second).toEqual(first);
    expect(first.explanationHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.sourceProducts[0]).toEqual(
      expect.not.objectContaining({ evidenceItemIds: expect.anything() }),
    );
    expect(first.provenance.evidenceItemIds).toEqual(["evidence-1"]);
  });

  it("copies one map locator without calculating geometry", () => {
    const collection = sixFindings()[2];
    if (collection?.findingKind !== "SPATIAL_FEATURE_COLLECTION") {
      throw new Error("fixture kind changed");
    }
    const projection = assembleMapProjection([collection]);
    expect(projection?.features).toHaveLength(1);
    const feature = projection?.features[0];
    expect(feature).toHaveProperty("geometry");
    expect(feature).not.toHaveProperty("referenceKey");
    expect(feature).not.toHaveProperty("payloadRef");
    expect(mapProjectionFeatureSchema.parse(feature)).toEqual(feature);
    expect(
      feature !== undefined && "geometry" in feature
        ? feature.geometry
        : undefined,
    ).toEqual(collection.features[0]?.geometry);
  });

  it("falls back from oversized geometry to an existing ReferenceKey", () => {
    const collection = sixFindings()[2];
    if (collection?.findingKind !== "SPATIAL_FEATURE_COLLECTION") {
      throw new Error("fixture kind changed");
    }
    const feature = collection.features[0];
    if (feature === undefined) throw new Error("fixture feature missing");
    const finding = {
      ...collection,
      features: [
        {
          ...feature,
          geometry: { huge: "x".repeat(1_000) },
        },
      ],
    } as WorldFinding;
    const projection = assembleMapProjection([finding], {
      ...DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
      limits: {
        ...DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY.limits,
        maxInlineGeometryBytes: 64,
      },
    });
    expect(projection?.features[0]).toHaveProperty("referenceKey");
    expect(projection?.features[0]).not.toHaveProperty("geometry");
    expect(projection?.warnings).toContain("INLINE_GEOMETRY_OMITTED");
  });

  it("chooses explicit locale before deterministic script detection", () => {
    expect(resolveExplanationLocale("en-US", "坡度")).toBe("en-US");
    expect(resolveExplanationLocale(undefined, "坡度")).toBe("zh-CN");
    expect(resolveExplanationLocale(undefined, "slope")).toBe("en");
  });
});

function gap(
  gapKind: ExplanationGap["gapKind"],
  messageCode: string,
): ExplanationGap {
  return {
    gapId: "gap-" + gapKind.toLowerCase().replaceAll("_", "-"),
    gapKind,
    severity: "WARNING",
    messageCode,
  };
}
