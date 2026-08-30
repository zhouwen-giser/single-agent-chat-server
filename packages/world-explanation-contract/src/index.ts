import { createHash } from "node:crypto";

import { z } from "zod";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const dangerousObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

export const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
export const dateTimeSchema = z.iso.datetime();
export const jsonObjectSchema = z.record(z.string(), z.json());

export const referenceKeySchema = z.strictObject({
  namespace: z.literal("gowm"),
  kind: z.string().min(1).max(64),
  id: z.string().regex(/^wrf_[0-9a-f]{32}$/u),
  version: z.string().min(1).max(128),
});

export const findingStatuses = [
  "COMPLETED",
  "PARTIAL",
  "NO_DATA",
  "INDETERMINATE",
] as const;
export const findingKinds = [
  "POINT_MEASUREMENT",
  "POINT_CLASSIFICATION",
  "SPATIAL_FEATURE_COLLECTION",
  "PROFILE",
  "QUALIFIED_EXPLANATION",
  "CATALOG",
] as const;
export const explanationStatuses = [
  "COMPLETE",
  "PARTIAL",
  "CLARIFICATION_REQUIRED",
  "DATA_UNAVAILABLE",
  "FAILED",
  "CANCELLED",
] as const;
export const questionKinds = [
  "POINT_VALUE",
  "POINT_CLASSIFICATION",
  "FEATURES_IN_AREA",
  "FEATURES_NEARBY",
  "VALUE_RANGE_AREAS",
  "PROFILE",
  "QUALIFIED_EXPLANATION",
  "REFERENCE_RESOLUTION",
  "MULTI_FINDING",
] as const;
export const gapKinds = [
  "DATA_GAP",
  "COVERAGE_GAP",
  "CAPABILITY_GAP",
  "REFERENCE_AMBIGUITY",
  "PRODUCT_SELECTION_AMBIGUITY",
  "SOURCE_CHANGED",
  "TRUNCATED",
  "UNSUPPORTED_FINDING_SCHEMA",
  "EVIDENCE_INCOMPLETE",
  "UPSTREAM_FAILURE",
  "CURRENTNESS_UNAVAILABLE",
] as const;

const findingStatusSchema = z.enum(findingStatuses);
const findingBaseShape = {
  findingId: identifierSchema,
  semanticConcept: z.string().min(1).max(128),
  querySemantics: z.string().min(1).max(128),
  status: findingStatusSchema,
  subjectReferenceProductIds: z.array(identifierSchema).max(32).optional(),
  evidenceItemIds: z.array(identifierSchema).min(1).max(256),
  sourceProductIds: z.array(identifierSchema).max(64),
  confidence: z.number().finite().min(0).max(1).optional(),
  unknowns: z.array(z.string().max(2_048)).max(64).optional(),
  warnings: z.array(z.string().max(2_048)).max(64).optional(),
};

export const geoJsonPointSchema = z.strictObject({
  type: z.literal("Point"),
  coordinates: z.union([
    z.tuple([
      z.number().finite().min(-180).max(180),
      z.number().finite().min(-90).max(90),
    ]),
    z.tuple([
      z.number().finite().min(-180).max(180),
      z.number().finite().min(-90).max(90),
      z.number().finite(),
    ]),
  ]),
});

export const pointMeasurementFindingSchema = z.strictObject({
  ...findingBaseShape,
  findingKind: z.literal("POINT_MEASUREMENT"),
  point: geoJsonPointSchema,
  value: z.number().finite(),
  unit: z.string().min(1).max(64),
});

export const pointClassificationFindingSchema = z.strictObject({
  ...findingBaseShape,
  findingKind: z.literal("POINT_CLASSIFICATION"),
  point: geoJsonPointSchema,
  classCode: z.string().min(1).max(128),
  classLabel: z.string().max(256).optional(),
});

export const spatialFeatureSchema = z
  .strictObject({
    featureId: identifierSchema,
    displayName: z.string().max(512).optional(),
    referenceKey: referenceKeySchema.optional(),
    geometry: jsonObjectSchema.optional(),
    payloadRef: z.string().max(1_024).optional(),
    classCode: z.string().max(128).optional(),
    classLabel: z.string().max(256).optional(),
    areaM2: z.number().finite().nonnegative().optional(),
    lengthM: z.number().finite().nonnegative().optional(),
    distanceM: z.number().finite().nonnegative().optional(),
    confidence: z.number().finite().min(0).max(1).optional(),
    publishedAttributes: jsonObjectSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.referenceKey === undefined &&
      value.geometry === undefined &&
      value.payloadRef === undefined &&
      value.classCode === undefined &&
      value.publishedAttributes === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "a spatial feature requires a published locator or attribute",
      });
    }
  });

export const spatialFeatureCollectionFindingSchema = z.strictObject({
  ...findingBaseShape,
  findingKind: z.literal("SPATIAL_FEATURE_COLLECTION"),
  returnedCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  features: z.array(spatialFeatureSchema).max(1_000),
});

export const profileSampleSchema = z.strictObject({
  distanceM: z.number().finite().nonnegative(),
  value: z.number().finite(),
  point: geoJsonPointSchema.optional(),
});

export const profileFindingSchema = z.strictObject({
  ...findingBaseShape,
  findingKind: z.literal("PROFILE"),
  unit: z.string().min(1).max(64),
  samples: z.array(profileSampleSchema).max(10_000),
  truncated: z.boolean(),
});

export const qualifiedExplanationFindingSchema = z.strictObject({
  ...findingBaseShape,
  findingKind: z.literal("QUALIFIED_EXPLANATION"),
  explanationCode: z.string().min(1).max(128),
  summary: z.string().min(1).max(4_000),
  reasonCodes: z.array(z.string().max(128)).max(32),
  publishedFacts: jsonObjectSchema.optional(),
});

export const catalogFindingSchema = z.strictObject({
  ...findingBaseShape,
  findingKind: z.literal("CATALOG"),
  returnedCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  items: z.array(jsonObjectSchema).max(256),
});

export const worldFindingSchema = z.discriminatedUnion("findingKind", [
  pointMeasurementFindingSchema,
  pointClassificationFindingSchema,
  spatialFeatureCollectionFindingSchema,
  profileFindingSchema,
  qualifiedExplanationFindingSchema,
  catalogFindingSchema,
]);

export const sourceProductSchema = z.strictObject({
  sourceProductId: identifierSchema,
  authority: z.literal("GDPS_CURRENT_PRODUCT"),
  productId: identifierSchema,
  productType: z.string().min(1).max(128),
  productProfile: z.string().min(1).max(128),
  contentHash: sha256Schema,
  descriptorId: z.string().min(1).max(256),
  descriptorHash: sha256Schema,
  dataTime: dateTimeSchema.optional(),
  qualitySummary: jsonObjectSchema.optional(),
  evidenceItemIds: z.array(identifierSchema).min(1).max(128),
});

export const explanationGapSchema = z.strictObject({
  gapId: identifierSchema,
  gapKind: z.enum(gapKinds),
  severity: z.enum(["INFO", "WARNING", "BLOCKING"]),
  messageCode: z.string().min(1).max(128),
  semanticConcept: z.string().max(128).optional(),
  findingIds: z.array(identifierSchema).max(64).optional(),
  evidenceItemIds: z.array(identifierSchema).max(128).optional(),
  safeDetail: z.string().max(2_000).optional(),
});

export const wsgsGeospatialFindingExtensionEnvelopeSchema = z.strictObject({
  profile: z.literal("sacs-wsgs-geospatial-findings/1.0"),
  profileSchemaHash: sha256Schema,
  findings: z.array(z.unknown()).max(128),
  sourceProducts: z.array(z.unknown()).max(64),
  gaps: z.array(z.unknown()).max(128),
  findingSetHash: sha256Schema,
  sourceProductSetHash: sha256Schema,
});

export const wsgsGeospatialFindingExtensionSchema = z.strictObject({
  profile: z.literal("sacs-wsgs-geospatial-findings/1.0"),
  profileSchemaHash: sha256Schema,
  findings: z.array(worldFindingSchema).max(128),
  sourceProducts: z.array(sourceProductSchema).max(64),
  gaps: z.array(explanationGapSchema).max(128),
  findingSetHash: sha256Schema,
  sourceProductSetHash: sha256Schema,
});

export const mapProjectionReferenceFeatureSchema = z.strictObject({
  projectionId: identifierSchema,
  findingId: identifierSchema,
  featureId: identifierSchema.optional(),
  semanticRole: z.string().min(1).max(128),
  label: z.string().max(512).optional(),
  referenceKey: referenceKeySchema,
});
export const mapProjectionGeometryFeatureSchema = z.strictObject({
  projectionId: identifierSchema,
  findingId: identifierSchema,
  featureId: identifierSchema.optional(),
  semanticRole: z.string().min(1).max(128),
  label: z.string().max(512).optional(),
  geometry: jsonObjectSchema,
});
export const mapProjectionPayloadFeatureSchema = z.strictObject({
  projectionId: identifierSchema,
  findingId: identifierSchema,
  featureId: identifierSchema.optional(),
  semanticRole: z.string().min(1).max(128),
  label: z.string().max(512).optional(),
  payloadRef: z.string().max(1_024),
});
export const mapProjectionFeatureSchema = z.union([
  mapProjectionReferenceFeatureSchema,
  mapProjectionGeometryFeatureSchema,
  mapProjectionPayloadFeatureSchema,
]);
export const mapProjectionSchema = z.strictObject({
  schemaVersion: z.literal("sacs-map-projection/1.0"),
  features: z.array(mapProjectionFeatureSchema).max(256),
  truncated: z.boolean(),
  warnings: z.array(z.string().max(1_024)).max(32).optional(),
});

export const renderedFeatureSummarySchema = z.strictObject({
  featureId: identifierSchema,
  displayName: z.string().max(512).optional(),
  classCode: z.string().max(128).optional(),
  classLabel: z.string().max(256).optional(),
  areaM2: z.number().finite().nonnegative().optional(),
  lengthM: z.number().finite().nonnegative().optional(),
  distanceM: z.number().finite().nonnegative().optional(),
  referenceKey: referenceKeySchema.optional(),
});

export const renderedFindingSummarySchema = z.strictObject({
  findingId: identifierSchema,
  findingKind: z.enum(findingKinds),
  semanticConcept: z.string().min(1).max(128),
  headline: z.string().min(1).max(1_000),
  details: z.array(z.string().max(1_000)).max(32),
  returnedCount: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  featureSummaries: z.array(renderedFeatureSummarySchema).max(5).optional(),
  evidenceItemIds: z.array(identifierSchema).min(1).max(256),
  sourceProductIds: z.array(identifierSchema).max(64),
});

export const explanationReferenceSchema = z.strictObject({
  productId: identifierSchema,
  displayName: z.string().min(1).max(512),
  referenceKey: referenceKeySchema,
  sourceWorldVersion: z.number().int().nonnegative(),
  sourceOperation: z.string().min(1).max(128).optional(),
  validUntil: dateTimeSchema.optional(),
  revalidationRequired: z.boolean().optional(),
});

export const sanitizedExplanationSourceProductSchema = z.strictObject({
  sourceProductId: identifierSchema,
  authority: z.literal("GDPS_CURRENT_PRODUCT"),
  productId: identifierSchema,
  productType: z.string().min(1).max(128),
  productProfile: z.string().min(1).max(128),
  contentHash: sha256Schema,
  descriptorId: z.string().min(1).max(256),
  descriptorHash: sha256Schema,
  dataTime: dateTimeSchema.optional(),
  qualitySummary: jsonObjectSchema.optional(),
});

export const groundingIdentitySchema = z.strictObject({
  groundingId: identifierSchema,
  resultHash: sha256Schema,
  status: z.enum([
    "COMPLETED",
    "PARTIAL",
    "AMBIGUOUS",
    "UNRESOLVED",
    "FAILED",
    "CANCELLED",
  ]),
});

export const worldExplanationProvenanceSchema = z.strictObject({
  evidenceItemIds: z.array(identifierSchema).max(1_000),
  receiptIds: z.array(z.string().max(256)).max(1_000),
  operationKeys: z.array(z.string().max(256)).max(64),
  consumerLockHash: sha256Schema,
  findingProfileHash: sha256Schema,
  rendererPolicyHash: sha256Schema,
});

export const worldExplanationV1Schema = z.strictObject({
  schemaVersion: z.literal("sacs-world-explanation/1.0"),
  explanationId: identifierSchema,
  explanationHash: sha256Schema,
  locale: z.string().min(2).max(32),
  grounding: groundingIdentitySchema,
  explanationStatus: z.enum(explanationStatuses),
  questionKind: z.enum(questionKinds),
  renderedText: z.string().min(1).max(16_000),
  findings: z.array(renderedFindingSummarySchema).max(128),
  references: z.array(explanationReferenceSchema).max(128),
  sourceProducts: z.array(sanitizedExplanationSourceProductSchema).max(64),
  gaps: z.array(explanationGapSchema).max(128),
  mapProjection: mapProjectionSchema.optional(),
  provenance: worldExplanationProvenanceSchema,
  createdAt: dateTimeSchema,
});

export const worldExplanationDraftSchema = worldExplanationV1Schema.omit({
  explanationHash: true,
});

export const explanationReplayKeySchema = z.strictObject({
  principalId: identifierSchema,
  threadId: identifierSchema,
  groundingResultHash: sha256Schema,
  locale: z.string().min(2).max(32),
  contractHash: sha256Schema,
  rendererPolicyHash: sha256Schema,
});

export const worldFocusExplanationProjectionSchema = z.strictObject({
  schemaVersion: z.literal("sacs-world-focus-explanation/1.0"),
  explanationId: identifierSchema,
  explanationHash: sha256Schema,
  groundingId: identifierSchema,
  groundingResultHash: sha256Schema,
  findingLinks: z
    .array(
      z.strictObject({
        findingId: identifierSchema,
        ordinal: z.number().int().min(1),
        referenceKey: referenceKeySchema.optional(),
      }),
    )
    .max(128),
});

export const sourceCurrentnessSchema = z
  .strictObject({
    schemaVersion: z.literal("sacs-source-currentness/1.0"),
    productId: identifierSchema,
    previousContentHash: sha256Schema,
    currentContentHash: sha256Schema.optional(),
    status: z.enum(["CURRENT", "CHANGED", "NOT_AVAILABLE", "UNKNOWN"]),
    checkedAt: dateTimeSchema,
    validationGroundingId: identifierSchema,
    validationResultHash: sha256Schema,
  })
  .superRefine((value, context) => {
    if (
      value.status === "CURRENT" &&
      value.currentContentHash !== value.previousContentHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentContentHash"],
        message: "CURRENT requires the previous content hash",
      });
    }
    if (
      value.status === "CHANGED" &&
      (value.currentContentHash === undefined ||
        value.currentContentHash === value.previousContentHash)
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentContentHash"],
        message: "CHANGED requires a distinct current content hash",
      });
    }
  });

export const structuredWorldSelectionKinds = [
  "FINDING_FEATURE",
  "MAP_FEATURE",
  "REFERENCE_SET_MEMBER",
] as const;

export const structuredWorldSelectionSchema = z
  .strictObject({
    schemaVersion: z.literal("sacs-structured-world-selection/1.0"),
    selectionId: identifierSchema,
    principalId: identifierSchema,
    threadId: identifierSchema,
    groundingId: identifierSchema,
    explanationId: identifierSchema,
    selectionKind: z.enum(structuredWorldSelectionKinds),
    findingId: identifierSchema.optional(),
    featureId: identifierSchema.optional(),
    referenceKey: referenceKeySchema.optional(),
    upstreamSelectionToken: z.string().min(1).max(2_048).optional(),
    selectionRevision: z.number().int().min(1),
    sourceHash: sha256Schema,
    selectedAt: dateTimeSchema,
    expiresAt: dateTimeSchema,
  })
  .superRefine((value, context) => {
    if (
      (value.referenceKey === undefined) ===
      (value.upstreamSelectionToken === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["referenceKey"],
        message:
          "exactly one stable ReferenceKey or upstream selection token is required",
      });
    }
    if (
      (value.selectionKind === "FINDING_FEATURE" ||
        value.selectionKind === "MAP_FEATURE") &&
      value.findingId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["findingId"],
        message: "finding-backed selections require a finding identity",
      });
    }
    if (
      (value.selectionKind === "FINDING_FEATURE" ||
        value.selectionKind === "MAP_FEATURE") &&
      value.featureId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["featureId"],
        message: "feature selections require a feature identity",
      });
    }
    if (Date.parse(value.expiresAt) <= Date.parse(value.selectedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "selection expiry must be later than selection time",
      });
    }
  });

export function calculateStructuredWorldSelectionSourceHash(input: {
  readonly explanation: WorldExplanationV1;
  readonly selection: Omit<StructuredWorldSelection, "sourceHash">;
}): Sha256 {
  const finding =
    input.selection.findingId === undefined
      ? undefined
      : input.explanation.findings.find(
          ({ findingId }) => findingId === input.selection.findingId,
        );
  if (input.selection.findingId !== undefined && finding === undefined) {
    throw new Error("STRUCTURED_SELECTION_FINDING_NOT_IN_EXPLANATION");
  }
  const feature = findStructuredSelectionFeature(
    input.explanation,
    input.selection.selectionKind,
    input.selection.findingId,
    input.selection.featureId,
  );
  if (input.selection.featureId !== undefined && feature === undefined) {
    throw new Error("STRUCTURED_SELECTION_FEATURE_NOT_IN_EXPLANATION");
  }
  const reference =
    input.selection.referenceKey === undefined
      ? undefined
      : input.explanation.references.find(
          ({ referenceKey }) =>
            canonicalJson(referenceKey) ===
            canonicalJson(input.selection.referenceKey),
        );
  if (input.selection.referenceKey !== undefined && reference === undefined) {
    throw new Error("STRUCTURED_SELECTION_REFERENCE_NOT_IN_EXPLANATION");
  }
  if (
    input.selection.referenceKey !== undefined &&
    input.selection.selectionKind !== "REFERENCE_SET_MEMBER" &&
    (feature === undefined ||
      !("referenceKey" in feature) ||
      canonicalJson(feature.referenceKey) !==
        canonicalJson(input.selection.referenceKey))
  ) {
    throw new Error("STRUCTURED_SELECTION_REFERENCE_NOT_BOUND_TO_FEATURE");
  }
  if (
    reference !== undefined &&
    (reference.sourceOperation !== "VALIDATE_REFERENCES" ||
      reference.revalidationRequired !== false ||
      reference.validUntil === undefined ||
      Date.parse(reference.validUntil) <=
        Date.parse(input.selection.selectedAt))
  ) {
    throw new Error("STRUCTURED_SELECTION_REFERENCE_REVALIDATION_REQUIRED");
  }
  const sourceProducts = (finding?.sourceProductIds ?? [])
    .map((sourceProductId) =>
      input.explanation.sourceProducts.find(
        (candidate) => candidate.sourceProductId === sourceProductId,
      ),
    )
    .filter(
      (value): value is WorldExplanationV1["sourceProducts"][number] =>
        value !== undefined,
    )
    .sort((left, right) =>
      left.sourceProductId.localeCompare(right.sourceProductId),
    );
  return hashCanonicalJson({
    schemaVersion: "sacs-structured-selection-source/1.0",
    explanationHash: input.explanation.explanationHash,
    groundingResultHash: input.explanation.grounding.resultHash,
    selectionKind: input.selection.selectionKind,
    finding: finding ?? null,
    feature: feature ?? null,
    reference: reference ?? null,
    upstreamSelectionTokenHash:
      input.selection.upstreamSelectionToken === undefined
        ? null
        : hashCanonicalJson(input.selection.upstreamSelectionToken),
    sourceProducts,
  });
}

function findStructuredSelectionFeature(
  explanation: WorldExplanationV1,
  selectionKind: StructuredWorldSelection["selectionKind"],
  findingId: string | undefined,
  featureId: string | undefined,
): JsonObject | undefined {
  if (featureId === undefined) return undefined;
  if (selectionKind === "FINDING_FEATURE") {
    const rendered = explanation.findings
      .find((finding) => finding.findingId === findingId)
      ?.featureSummaries?.find((feature) => feature.featureId === featureId);
    return rendered as unknown as JsonObject | undefined;
  }
  if (selectionKind === "MAP_FEATURE") {
    const projected = explanation.mapProjection?.features.find(
      (feature) =>
        feature.findingId === findingId && feature.featureId === featureId,
    );
    return projected as unknown as JsonObject | undefined;
  }
  return undefined;
}

export const normalizationIssueCodes = [
  "UNKNOWN_FINDING_KIND",
  "INVALID_FINDING_SCHEMA",
  "INVALID_SOURCE_PRODUCT",
  "INVALID_GAP",
  "REFERENCE_CLOSURE_FAILED",
  "EVIDENCE_CLOSURE_FAILED",
  "SOURCE_PRODUCT_CLOSURE_FAILED",
  "STATUS_INCOMPATIBLE",
  "FEATURE_COUNT_INCONSISTENT",
  "FEATURE_LIMIT_EXCEEDED",
  "GEOMETRY_LIMIT_EXCEEDED",
  "PROFILE_ORDER_INVALID",
  "UNSAFE_PAYLOAD_REF",
  "UNSAFE_METADATA",
] as const;
export const findingNormalizationIssueSchema = z.strictObject({
  code: z.enum(normalizationIssueCodes),
  action: z.enum(["REJECTED", "DROPPED", "RETAINED_WITH_GAP"]),
  path: z.string().max(512),
  findingId: identifierSchema.optional(),
  sourceProductId: identifierSchema.optional(),
  safeDetail: z.string().max(1_000).optional(),
});
export const findingNormalizationReportSchema = z.strictObject({
  schemaVersion: z.literal("sacs-finding-normalization-report/1.0"),
  status: z.enum(["PASS", "PARTIAL", "FAIL"]),
  findingCount: z.number().int().nonnegative(),
  sourceProductCount: z.number().int().nonnegative(),
  gapCount: z.number().int().nonnegative(),
  issues: z.array(findingNormalizationIssueSchema).max(256),
});

export const worldExplanationLimitsSchema = z.strictObject({
  maxFindings: z.number().int().min(1).max(128),
  maxFeaturesPerFinding: z.number().int().min(1).max(256),
  maxSourceProducts: z.number().int().min(1).max(64),
  maxInlineGeometryBytes: z.number().int().min(1).max(1_048_576),
  maxExplanationJsonBytes: z.number().int().min(1).max(4_194_304),
  maxRenderedCharacters: z.number().int().min(1).max(16_000),
  maxMapFeatures: z.number().int().min(1).max(256),
  maxDisplayedFeatureSummaries: z.number().int().min(1).max(5),
  hardCeilingsImmutableAtRuntime: z.literal(true),
});
export const rendererPolicySchema = z.strictObject({
  schemaVersion: z.literal("sacs-world-explanation-renderer-policy/1.0"),
  policyId: z.string().min(1).max(128),
  policyHashAlgorithm: z.literal("SHA-256_CANONICAL_JSON"),
  limits: worldExplanationLimitsSchema,
  rules: z.strictObject({
    renderer: z.literal("DETERMINISTIC_ONLY"),
    factSources: z.array(z.literal("TYPED_WORLD_FINDING")).min(1).max(4),
    nonFactSources: z
      .array(z.enum(["GENERIC_SAFE_PAYLOAD", "UNKNOWN_SCHEMA", "FREE_TEXT"]))
      .max(8),
    emptyCollectionTextPolicy: z.literal(
      "NO_MATCH_IN_CURRENT_DATA_NOT_ABSOLUTE_ABSENCE",
    ),
    sourceDisclosure: z.literal(
      "STRUCTURED_PROVENANCE_WITH_OPTIONAL_BOUNDED_TEXT",
    ),
    numericPolicy: z.literal("PRESERVE_UPSTREAM_VALUE_AND_UNIT"),
    localePolicy: z.literal(
      "REQUEST_LOCALE_ELSE_DETERMINISTIC_SCRIPT_DETECTION",
    ),
    mapLocatorPriority: z
      .array(z.enum(["UPSTREAM_GEOMETRY", "REFERENCE_KEY", "PAYLOAD_REF"]))
      .length(3)
      .refine((value) => new Set(value).size === value.length),
    querySemanticsQuestionKinds: z.record(
      z.string().min(1).max(128),
      z.enum(questionKinds),
    ),
    allowedQualityMetricKeys: z.array(z.string().min(1).max(128)).max(32),
  }),
});

export const DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY =
  rendererPolicySchema.parse({
    schemaVersion: "sacs-world-explanation-renderer-policy/1.0",
    policyId: "sacs-world-explanation-v1",
    policyHashAlgorithm: "SHA-256_CANONICAL_JSON",
    limits: {
      maxFindings: 128,
      maxFeaturesPerFinding: 256,
      maxSourceProducts: 64,
      maxInlineGeometryBytes: 1_048_576,
      maxExplanationJsonBytes: 4_194_304,
      maxRenderedCharacters: 16_000,
      maxMapFeatures: 256,
      maxDisplayedFeatureSummaries: 5,
      hardCeilingsImmutableAtRuntime: true,
    },
    rules: {
      renderer: "DETERMINISTIC_ONLY",
      factSources: ["TYPED_WORLD_FINDING"],
      nonFactSources: ["GENERIC_SAFE_PAYLOAD", "UNKNOWN_SCHEMA", "FREE_TEXT"],
      emptyCollectionTextPolicy:
        "NO_MATCH_IN_CURRENT_DATA_NOT_ABSOLUTE_ABSENCE",
      sourceDisclosure: "STRUCTURED_PROVENANCE_WITH_OPTIONAL_BOUNDED_TEXT",
      numericPolicy: "PRESERVE_UPSTREAM_VALUE_AND_UNIT",
      localePolicy: "REQUEST_LOCALE_ELSE_DETERMINISTIC_SCRIPT_DETECTION",
      mapLocatorPriority: ["UPSTREAM_GEOMETRY", "REFERENCE_KEY", "PAYLOAD_REF"],
      querySemanticsQuestionKinds: {
        READ_VALUE: "POINT_VALUE",
        POINT_CLASSIFICATION: "POINT_CLASSIFICATION",
        FEATURES_IN_AREA: "FEATURES_IN_AREA",
        FEATURES_NEARBY: "FEATURES_NEARBY",
        VALUE_RANGE_AREAS: "VALUE_RANGE_AREAS",
        PROFILE: "PROFILE",
        QUALIFIED_EXPLANATION: "QUALIFIED_EXPLANATION",
        REFERENCE_RESOLUTION: "REFERENCE_RESOLUTION",
      },
      allowedQualityMetricKeys: ["valueAccuracyDegree"],
    },
  });

export type Sha256 = z.infer<typeof sha256Schema>;
export type ReferenceKey = z.infer<typeof referenceKeySchema>;
export type FindingStatus = z.infer<typeof findingStatusSchema>;
export type PointMeasurementFinding = z.infer<
  typeof pointMeasurementFindingSchema
>;
export type PointClassificationFinding = z.infer<
  typeof pointClassificationFindingSchema
>;
export type SpatialFeature = z.infer<typeof spatialFeatureSchema>;
export type SpatialFeatureCollectionFinding = z.infer<
  typeof spatialFeatureCollectionFindingSchema
>;
export type ProfileFinding = z.infer<typeof profileFindingSchema>;
export type QualifiedExplanationFinding = z.infer<
  typeof qualifiedExplanationFindingSchema
>;
export type CatalogFinding = z.infer<typeof catalogFindingSchema>;
export type WorldFinding = z.infer<typeof worldFindingSchema>;
export type SourceProduct = z.infer<typeof sourceProductSchema>;
export type ExplanationGap = z.infer<typeof explanationGapSchema>;
export type WsgsGeospatialFindingExtension = z.infer<
  typeof wsgsGeospatialFindingExtensionSchema
>;
export type WsgsGeospatialFindingExtensionEnvelope = z.infer<
  typeof wsgsGeospatialFindingExtensionEnvelopeSchema
>;
export type MapProjectionFeature = z.infer<typeof mapProjectionFeatureSchema>;
export type MapProjection = z.infer<typeof mapProjectionSchema>;
export type RenderedFindingSummary = z.infer<
  typeof renderedFindingSummarySchema
>;
export type ExplanationReference = z.infer<typeof explanationReferenceSchema>;
export type SanitizedExplanationSourceProduct = z.infer<
  typeof sanitizedExplanationSourceProductSchema
>;
export type GroundingIdentity = z.infer<typeof groundingIdentitySchema>;
export type ExplanationStatus = (typeof explanationStatuses)[number];
export type QuestionKind = (typeof questionKinds)[number];
export type WorldExplanationV1 = z.infer<typeof worldExplanationV1Schema>;
export type WorldExplanationDraft = z.infer<typeof worldExplanationDraftSchema>;
export type ExplanationReplayKey = z.infer<typeof explanationReplayKeySchema>;
export type WorldFocusExplanationProjection = z.infer<
  typeof worldFocusExplanationProjectionSchema
>;
export type SourceCurrentness = z.infer<typeof sourceCurrentnessSchema>;
export type StructuredWorldSelection = z.infer<
  typeof structuredWorldSelectionSchema
>;
export type FindingNormalizationIssue = z.infer<
  typeof findingNormalizationIssueSchema
>;
export type FindingNormalizationReport = z.infer<
  typeof findingNormalizationReportSchema
>;
export type WorldExplanationLimits = z.infer<
  typeof worldExplanationLimitsSchema
>;
export type RendererPolicy = z.infer<typeof rendererPolicySchema>;

export function parseWorldFinding(value: unknown): WorldFinding {
  return worldFindingSchema.parse(value);
}

export function parseSourceProduct(value: unknown): SourceProduct {
  return sourceProductSchema.parse(value);
}

export function parseExplanationGap(value: unknown): ExplanationGap {
  return explanationGapSchema.parse(value);
}

export function parseWsgsGeospatialFindingExtension(
  value: unknown,
): WsgsGeospatialFindingExtension {
  return wsgsGeospatialFindingExtensionSchema.parse(value);
}

export function parseWorldExplanationV1(value: unknown): WorldExplanationV1 {
  return worldExplanationV1Schema.parse(value);
}

export function parseExplanationReplayKey(
  value: unknown,
): ExplanationReplayKey {
  return explanationReplayKeySchema.parse(value);
}

export function parseRendererPolicy(value: unknown): RendererPolicy {
  return rendererPolicySchema.parse(value);
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set<object>(), "$");
}

export function hashCanonicalJson(value: unknown): Sha256 {
  const digest = createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
  return "sha256:" + digest;
}

export function hashWorldExplanation(value: unknown): Sha256 {
  const parsed = parseWorldExplanationV1(value);
  const { explanationHash, ...content } = parsed;
  void explanationHash;
  return hashCanonicalJson(content);
}

export function verifyWorldExplanationHash(value: unknown): WorldExplanationV1 {
  const parsed = parseWorldExplanationV1(value);
  if (hashWorldExplanation(parsed) !== parsed.explanationHash) {
    throw new Error("WORLD_EXPLANATION_HASH_MISMATCH");
  }
  return parsed;
}

export function finalizeWorldExplanation(value: unknown): WorldExplanationV1 {
  const draft = worldExplanationDraftSchema.parse(value);
  return parseWorldExplanationV1({
    ...draft,
    explanationHash: hashCanonicalJson(draft),
  });
}

export function hashRendererPolicy(value: unknown): Sha256 {
  return hashCanonicalJson(parseRendererPolicy(value));
}

function canonicalize(
  value: unknown,
  ancestors: Set<object>,
  path: string,
): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("non-finite number at " + path);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError("non-JSON value at " + path);
  }
  if (ancestors.has(value)) {
    throw new TypeError("cyclic JSON value at " + path);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new TypeError(
            "sparse array at " + path + "[" + String(index) + "]",
          );
        }
        items.push(
          canonicalize(
            value[index],
            ancestors,
            path + "[" + String(index) + "]",
          ),
        );
      }
      return "[" + items.join(",") + "]";
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("non-plain JSON object at " + path);
    }
    const record = value as Record<string, unknown>;
    const entries: string[] = [];
    for (const key of Object.keys(record).sort()) {
      if (dangerousObjectKeys.has(key)) {
        throw new TypeError("unsafe object key at " + path + "." + key);
      }
      entries.push(
        JSON.stringify(key) +
          ":" +
          canonicalize(record[key], ancestors, path + "." + key),
      );
    }
    return "{" + entries.join(",") + "}";
  } finally {
    ancestors.delete(value);
  }
}
