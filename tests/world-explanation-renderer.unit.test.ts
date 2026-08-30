import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
  type ExplanationGap,
  type QualifiedExplanationFinding,
  type RendererPolicy,
  type SpatialFeatureCollectionFinding,
} from "../packages/world-explanation-contract/src/index.js";
import {
  assembleWorldExplanation,
  normalizeWsgsGeospatialExtension,
} from "../packages/world-explanation-runtime/src/index.js";
import {
  assemblyInput,
  extension,
  normalizationInput,
  pointMeasurement,
  sixFindings,
} from "./world-explanation-fixtures.js";

describe("S17 deterministic WorldExplanation renderer", () => {
  it("renders the published value and unit deterministically in Chinese and English", () => {
    const finding = pointMeasurement({ confidence: 0.912345 });
    const chinese = assembleWorldExplanation(assemblyInput([finding], "zh-CN"));
    const english = assembleWorldExplanation(assemblyInput([finding], "en-US"));

    expect(chinese.renderedText).toContain(
      "根据当前数据，2号车的SLOPE为 12.6 degree。",
    );
    expect(english.renderedText).toContain(
      "According to the current data, 2号车 SLOPE is 12.6 degree.",
    );
    expect(chinese.renderedText).toContain(
      "质量信息：valueAccuracyDegree=1.5。",
    );
    expect(english.renderedText).toContain("Quality: valueAccuracyDegree=1.5.");
    expect(chinese.renderedText).not.toContain("0.912345");
    expect(chinese.renderedText).not.toMatch(/confidence/iu);
    expect(assembleWorldExplanation(assemblyInput([finding], "zh-CN"))).toEqual(
      chinese,
    );
  });

  it("reports a published class without inferring passability or other facts", () => {
    const classification = sixFindings()[1];
    if (classification?.findingKind !== "POINT_CLASSIFICATION") {
      throw new Error("fixture kind changed");
    }
    const explanation = assembleWorldExplanation(
      assemblyInput([classification], "zh-CN"),
    );

    expect(explanation.renderedText).toContain("LAND\\_COVER分类为 湿地");
    expect(explanation.renderedText).not.toMatch(/可通行|不可通行|安全|危险/iu);
  });

  it("bounds feature summaries and describes an empty collection as current-data no-match", () => {
    const featureCollection = collectionFinding(6);
    const explanation = assembleWorldExplanation(
      assemblyInput([featureCollection], "en-US"),
    );
    expect(explanation.findings[0]?.featureSummaries).toHaveLength(5);
    expect(explanation.renderedText).toContain(
      "According to the current data, 6 objects related to HIGH\\_GROUND were found.",
    );

    const empty = {
      ...featureCollection,
      findingId: "finding-features-empty",
      returnedCount: 0,
      features: [],
    } satisfies SpatialFeatureCollectionFinding;
    const emptyExplanation = assembleWorldExplanation(
      assemblyInput([empty], "en-US"),
    );
    expect(emptyExplanation.renderedText).toContain(
      "No matching objects were found in the currently available data and query extent.",
    );
    expect(emptyExplanation.renderedText).not.toContain("do not exist");
  });

  const gapCases: Array<[ExplanationGap["gapKind"], string]> = [
    ["DATA_GAP", "No current data product is available"],
    ["COVERAGE_GAP", "does not fully cover the query extent"],
    ["CAPABILITY_GAP", "cannot perform this analysis"],
    ["REFERENCE_AMBIGUITY", "referenced object is ambiguous"],
    ["PRODUCT_SELECTION_AMBIGUITY", "data product is ambiguous"],
    ["SOURCE_CHANGED", "source changed during the query"],
    ["TRUNCATED", "only partial content is shown"],
    ["UNSUPPORTED_FINDING_SCHEMA", "cannot be interpreted safely"],
    ["EVIDENCE_INCOMPLETE", "lacked closed evidence"],
    ["UPSTREAM_FAILURE", "upstream world query failed"],
    ["CURRENTNESS_UNAVAILABLE", "currentness cannot be verified"],
  ];

  it.each(gapCases)(
    "renders %s with bounded deterministic wording",
    (kind, text) => {
      const input = assemblyInput([], "en-US");
      const explanation = assembleWorldExplanation({
        ...input,
        normalized: {
          ...input.normalized,
          gaps: [gap(kind)],
        },
      });
      expect(explanation.renderedText.toLowerCase()).toContain(
        text.toLowerCase(),
      );
    },
  );

  it("escapes active text, removes controls, and redacts obvious credentials", () => {
    const finding: QualifiedExplanationFinding = {
      findingId: "finding-qualified-hostile",
      findingKind: "QUALIFIED_EXPLANATION",
      semanticConcept: "PUBLISHED_REASON",
      querySemantics: "QUALIFIED_EXPLANATION",
      status: "COMPLETED",
      evidenceItemIds: ["evidence-1"],
      sourceProductIds: ["source-slope-current"],
      explanationCode: "PUBLISHED_REASON",
      summary:
        "<script>alert(1)</script> Bearer very-secret token=also-secret [click](https://invalid.example)\u0000",
      reasonCodes: ["PUBLISHED"],
    };
    const explanation = assembleWorldExplanation(
      assemblyInput([finding], "en-US"),
    );

    expect(explanation.renderedText).toContain("&lt;script&gt;");
    expect(explanation.renderedText).toContain("Bearer \\[REDACTED\\]");
    expect(explanation.renderedText).not.toContain("<script>");
    expect(explanation.renderedText).not.toContain("very-secret");
    expect(explanation.renderedText).not.toContain("also-secret");
    expect(explanation.renderedText).not.toContain("\u0000");
  });

  it("renders catalogs as catalogs and never exposes structured identities as prose", () => {
    const catalog = sixFindings()[5];
    if (catalog?.findingKind !== "CATALOG") {
      throw new Error("fixture kind changed");
    }
    const explanation = assembleWorldExplanation(
      assemblyInput([catalog], "en-US"),
    );
    expect(explanation.renderedText).toContain(
      "The current catalog returned 1 entries.",
    );
    expect(explanation.renderedText).not.toContain("reference-vehicle-2");
    expect(explanation.renderedText).not.toContain("sha256:");
    expect(explanation.renderedText).not.toContain("gdps-baseline-slope");
  });

  it("enforces the configured rendered-character ceiling without changing typed facts", () => {
    const finding: QualifiedExplanationFinding = {
      findingId: "finding-qualified-long",
      findingKind: "QUALIFIED_EXPLANATION",
      semanticConcept: "PUBLISHED_REASON",
      querySemantics: "QUALIFIED_EXPLANATION",
      status: "COMPLETED",
      evidenceItemIds: ["evidence-1"],
      sourceProductIds: ["source-slope-current"],
      explanationCode: "PUBLISHED_REASON",
      summary: "published ".repeat(200),
      reasonCodes: ["PUBLISHED"],
    };
    const policy: RendererPolicy = {
      ...DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
      limits: {
        ...DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY.limits,
        maxRenderedCharacters: 64,
      },
    };
    const explanation = assembleWorldExplanation({
      ...assemblyInput([finding], "en-US"),
      rendererPolicy: policy,
    });

    expect(Array.from(explanation.renderedText)).toHaveLength(64);
    expect(explanation.renderedText.endsWith("…")).toBe(true);
    expect(explanation.findings[0]?.semanticConcept).toBe("PUBLISHED_REASON");
  });

  it("does not inspect a generic safePayload when normalizing unknown findings", () => {
    const unknownFinding = {
      findingId: "finding-unknown",
      findingKind: "FUTURE_AI_SUMMARY",
      semanticConcept: "SLOPE",
      querySemantics: "READ_VALUE",
      status: "COMPLETED",
      evidenceItemIds: ["evidence-1"],
      sourceProductIds: ["source-slope-current"],
      safePayload: {
        answer: "The slope is definitely 999 degrees.",
      },
    };
    const normalized = normalizeWsgsGeospatialExtension(
      normalizationInput(extension([unknownFinding])),
    );
    const explanation = assembleWorldExplanation({
      ...assemblyInput(),
      normalized,
    });

    expect(explanation.findings).toEqual([]);
    expect(explanation.renderedText).not.toContain("999");
    expect(explanation.renderedText).toContain("上游结果格式当前无法安全解释");
  });
});

function collectionFinding(count: number): SpatialFeatureCollectionFinding {
  return {
    findingId: "finding-features-many",
    findingKind: "SPATIAL_FEATURE_COLLECTION",
    semanticConcept: "HIGH_GROUND",
    querySemantics: "FEATURES_IN_AREA",
    status: "COMPLETED",
    evidenceItemIds: ["evidence-1"],
    sourceProductIds: ["source-slope-current"],
    returnedCount: count,
    truncated: false,
    features: Array.from({ length: count }, (_, index) => ({
      featureId: "feature-" + String(index + 1),
      displayName: "Feature " + String(index + 1),
      classCode: "HIGH_GROUND",
    })),
  };
}

function gap(gapKind: ExplanationGap["gapKind"]): ExplanationGap {
  return {
    gapId: "gap-" + gapKind.toLowerCase().replaceAll("_", "-"),
    gapKind,
    severity: "WARNING",
    messageCode: gapKind,
  };
}
