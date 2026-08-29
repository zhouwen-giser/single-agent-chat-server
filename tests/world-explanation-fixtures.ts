import {
  DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
  hashCanonicalJson,
  hashRendererPolicy,
  type ExplanationReference,
  type Sha256,
  type SourceProduct,
  type WorldFinding,
} from "../packages/world-explanation-contract/src/index.js";
import {
  normalizeWsgsGeospatialExtension,
  type NormalizeWsgsGeospatialExtensionInput,
  type WorldExplanationAssemblyInput,
} from "../packages/world-explanation-runtime/src/index.js";

export const profileHash = sha("a");
export const resultHash = sha("b");
export const consumerLockHash = sha("c");
export const rendererPolicyHash = hashRendererPolicy(
  DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
);

export function sha(character: string): Sha256 {
  return ("sha256:" + character.repeat(64)) as Sha256;
}

export function sourceProduct(
  overrides: Partial<SourceProduct> = {},
): SourceProduct {
  return {
    sourceProductId: "source-slope-current",
    authority: "GDPS_CURRENT_PRODUCT",
    productId: "gdps-baseline-slope",
    productType: "SLOPE",
    productProfile: "DEGREE",
    contentHash: sha("1"),
    descriptorId: "SLOPE:DEGREE",
    descriptorHash: sha("2"),
    dataTime: "2026-08-29T00:00:00Z",
    qualitySummary: { valueAccuracyDegree: 1.5 },
    evidenceItemIds: ["evidence-1"],
    ...overrides,
  };
}

export function pointMeasurement(
  overrides: Record<string, unknown> = {},
): WorldFinding {
  return {
    findingId: "finding-slope-1",
    findingKind: "POINT_MEASUREMENT",
    semanticConcept: "SLOPE",
    querySemantics: "READ_VALUE",
    status: "COMPLETED",
    subjectReferenceProductIds: ["reference-vehicle-2"],
    evidenceItemIds: ["evidence-1"],
    sourceProductIds: ["source-slope-current"],
    point: { type: "Point", coordinates: [113.934, 22.544] },
    value: 12.6,
    unit: "degree",
    ...overrides,
  } as WorldFinding;
}

export function sixFindings(): WorldFinding[] {
  return [
    pointMeasurement(),
    {
      findingId: "finding-class-1",
      findingKind: "POINT_CLASSIFICATION",
      semanticConcept: "LAND_COVER",
      querySemantics: "POINT_CLASSIFICATION",
      status: "COMPLETED",
      evidenceItemIds: ["evidence-1"],
      sourceProductIds: ["source-slope-current"],
      point: { type: "Point", coordinates: [113.934, 22.544] },
      classCode: "WETLAND",
      classLabel: "湿地",
    },
    {
      findingId: "finding-features-1",
      findingKind: "SPATIAL_FEATURE_COLLECTION",
      semanticConcept: "HIGH_GROUND",
      querySemantics: "FEATURES_IN_AREA",
      status: "COMPLETED",
      evidenceItemIds: ["evidence-1"],
      sourceProductIds: ["source-slope-current"],
      returnedCount: 1,
      truncated: false,
      features: [
        {
          featureId: "feature-high-1",
          displayName: "高地候选1",
          referenceKey: {
            namespace: "gowm",
            kind: "DERIVED_REFERENCE",
            id: "wrf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            version: "1",
          },
          geometry: {
            type: "Point",
            coordinates: [113.935, 22.545],
          },
        },
      ],
    },
    {
      findingId: "finding-profile-1",
      findingKind: "PROFILE",
      semanticConcept: "ELEVATION",
      querySemantics: "PROFILE",
      status: "COMPLETED",
      evidenceItemIds: ["evidence-1"],
      sourceProductIds: ["source-slope-current"],
      unit: "m",
      samples: [
        { distanceM: 0, value: 10 },
        { distanceM: 100, value: 12 },
      ],
      truncated: false,
    },
    {
      findingId: "finding-explanation-1",
      findingKind: "QUALIFIED_EXPLANATION",
      semanticConcept: "PASSABILITY_CLASS",
      querySemantics: "QUALIFIED_EXPLANATION",
      status: "COMPLETED",
      evidenceItemIds: ["evidence-1"],
      sourceProductIds: ["source-slope-current"],
      explanationCode: "PUBLISHED_CLASS_FACTORS",
      summary: "上游发布的分类说明。",
      reasonCodes: ["SLOPE_FACTOR"],
    },
    {
      findingId: "finding-catalog-1",
      findingKind: "CATALOG",
      semanticConcept: "AVAILABLE_PRODUCTS",
      querySemantics: "REFERENCE_RESOLUTION",
      status: "COMPLETED",
      evidenceItemIds: ["evidence-1"],
      sourceProductIds: ["source-slope-current"],
      returnedCount: 1,
      truncated: false,
      items: [{ productType: "SLOPE" }],
    },
  ];
}

export function extension(
  findings: readonly unknown[] = [pointMeasurement()],
  products: readonly unknown[] = [sourceProduct()],
  gaps: readonly unknown[] = [],
): Record<string, unknown> {
  return {
    profile: "sacs-wsgs-geospatial-findings/1.0",
    profileSchemaHash: profileHash,
    findings,
    sourceProducts: products,
    gaps,
    findingSetHash: hashCanonicalJson(findings),
    sourceProductSetHash: hashCanonicalJson(products),
  };
}

export function normalizationInput(
  value: unknown = extension(),
): NormalizeWsgsGeospatialExtensionInput {
  return {
    extension: value,
    expectedProfileSchemaHash: profileHash,
    resultStatus: "COMPLETED",
    evidenceItemIds: ["evidence-1"],
    referenceProductIds: ["reference-vehicle-2"],
    authorizedProductIds: ["gdps-baseline-slope"],
  };
}

export function explanationReference(): ExplanationReference {
  return {
    productId: "reference-vehicle-2",
    displayName: "2号车",
    referenceKey: {
      namespace: "gowm",
      kind: "DEVICE",
      id: "wrf_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      version: "7",
    },
    sourceWorldVersion: 7,
  };
}

export function assemblyInput(
  findings: readonly WorldFinding[] = [pointMeasurement()],
  locale = "zh-CN",
): WorldExplanationAssemblyInput {
  const normalized = normalizeWsgsGeospatialExtension(
    normalizationInput(extension(findings)),
  );
  return {
    grounding: {
      groundingId: "grounding-1",
      resultHash,
      status: "COMPLETED",
    },
    normalized,
    references: [explanationReference()],
    locale,
    requestText: "2号车当前位置的坡度是多少？",
    createdAt: "2026-08-29T12:00:00Z",
    evidenceItemIds: ["evidence-1"],
    receiptIds: ["receipt-1"],
    operationKeys: ["geo-raster.sample@1.0"],
    consumerLockHash,
    findingProfileHash: profileHash,
  };
}
