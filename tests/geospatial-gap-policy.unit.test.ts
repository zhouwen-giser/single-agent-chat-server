import { describe, expect, it } from "@jest/globals";

import {
  geospatialGapDecisionSchema,
  geospatialGapMappingInputSchema,
  mapGeospatialGapSituation,
  type GeospatialUpstreamSituation,
} from "../packages/geospatial-explanation-policy/src/index.js";

describe("S21 geospatial gap semantics", () => {
  it.each<
    readonly [GeospatialUpstreamSituation, string, string | undefined, string]
  >([
    ["NORMAL_FINDING", "COMPLETE", undefined, "UPSTREAM_FINDING_AVAILABLE"],
    [
      "COMPLETED_EMPTY_COLLECTION",
      "COMPLETE",
      undefined,
      "NO_MATCH_IN_CURRENT_DATA",
    ],
    ["NO_DATA", "DATA_UNAVAILABLE", "DATA_GAP", "NO_DATA_NOT_ABSENCE"],
    ["TRUNCATED", "PARTIAL", "TRUNCATED", "RESULT_TRUNCATED"],
    [
      "PRODUCT_NOT_AVAILABLE",
      "DATA_UNAVAILABLE",
      "DATA_GAP",
      "PRODUCT_NOT_AVAILABLE",
    ],
    [
      "PRODUCT_COVERAGE_INSUFFICIENT",
      "DATA_UNAVAILABLE",
      "COVERAGE_GAP",
      "PRODUCT_COVERAGE_INSUFFICIENT",
    ],
    [
      "CAPABILITY_UNAVAILABLE",
      "DATA_UNAVAILABLE",
      "CAPABILITY_GAP",
      "CAPABILITY_UNAVAILABLE",
    ],
    [
      "REFERENCE_AMBIGUOUS",
      "CLARIFICATION_REQUIRED",
      "REFERENCE_AMBIGUITY",
      "REFERENCE_AMBIGUOUS",
    ],
    [
      "AMBIGUOUS_PRODUCT_SELECTION",
      "CLARIFICATION_REQUIRED",
      "PRODUCT_SELECTION_AMBIGUITY",
      "AMBIGUOUS_PRODUCT_SELECTION",
    ],
    [
      "SOURCE_CHANGED_DURING_QUERY",
      "PARTIAL",
      "SOURCE_CHANGED",
      "SOURCE_CHANGED_DURING_QUERY",
    ],
    [
      "UNKNOWN_FINDING_SCHEMA",
      "PARTIAL",
      "UNSUPPORTED_FINDING_SCHEMA",
      "UNKNOWN_FINDING_SCHEMA",
    ],
    [
      "EVIDENCE_INCOMPLETE",
      "PARTIAL",
      "EVIDENCE_INCOMPLETE",
      "EVIDENCE_INCOMPLETE",
    ],
    [
      "CURRENTNESS_UNAVAILABLE",
      "DATA_UNAVAILABLE",
      "CURRENTNESS_UNAVAILABLE",
      "CURRENTNESS_UNAVAILABLE",
    ],
    [
      "PROVIDER_OR_PROTOCOL_FAILURE",
      "FAILED",
      "UPSTREAM_FAILURE",
      "UPSTREAM_FAILURE",
    ],
  ])(
    "maps %s without absence inference",
    (upstream, explanationStatus, gapKind, messageCode) => {
      const decision = mapGeospatialGapSituation({
        upstream,
        gapId: "gap-1",
        semanticConcept: "ROAD_WATER",
        findingIds: ["finding-1"],
        evidenceItemIds: ["evidence-1"],
      });
      expect(decision).toMatchObject({
        upstream,
        explanationStatus,
        messageCode,
        absenceInferenceAllowed: false,
      });
      expect(decision.gap?.gapKind).toBe(gapKind);
    },
  );

  it("distinguishes an observed empty collection from unavailable NO_DATA", () => {
    const empty = mapGeospatialGapSituation({
      upstream: "COMPLETED_EMPTY_COLLECTION",
      gapId: "gap-empty",
    });
    const unavailable = mapGeospatialGapSituation({
      upstream: "NO_DATA",
      gapId: "gap-no-data",
    });
    expect(empty).toMatchObject({
      explanationStatus: "COMPLETE",
      assertionScope: "CURRENT_QUERY_RESULT_ONLY",
      messageCode: "NO_MATCH_IN_CURRENT_DATA",
      absenceInferenceAllowed: false,
    });
    expect(empty.gap).toBeUndefined();
    expect(unavailable).toMatchObject({
      explanationStatus: "DATA_UNAVAILABLE",
      assertionScope: "UNAVAILABLE",
      gap: { gapKind: "DATA_GAP" },
      absenceInferenceAllowed: false,
    });
  });

  it("uses a strict input boundary", () => {
    expect(() =>
      geospatialGapMappingInputSchema.parse({
        upstream: "NO_DATA",
        gapId: "gap-1",
        inferredAbsence: true,
      }),
    ).toThrow();
    const decision = mapGeospatialGapSituation({
      upstream: "NO_DATA",
      gapId: "gap-1",
    });
    expect(() =>
      geospatialGapDecisionSchema.parse({
        ...decision,
        explanationStatus: "COMPLETE",
      }),
    ).toThrow();
  });
});
