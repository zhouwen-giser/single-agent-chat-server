import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
  type WorldFinding,
} from "../packages/world-explanation-contract/src/index.js";
import {
  WorldFindingNormalizationError,
  normalizeWsgsGeospatialExtension,
} from "../packages/world-explanation-runtime/src/index.js";
import {
  extension,
  normalizationInput,
  pointMeasurement,
  sha,
  sixFindings,
  sourceProduct,
} from "./world-explanation-fixtures.js";

describe("S16 strict WorldFinding normalizer", () => {
  it("normalizes all six typed finding kinds deterministically", () => {
    const input = normalizationInput(extension(sixFindings()));
    const first = normalizeWsgsGeospatialExtension(input);
    const second = normalizeWsgsGeospatialExtension(input);
    expect(first).toEqual(second);
    expect(first.findings).toHaveLength(6);
    expect(first.report).toMatchObject({
      status: "PASS",
      findingCount: 6,
      sourceProductCount: 1,
    });
  });

  it("rejects profile and set hash mismatches", () => {
    expect(() =>
      normalizeWsgsGeospatialExtension({
        ...normalizationInput(),
        expectedProfileSchemaHash: sha("f"),
      }),
    ).toThrow("PROFILE_HASH_MISMATCH");
    expect(() =>
      normalizeWsgsGeospatialExtension(
        normalizationInput({
          ...extension(),
          findingSetHash: sha("f"),
        }),
      ),
    ).toThrow("FINDING_SET_HASH_MISMATCH");
  });

  it("rejects duplicate finding and source-product identities", () => {
    const finding = pointMeasurement();
    expect(() =>
      normalizeWsgsGeospatialExtension(
        normalizationInput(extension([finding, finding])),
      ),
    ).toThrow("DUPLICATE_FINDING_ID");
    const product = sourceProduct();
    expect(() =>
      normalizeWsgsGeospatialExtension(
        normalizationInput(extension([finding], [product, product])),
      ),
    ).toThrow("DUPLICATE_SOURCE_PRODUCT_ID");
  });

  it("drops findings whose evidence, source, or reference links do not close", () => {
    const cases: WorldFinding[] = [
      pointMeasurement({ evidenceItemIds: ["missing-evidence"] }),
      pointMeasurement({ sourceProductIds: ["missing-source"] }),
      pointMeasurement({
        subjectReferenceProductIds: ["missing-reference"],
      }),
    ];
    for (const finding of cases) {
      const normalized = normalizeWsgsGeospatialExtension(
        normalizationInput(extension([finding])),
      );
      expect(normalized.findings).toHaveLength(0);
      expect(normalized.gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ gapKind: "EVIDENCE_INCOMPLETE" }),
        ]),
      );
      expect(normalized.report.status).toBe("PARTIAL");
    }
  });

  it("drops malformed known findings and never turns them into facts", () => {
    const malformed = {
      ...pointMeasurement(),
      point: { type: "Point", coordinates: [999, 999] },
      value: "not-a-number",
    };
    const normalized = normalizeWsgsGeospatialExtension(
      normalizationInput(extension([malformed])),
    );
    expect(normalized.findings).toEqual([]);
    expect(normalized.gaps[0]).toMatchObject({
      gapKind: "UNSUPPORTED_FINDING_SCHEMA",
    });
  });

  it("enforces feature count parity and profile sample order", () => {
    const featureCollection = sixFindings()[2];
    const profile = sixFindings()[3];
    if (
      featureCollection?.findingKind !== "SPATIAL_FEATURE_COLLECTION" ||
      profile?.findingKind !== "PROFILE"
    ) {
      throw new Error("fixture kinds changed");
    }
    const inconsistent = {
      ...featureCollection,
      returnedCount: 0,
    };
    const unordered = {
      ...profile,
      samples: [
        { distanceM: 10, value: 1 },
        { distanceM: 5, value: 2 },
      ],
    };
    for (const finding of [inconsistent, unordered]) {
      const normalized = normalizeWsgsGeospatialExtension(
        normalizationInput(extension([finding])),
      );
      expect(normalized.findings).toEqual([]);
      expect(normalized.report.issues).toHaveLength(1);
    }
  });

  it("bounds feature collections with an explicit truncation gap", () => {
    const featureCollection = sixFindings()[2];
    if (featureCollection?.findingKind !== "SPATIAL_FEATURE_COLLECTION") {
      throw new Error("fixture kind changed");
    }
    const features = [
      featureCollection.features[0],
      {
        ...featureCollection.features[0],
        featureId: "feature-high-2",
      },
    ];
    const finding = {
      ...featureCollection,
      returnedCount: 2,
      features,
    };
    const normalized = normalizeWsgsGeospatialExtension({
      ...normalizationInput(extension([finding])),
      limits: {
        ...DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY.limits,
        maxFeaturesPerFinding: 1,
      },
    });
    const retained = normalized.findings[0];
    expect(retained).toMatchObject({ status: "PARTIAL", truncated: true });
    expect(
      retained?.findingKind === "SPATIAL_FEATURE_COLLECTION"
        ? retained.features
        : [],
    ).toHaveLength(1);
    expect(normalized.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gapKind: "TRUNCATED" }),
      ]),
    );
  });

  it("fails closed on foreign current-product scope", () => {
    expect(() =>
      normalizeWsgsGeospatialExtension({
        ...normalizationInput(),
        authorizedProductIds: ["different-product"],
      }),
    ).toThrow(WorldFindingNormalizationError);
  });
});
