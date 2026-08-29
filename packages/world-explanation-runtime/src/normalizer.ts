import {
  DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
  canonicalJson,
  explanationGapSchema,
  findingKinds,
  findingNormalizationReportSchema,
  hashCanonicalJson,
  identifierSchema,
  sourceProductSchema,
  worldFindingSchema,
  wsgsGeospatialFindingExtensionEnvelopeSchema,
  type ExplanationGap,
  type FindingNormalizationIssue,
  type FindingNormalizationReport,
  type Sha256,
  type SourceProduct,
  type SpatialFeature,
  type SpatialFeatureCollectionFinding,
  type WorldExplanationLimits,
  type WorldFinding,
} from "../../world-explanation-contract/src/index.js";

export const groundingResultStatuses = [
  "COMPLETED",
  "PARTIAL",
  "AMBIGUOUS",
  "UNRESOLVED",
  "FAILED",
  "CANCELLED",
] as const;

export type GroundingResultStatus = (typeof groundingResultStatuses)[number];

export interface NormalizeWsgsGeospatialExtensionInput {
  readonly extension: unknown;
  readonly expectedProfileSchemaHash: Sha256;
  readonly resultStatus: GroundingResultStatus;
  readonly evidenceItemIds: readonly string[];
  readonly referenceProductIds: readonly string[];
  readonly authorizedProductIds?: readonly string[];
  readonly limits?: WorldExplanationLimits;
}

export interface NormalizedGeospatialFindings {
  readonly profile: "sacs-wsgs-geospatial-findings/1.0";
  readonly profileSchemaHash: Sha256;
  readonly findings: readonly WorldFinding[];
  readonly sourceProducts: readonly SourceProduct[];
  readonly gaps: readonly ExplanationGap[];
  readonly findingSetHash: Sha256;
  readonly sourceProductSetHash: Sha256;
  readonly report: FindingNormalizationReport;
}

export class WorldFindingNormalizationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const forbiddenMetadataKeys = new Set([
  "assetUri",
  "asset_uri",
  "providerUrl",
  "provider_url",
  "databaseUrl",
  "database_url",
  "password",
  "secret",
  "token",
  "authorization",
]);
const findingKindSet = new Set<string>(findingKinds);

export function normalizeWsgsGeospatialExtension(
  input: NormalizeWsgsGeospatialExtensionInput,
): NormalizedGeospatialFindings {
  const limits =
    input.limits ?? DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY.limits;
  assertSafeJsonTree(input.extension);
  if (
    Buffer.byteLength(canonicalJson(input.extension), "utf8") >
    limits.maxExplanationJsonBytes
  ) {
    throw new WorldFindingNormalizationError("EXTENSION_BYTE_LIMIT_EXCEEDED");
  }

  const envelopeResult = wsgsGeospatialFindingExtensionEnvelopeSchema.safeParse(
    input.extension,
  );
  if (!envelopeResult.success) {
    throw new WorldFindingNormalizationError("INVALID_EXTENSION_ENVELOPE");
  }
  const envelope = envelopeResult.data;
  if (envelope.profileSchemaHash !== input.expectedProfileSchemaHash) {
    throw new WorldFindingNormalizationError("PROFILE_HASH_MISMATCH");
  }
  if (hashCanonicalJson(envelope.findings) !== envelope.findingSetHash) {
    throw new WorldFindingNormalizationError("FINDING_SET_HASH_MISMATCH");
  }
  if (
    hashCanonicalJson(envelope.sourceProducts) !== envelope.sourceProductSetHash
  ) {
    throw new WorldFindingNormalizationError(
      "SOURCE_PRODUCT_SET_HASH_MISMATCH",
    );
  }

  const evidenceIds = parseUniqueIdentifiers(
    input.evidenceItemIds,
    "DUPLICATE_EVIDENCE_ID",
  );
  const referenceIds = parseUniqueIdentifiers(
    input.referenceProductIds,
    "DUPLICATE_REFERENCE_PRODUCT_ID",
  );
  const authorizedProductIds =
    input.authorizedProductIds === undefined
      ? undefined
      : parseUniqueIdentifiers(
          input.authorizedProductIds,
          "DUPLICATE_AUTHORIZED_PRODUCT_ID",
        );

  const sourceProducts = parseSourceProducts(
    envelope.sourceProducts,
    evidenceIds,
    authorizedProductIds,
  );
  const sourceProductIds = new Set(
    sourceProducts.map(({ sourceProductId }) => sourceProductId),
  );
  const rawFindingIds = collectRawFindingIds(envelope.findings);
  const parsedGaps = parseGaps(envelope.gaps, evidenceIds, rawFindingIds);
  const findings: WorldFinding[] = [];
  const generatedGaps: ExplanationGap[] = [];
  const issues: FindingNormalizationIssue[] = [];

  for (const [index, rawFinding] of envelope.findings.entries()) {
    const parsed = worldFindingSchema.safeParse(rawFinding);
    if (!parsed.success) {
      const rawKind = readStringProperty(rawFinding, "findingKind");
      const issueCode =
        rawKind === undefined || !findingKindSet.has(rawKind)
          ? "UNKNOWN_FINDING_KIND"
          : "INVALID_FINDING_SCHEMA";
      const findingId = safeIdentifierProperty(rawFinding, "findingId");
      appendNormalizationIssue(issues, {
        code: issueCode,
        action: "DROPPED",
        path: "findings[" + String(index) + "]",
        ...(findingId === undefined ? {} : { findingId }),
      });
      generatedGaps.push(
        unsupportedFindingGap(rawFinding, index, findingId, evidenceIds),
      );
      continue;
    }
    const normalized = normalizeFinding({
      finding: parsed.data,
      index,
      resultStatus: input.resultStatus,
      evidenceIds,
      referenceIds,
      sourceProductIds,
      limits,
      issues,
      generatedGaps,
    });
    if (normalized !== undefined) findings.push(normalized);
  }

  const gaps = uniqueGaps([...parsedGaps, ...generatedGaps]);
  const report = findingNormalizationReportSchema.parse({
    schemaVersion: "sacs-finding-normalization-report/1.0",
    status: issues.length === 0 ? "PASS" : "PARTIAL",
    findingCount: findings.length,
    sourceProductCount: sourceProducts.length,
    gapCount: gaps.length,
    issues,
  });
  return {
    profile: envelope.profile,
    profileSchemaHash: envelope.profileSchemaHash,
    findings,
    sourceProducts,
    gaps,
    findingSetHash: envelope.findingSetHash,
    sourceProductSetHash: envelope.sourceProductSetHash,
    report,
  };
}

function parseSourceProducts(
  rawProducts: readonly unknown[],
  evidenceIds: ReadonlySet<string>,
  authorizedProductIds: ReadonlySet<string> | undefined,
): SourceProduct[] {
  const products: SourceProduct[] = [];
  const seen = new Set<string>();
  for (const [index, rawProduct] of rawProducts.entries()) {
    const result = sourceProductSchema.safeParse(rawProduct);
    if (!result.success) {
      throw new WorldFindingNormalizationError(
        "INVALID_SOURCE_PRODUCT_AT_" + String(index),
      );
    }
    const product = result.data;
    if (seen.has(product.sourceProductId)) {
      throw new WorldFindingNormalizationError("DUPLICATE_SOURCE_PRODUCT_ID");
    }
    seen.add(product.sourceProductId);
    if (
      authorizedProductIds !== undefined &&
      !authorizedProductIds.has(product.productId)
    ) {
      throw new WorldFindingNormalizationError("FOREIGN_SCOPE_SOURCE_PRODUCT");
    }
    if (
      product.evidenceItemIds.some((evidenceId) => !evidenceIds.has(evidenceId))
    ) {
      throw new WorldFindingNormalizationError(
        "SOURCE_PRODUCT_EVIDENCE_CLOSURE_FAILED",
      );
    }
    products.push(product);
  }
  return products;
}

function parseGaps(
  rawGaps: readonly unknown[],
  evidenceIds: ReadonlySet<string>,
  findingIds: ReadonlySet<string>,
): ExplanationGap[] {
  const gaps: ExplanationGap[] = [];
  const seen = new Set<string>();
  for (const [index, rawGap] of rawGaps.entries()) {
    const result = explanationGapSchema.safeParse(rawGap);
    if (!result.success) {
      throw new WorldFindingNormalizationError(
        "INVALID_GAP_AT_" + String(index),
      );
    }
    const gap = result.data;
    if (seen.has(gap.gapId)) {
      throw new WorldFindingNormalizationError("DUPLICATE_GAP_ID");
    }
    seen.add(gap.gapId);
    if (
      gap.evidenceItemIds?.some(
        (evidenceId) => !evidenceIds.has(evidenceId),
      ) === true
    ) {
      throw new WorldFindingNormalizationError("GAP_EVIDENCE_CLOSURE_FAILED");
    }
    if (
      gap.findingIds?.some((findingId) => !findingIds.has(findingId)) === true
    ) {
      throw new WorldFindingNormalizationError("GAP_FINDING_CLOSURE_FAILED");
    }
    gaps.push({
      ...gap,
      ...(gap.safeDetail === undefined
        ? {}
        : { safeDetail: safeAuditText(gap.safeDetail, 2_000) }),
    });
  }
  return gaps;
}

function collectRawFindingIds(
  findings: readonly unknown[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const finding of findings) {
    const findingId = safeIdentifierProperty(finding, "findingId");
    if (findingId === undefined) continue;
    if (ids.has(findingId)) {
      throw new WorldFindingNormalizationError("DUPLICATE_FINDING_ID");
    }
    ids.add(findingId);
  }
  return ids;
}

interface NormalizeFindingContext {
  readonly finding: WorldFinding;
  readonly index: number;
  readonly resultStatus: GroundingResultStatus;
  readonly evidenceIds: ReadonlySet<string>;
  readonly referenceIds: ReadonlySet<string>;
  readonly sourceProductIds: ReadonlySet<string>;
  readonly limits: WorldExplanationLimits;
  readonly issues: FindingNormalizationIssue[];
  readonly generatedGaps: ExplanationGap[];
}

function normalizeFinding(
  context: NormalizeFindingContext,
): WorldFinding | undefined {
  const { finding } = context;
  if (
    !["COMPLETED", "PARTIAL"].includes(context.resultStatus) &&
    hasFactualContent(finding)
  ) {
    return dropFinding(context, "STATUS_INCOMPATIBLE");
  }
  if (
    finding.evidenceItemIds.some(
      (evidenceId) => !context.evidenceIds.has(evidenceId),
    )
  ) {
    return dropFinding(context, "EVIDENCE_CLOSURE_FAILED");
  }
  if (
    finding.sourceProductIds.some(
      (sourceProductId) => !context.sourceProductIds.has(sourceProductId),
    )
  ) {
    return dropFinding(context, "SOURCE_PRODUCT_CLOSURE_FAILED");
  }
  if (
    finding.subjectReferenceProductIds?.some(
      (referenceId) => !context.referenceIds.has(referenceId),
    ) === true
  ) {
    return dropFinding(context, "REFERENCE_CLOSURE_FAILED");
  }
  if (
    ["NO_DATA", "INDETERMINATE"].includes(finding.status) &&
    hasFactualContent(finding)
  ) {
    return dropFinding(context, "STATUS_INCOMPATIBLE");
  }
  if (finding.findingKind === "PROFILE") {
    for (let index = 1; index < finding.samples.length; index += 1) {
      const previous = finding.samples[index - 1];
      const current = finding.samples[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        current.distanceM < previous.distanceM
      ) {
        return dropFinding(context, "PROFILE_ORDER_INVALID");
      }
    }
  }
  if (finding.findingKind === "SPATIAL_FEATURE_COLLECTION") {
    return normalizeFeatureCollection(context, finding);
  }
  if (isTruncatedFinding(finding)) {
    retainWithTruncationGap(context, finding.findingId);
  }
  return finding;
}

function normalizeFeatureCollection(
  context: NormalizeFindingContext,
  finding: SpatialFeatureCollectionFinding,
): WorldFinding | undefined {
  if (finding.returnedCount < finding.features.length) {
    return dropFinding(context, "FEATURE_COUNT_INCONSISTENT");
  }
  if (!finding.truncated && finding.returnedCount !== finding.features.length) {
    return dropFinding(context, "FEATURE_COUNT_INCONSISTENT");
  }

  let normalizedFeatures: SpatialFeature[] = [];
  for (const [featureIndex, feature] of finding.features.entries()) {
    const normalized = normalizeFeature(context, feature, featureIndex);
    if (normalized === undefined) {
      return dropFinding(context, "GEOMETRY_LIMIT_EXCEEDED");
    }
    normalizedFeatures.push(normalized);
  }

  let truncated = finding.truncated;
  let status = finding.status;
  if (normalizedFeatures.length > context.limits.maxFeaturesPerFinding) {
    normalizedFeatures = normalizedFeatures.slice(
      0,
      context.limits.maxFeaturesPerFinding,
    );
    truncated = true;
    status = "PARTIAL";
    appendNormalizationIssue(context.issues, {
      code: "FEATURE_LIMIT_EXCEEDED",
      action: "RETAINED_WITH_GAP",
      path: "findings[" + String(context.index) + "].features",
      findingId: finding.findingId,
    });
  }
  const normalized = {
    ...finding,
    status,
    truncated,
    features: normalizedFeatures,
  } satisfies SpatialFeatureCollectionFinding;
  if (truncated) retainWithTruncationGap(context, finding.findingId);
  return normalized;
}

function normalizeFeature(
  context: NormalizeFindingContext,
  feature: SpatialFeature,
  featureIndex: number,
): SpatialFeature | undefined {
  let normalized = feature;
  if (
    feature.payloadRef !== undefined &&
    !isSafePayloadRef(feature.payloadRef)
  ) {
    const { payloadRef, ...withoutPayloadRef } = normalized;
    void payloadRef;
    normalized = withoutPayloadRef;
    appendNormalizationIssue(context.issues, {
      code: "UNSAFE_PAYLOAD_REF",
      action: "RETAINED_WITH_GAP",
      path:
        "findings[" +
        String(context.index) +
        "].features[" +
        String(featureIndex) +
        "].payloadRef",
      findingId: context.finding.findingId,
    });
  }
  if (
    normalized.geometry !== undefined &&
    Buffer.byteLength(canonicalJson(normalized.geometry), "utf8") >
      context.limits.maxInlineGeometryBytes
  ) {
    if (
      normalized.referenceKey === undefined &&
      normalized.payloadRef === undefined
    ) {
      return undefined;
    }
    const { geometry, ...withoutGeometry } = normalized;
    void geometry;
    normalized = withoutGeometry;
    appendNormalizationIssue(context.issues, {
      code: "GEOMETRY_LIMIT_EXCEEDED",
      action: "RETAINED_WITH_GAP",
      path:
        "findings[" +
        String(context.index) +
        "].features[" +
        String(featureIndex) +
        "].geometry",
      findingId: context.finding.findingId,
    });
  }
  if (
    normalized.referenceKey === undefined &&
    normalized.geometry === undefined &&
    normalized.payloadRef === undefined &&
    normalized.classCode === undefined &&
    normalized.publishedAttributes === undefined
  ) {
    return undefined;
  }
  return normalized;
}

function dropFinding(
  context: NormalizeFindingContext,
  code: FindingNormalizationIssue["code"],
): undefined {
  appendNormalizationIssue(context.issues, {
    code,
    action: "DROPPED",
    path: "findings[" + String(context.index) + "]",
    findingId: context.finding.findingId,
  });
  context.generatedGaps.push({
    gapId: generatedIdentifier(
      "gap-evidence",
      context.finding.findingId + "-" + code,
    ),
    gapKind:
      code === "STATUS_INCOMPATIBLE"
        ? "UNSUPPORTED_FINDING_SCHEMA"
        : "EVIDENCE_INCOMPLETE",
    severity: "WARNING",
    messageCode: code,
    semanticConcept: context.finding.semanticConcept,
    findingIds: [context.finding.findingId],
    evidenceItemIds: context.finding.evidenceItemIds.filter((evidenceId) =>
      context.evidenceIds.has(evidenceId),
    ),
  });
  return undefined;
}

function retainWithTruncationGap(
  context: NormalizeFindingContext,
  findingId: string,
): void {
  if (
    context.generatedGaps.some(
      (gap) =>
        gap.gapKind === "TRUNCATED" && gap.findingIds?.includes(findingId),
    )
  ) {
    return;
  }
  context.generatedGaps.push({
    gapId: generatedIdentifier("gap-truncated", findingId),
    gapKind: "TRUNCATED",
    severity: "WARNING",
    messageCode: "TRUNCATED",
    findingIds: [findingId],
  });
}

function unsupportedFindingGap(
  rawFinding: unknown,
  index: number,
  findingId: string | undefined,
  evidenceIds: ReadonlySet<string>,
): ExplanationGap {
  const closedEvidenceIds = readIdentifierArrayProperty(
    rawFinding,
    "evidenceItemIds",
  ).filter((evidenceId) => evidenceIds.has(evidenceId));
  return {
    gapId: generatedIdentifier(
      "gap-unsupported",
      String(index) + "-" + hashCanonicalJson(rawFinding),
    ),
    gapKind: "UNSUPPORTED_FINDING_SCHEMA",
    severity: "WARNING",
    messageCode: "UNSUPPORTED_FINDING_SCHEMA",
    ...(findingId === undefined ? {} : { findingIds: [findingId] }),
    evidenceItemIds: closedEvidenceIds,
  };
}

function hasFactualContent(finding: WorldFinding): boolean {
  switch (finding.findingKind) {
    case "POINT_MEASUREMENT":
    case "POINT_CLASSIFICATION":
    case "QUALIFIED_EXPLANATION":
      return true;
    case "SPATIAL_FEATURE_COLLECTION":
      return finding.returnedCount > 0 || finding.features.length > 0;
    case "PROFILE":
      return finding.samples.length > 0;
    case "CATALOG":
      return finding.returnedCount > 0 || finding.items.length > 0;
  }
}

function isTruncatedFinding(finding: WorldFinding): boolean {
  return (
    (finding.findingKind === "SPATIAL_FEATURE_COLLECTION" ||
      finding.findingKind === "PROFILE" ||
      finding.findingKind === "CATALOG") &&
    finding.truncated
  );
}

function parseUniqueIdentifiers(
  values: readonly string[],
  duplicateCode: string,
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const value of values) {
    if (!identifierSchema.safeParse(value).success) {
      throw new WorldFindingNormalizationError("INVALID_CLOSURE_IDENTIFIER");
    }
    if (result.has(value)) {
      throw new WorldFindingNormalizationError(duplicateCode);
    }
    result.add(value);
  }
  return result;
}

function uniqueGaps(gaps: readonly ExplanationGap[]): ExplanationGap[] {
  const result: ExplanationGap[] = [];
  const seen = new Map<string, Sha256>();
  for (const gap of gaps) {
    const digest = hashCanonicalJson(gap);
    const existing = seen.get(gap.gapId);
    if (existing !== undefined) {
      if (existing !== digest) {
        throw new WorldFindingNormalizationError("DUPLICATE_GAP_ID");
      }
      continue;
    }
    seen.set(gap.gapId, digest);
    result.push(gap);
  }
  return result;
}

function appendNormalizationIssue(
  issues: FindingNormalizationIssue[],
  issue: FindingNormalizationIssue,
): void {
  if (issues.length < 256) issues.push(issue);
}

function generatedIdentifier(prefix: string, seed: string): string {
  return prefix + "-" + hashCanonicalJson(seed).slice(7, 39);
}

function readStringProperty(
  value: unknown,
  property: string,
): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === "string" ? candidate : undefined;
}

function safeIdentifierProperty(
  value: unknown,
  property: string,
): string | undefined {
  const candidate = readStringProperty(value, property);
  return candidate !== undefined &&
    identifierSchema.safeParse(candidate).success
    ? candidate
    : undefined;
}

function readIdentifierArrayProperty(
  value: unknown,
  property: string,
): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const candidate = (value as Record<string, unknown>)[property];
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(
    (item): item is string =>
      typeof item === "string" && identifierSchema.safeParse(item).success,
  );
}

function isSafePayloadRef(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 1_024 &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) &&
    !value.includes("\\") &&
    !value.includes("@") &&
    !Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  );
}

function safeAuditText(value: string, limit: number): string {
  const redacted = value
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(
      /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/giu,
      "$1://[REDACTED]@",
    );
  const safe = Array.from(redacted)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/[\\`*_{}[\]()#!|~<>]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(safe).slice(0, limit).join("");
}

function assertSafeJsonTree(value: unknown): void {
  const ancestors = new Set<object>();
  let nodes = 0;
  visit(value, "$", 0);

  function visit(current: unknown, path: string, depth: number): void {
    nodes += 1;
    if (nodes > 100_000 || depth > 64) {
      throw new WorldFindingNormalizationError(
        "JSON_COMPLEXITY_LIMIT_EXCEEDED",
      );
    }
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new WorldFindingNormalizationError("NON_FINITE_NUMBER");
      }
      return;
    }
    if (typeof current !== "object") {
      throw new WorldFindingNormalizationError("NON_JSON_VALUE");
    }
    if (ancestors.has(current)) {
      throw new WorldFindingNormalizationError("CYCLIC_JSON_VALUE");
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        for (let index = 0; index < current.length; index += 1) {
          if (!(index in current)) {
            throw new WorldFindingNormalizationError("SPARSE_JSON_ARRAY");
          }
          visit(current[index], path + "[" + String(index) + "]", depth + 1);
        }
        return;
      }
      const prototype = Object.getPrototypeOf(current) as object | null;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new WorldFindingNormalizationError("NON_PLAIN_JSON_OBJECT");
      }
      for (const [key, child] of Object.entries(
        current as Record<string, unknown>,
      )) {
        if (dangerousKey(key)) {
          throw new WorldFindingNormalizationError("UNSAFE_METADATA_KEY");
        }
        visit(child, path + "." + key, depth + 1);
      }
    } finally {
      ancestors.delete(current);
    }
  }
}

function dangerousKey(key: string): boolean {
  return (
    key === "__proto__" ||
    key === "constructor" ||
    key === "prototype" ||
    forbiddenMetadataKeys.has(key)
  );
}
