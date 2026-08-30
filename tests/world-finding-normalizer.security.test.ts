import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
  type WorldFinding,
} from "../packages/world-explanation-contract/src/index.js";
import { normalizeWsgsGeospatialExtension } from "../packages/world-explanation-runtime/src/index.js";
import {
  extension,
  normalizationInput,
  pointMeasurement,
  sha,
  sixFindings,
  sourceProduct,
} from "./world-explanation-fixtures.js";

describe("S16 WorldFinding hostile-input safety", () => {
  it("turns an unknown kind into an unsupported-schema gap without a fact", () => {
    const unknown = {
      findingId: "finding-unknown-1",
      findingKind: "ATTACKER_FACT",
      semanticConcept: "TASK_FAILED",
      querySemantics: "FREE_TEXT",
      status: "COMPLETED",
      evidenceItemIds: ["evidence-1"],
      sourceProductIds: ["source-slope-current"],
      safePayload: {
        conclusion: "Task failed and route is impossible",
      },
    };
    const normalized = normalizeWsgsGeospatialExtension(
      normalizationInput(extension([unknown])),
    );
    expect(normalized.findings).toEqual([]);
    expect(normalized.gaps).toEqual([
      expect.objectContaining({
        gapKind: "UNSUPPORTED_FINDING_SCHEMA",
        evidenceItemIds: ["evidence-1"],
      }),
    ]);
    expect(JSON.stringify(normalized)).not.toContain("route is impossible");
  });

  it("never accepts a generic safePayload as an extension-level fact source", () => {
    expect(() =>
      normalizeWsgsGeospatialExtension(
        normalizationInput({
          ...extension(),
          safePayload: { value: "fabricated" },
        }),
      ),
    ).toThrow("INVALID_EXTENSION_ENVELOPE");
  });

  it("rejects prototype-pollution keys before object reconstruction", () => {
    const unsafeFinding = JSON.parse(
      '{"findingId":"finding-unsafe","findingKind":"CATALOG","__proto__":{"polluted":true}}',
    ) as object;
    expect(() =>
      normalizeWsgsGeospatialExtension(
        normalizationInput({
          ...extension(),
          findings: [unsafeFinding],
          findingSetHash: sha("f"),
        }),
      ),
    ).toThrow("UNSAFE_METADATA_KEY");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("rejects asset/provider/secret metadata instead of exposing it", () => {
    for (const forbidden of [
      { assetUri: "file:///private/raster.tif" },
      { providerUrl: "http://internal-provider/query" },
      { token: "private-token" },
    ]) {
      expect(() =>
        normalizeWsgsGeospatialExtension(
          normalizationInput(
            extension(
              [pointMeasurement()],
              [{ ...sourceProduct(), qualitySummary: forbidden }],
            ),
          ),
        ),
      ).toThrow("UNSAFE_METADATA_KEY");
    }
  });

  it("drops oversized inline geometry in favor of a published ReferenceKey", () => {
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
          geometry: {
            type: "Polygon",
            coordinates: ["x".repeat(2_000)],
          },
        },
      ],
    } satisfies WorldFinding;
    const normalized = normalizeWsgsGeospatialExtension({
      ...normalizationInput(extension([finding])),
      limits: {
        ...DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY.limits,
        maxInlineGeometryBytes: 128,
      },
    });
    const retained = normalized.findings[0];
    expect(
      retained?.findingKind === "SPATIAL_FEATURE_COLLECTION"
        ? retained.features[0]
        : undefined,
    ).toMatchObject({ referenceKey: feature.referenceKey });
    expect(
      retained?.findingKind === "SPATIAL_FEATURE_COLLECTION"
        ? retained.features[0]
        : undefined,
    ).not.toHaveProperty("geometry");
    expect(normalized.report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "GEOMETRY_LIMIT_EXCEEDED" }),
      ]),
    );
  });

  it("removes URI-shaped payload refs and never promotes unknown attributes", () => {
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
          payloadRef: "https://internal.example/private",
          publishedAttributes: { injectedConclusion: "TASK_FAILED" },
        },
      ],
    } as WorldFinding;
    const normalized = normalizeWsgsGeospatialExtension(
      normalizationInput(extension([finding])),
    );
    const retained = normalized.findings[0];
    expect(
      retained?.findingKind === "SPATIAL_FEATURE_COLLECTION"
        ? retained.features[0]
        : undefined,
    ).not.toHaveProperty("payloadRef");
  });
});
