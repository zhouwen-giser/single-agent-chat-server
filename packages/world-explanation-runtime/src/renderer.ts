import {
  DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
  explanationReferenceSchema,
  finalizeWorldExplanation,
  hashCanonicalJson,
  hashRendererPolicy,
  mapProjectionSchema,
  parseRendererPolicy,
  type CatalogFinding,
  type ExplanationGap,
  type ExplanationReference,
  type ExplanationStatus,
  type GroundingIdentity,
  type JsonObject,
  type MapProjection,
  type MapProjectionFeature,
  type PointClassificationFinding,
  type PointMeasurementFinding,
  type ProfileFinding,
  type QualifiedExplanationFinding,
  type QuestionKind,
  type RenderedFindingSummary,
  type RendererPolicy,
  type SanitizedExplanationSourceProduct,
  type SourceProduct,
  type SpatialFeature,
  type SpatialFeatureCollectionFinding,
  type WorldExplanationV1,
  type WorldFinding,
} from "../../world-explanation-contract/src/index.js";

import type { NormalizedGeospatialFindings } from "./normalizer.js";

export interface WorldExplanationAssemblyInput {
  readonly grounding: GroundingIdentity;
  readonly normalized: NormalizedGeospatialFindings;
  readonly references: readonly ExplanationReference[];
  readonly locale?: string;
  readonly requestText?: string;
  readonly createdAt: string;
  readonly evidenceItemIds: readonly string[];
  readonly receiptIds: readonly string[];
  readonly operationKeys: readonly string[];
  readonly consumerLockHash: string;
  readonly findingProfileHash: string;
  readonly rendererPolicy?: RendererPolicy;
}

interface RenderedFinding {
  readonly summary: RenderedFindingSummary;
  readonly text: string;
}

export function assembleWorldExplanation(
  input: WorldExplanationAssemblyInput,
): WorldExplanationV1 {
  const policy = parseRendererPolicy(
    input.rendererPolicy ?? DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
  );
  const locale = resolveExplanationLocale(input.locale, input.requestText);
  const references = explanationReferenceSchema
    .array()
    .max(128)
    .parse(input.references);
  const sourceProducts = projectSourceProducts(
    input.normalized.sourceProducts,
    policy,
  );
  const renderedFindings = input.normalized.findings.map((finding) =>
    renderFinding(
      finding,
      references,
      input.normalized.sourceProducts,
      locale,
      policy,
    ),
  );
  const explanationStatus = determineExplanationStatus(
    input.grounding,
    input.normalized.findings,
    input.normalized.gaps,
  );
  const questionKind = determineQuestionKind(
    input.normalized.findings,
    input.normalized.gaps,
    policy,
  );
  const renderedText = renderExplanationText(
    renderedFindings.map(({ text }) => text),
    input.normalized.gaps,
    explanationStatus,
    locale,
    policy.limits.maxRenderedCharacters,
  );
  const mapProjection = assembleMapProjection(
    input.normalized.findings,
    policy,
  );
  const rendererPolicyHash = hashRendererPolicy(policy);
  const explanationId =
    "world-explanation-" +
    hashCanonicalJson({
      groundingResultHash: input.grounding.resultHash,
      locale,
      consumerLockHash: input.consumerLockHash,
      findingProfileHash: input.findingProfileHash,
      rendererPolicyHash,
    }).slice(7, 39);
  const explanation = finalizeWorldExplanation({
    schemaVersion: "sacs-world-explanation/1.0",
    explanationId,
    locale,
    grounding: input.grounding,
    explanationStatus,
    questionKind,
    renderedText,
    findings: renderedFindings.map(({ summary }) => summary),
    references,
    sourceProducts,
    gaps: input.normalized.gaps,
    ...(mapProjection === undefined ? {} : { mapProjection }),
    provenance: {
      evidenceItemIds: [...input.evidenceItemIds],
      receiptIds: [...input.receiptIds],
      operationKeys: [...input.operationKeys],
      consumerLockHash: input.consumerLockHash,
      findingProfileHash: input.findingProfileHash,
      rendererPolicyHash,
    },
    createdAt: input.createdAt,
  });
  if (
    Buffer.byteLength(JSON.stringify(explanation), "utf8") >
    policy.limits.maxExplanationJsonBytes
  ) {
    throw new Error("WORLD_EXPLANATION_BYTE_LIMIT_EXCEEDED");
  }
  return explanation;
}

export function resolveExplanationLocale(
  explicitLocale: string | undefined,
  requestText = "",
): string {
  const explicit = explicitLocale?.trim();
  if (explicit !== undefined && explicit.length >= 2 && explicit.length <= 32) {
    return explicit;
  }
  return /\p{Script=Han}/u.test(requestText) ? "zh-CN" : "en";
}

export function determineQuestionKind(
  findings: readonly WorldFinding[],
  gaps: readonly ExplanationGap[],
  policy: RendererPolicy = DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
): QuestionKind {
  if (findings.length !== 1) {
    return findings.length === 0 &&
      gaps.some((gap) =>
        ["REFERENCE_AMBIGUITY", "PRODUCT_SELECTION_AMBIGUITY"].includes(
          gap.gapKind,
        ),
      )
      ? "REFERENCE_RESOLUTION"
      : "MULTI_FINDING";
  }
  const finding = findings[0];
  if (finding === undefined) return "MULTI_FINDING";
  const declared =
    policy.rules.querySemanticsQuestionKinds[finding.querySemantics];
  if (declared !== undefined) return declared;
  switch (finding.findingKind) {
    case "POINT_MEASUREMENT":
      return "POINT_VALUE";
    case "POINT_CLASSIFICATION":
      return "POINT_CLASSIFICATION";
    case "PROFILE":
      return "PROFILE";
    case "QUALIFIED_EXPLANATION":
      return "QUALIFIED_EXPLANATION";
    case "CATALOG":
      return "REFERENCE_RESOLUTION";
    case "SPATIAL_FEATURE_COLLECTION":
      return "MULTI_FINDING";
  }
}

export function determineExplanationStatus(
  grounding: GroundingIdentity,
  findings: readonly WorldFinding[],
  gaps: readonly ExplanationGap[],
): ExplanationStatus {
  if (grounding.status === "CANCELLED") return "CANCELLED";
  if (
    grounding.status === "FAILED" ||
    gaps.some(({ gapKind }) => gapKind === "UPSTREAM_FAILURE")
  ) {
    return "FAILED";
  }
  if (
    grounding.status === "AMBIGUOUS" ||
    gaps.some(({ gapKind }) =>
      ["REFERENCE_AMBIGUITY", "PRODUCT_SELECTION_AMBIGUITY"].includes(gapKind),
    )
  ) {
    return "CLARIFICATION_REQUIRED";
  }
  const availabilityGap = gaps.some(({ gapKind }) =>
    [
      "DATA_GAP",
      "COVERAGE_GAP",
      "CAPABILITY_GAP",
      "CURRENTNESS_UNAVAILABLE",
    ].includes(gapKind),
  );
  if (availabilityGap && findings.length === 0) return "DATA_UNAVAILABLE";
  if (
    grounding.status === "PARTIAL" ||
    availabilityGap ||
    gaps.some(({ gapKind }) =>
      [
        "SOURCE_CHANGED",
        "TRUNCATED",
        "UNSUPPORTED_FINDING_SCHEMA",
        "EVIDENCE_INCOMPLETE",
      ].includes(gapKind),
    ) ||
    findings.some(
      (finding) => finding.status === "PARTIAL" || isTruncated(finding),
    )
  ) {
    return "PARTIAL";
  }
  if (grounding.status === "UNRESOLVED" && findings.length === 0) {
    return "DATA_UNAVAILABLE";
  }
  return "COMPLETE";
}

function renderFinding(
  finding: WorldFinding,
  references: readonly ExplanationReference[],
  sourceProducts: readonly SourceProduct[],
  locale: string,
  policy: RendererPolicy,
): RenderedFinding {
  switch (finding.findingKind) {
    case "POINT_MEASUREMENT":
      return renderPointMeasurement(
        finding,
        references,
        sourceProducts,
        locale,
        policy,
      );
    case "POINT_CLASSIFICATION":
      return renderPointClassification(
        finding,
        references,
        sourceProducts,
        locale,
        policy,
      );
    case "SPATIAL_FEATURE_COLLECTION":
      return renderFeatureCollection(finding, sourceProducts, locale, policy);
    case "PROFILE":
      return renderProfile(finding, sourceProducts, locale, policy);
    case "QUALIFIED_EXPLANATION":
      return renderQualifiedExplanation(
        finding,
        sourceProducts,
        locale,
        policy,
      );
    case "CATALOG":
      return renderCatalog(finding, sourceProducts, locale, policy);
  }
}

function renderPointMeasurement(
  finding: PointMeasurementFinding,
  references: readonly ExplanationReference[],
  sourceProducts: readonly SourceProduct[],
  locale: string,
  policy: RendererPolicy,
): RenderedFinding {
  const concept = safeInline(finding.semanticConcept, 128);
  const subject = subjectPrefix(finding, references, locale);
  const measurement =
    String(finding.value) + " " + safeInline(finding.unit, 64);
  const headline = isCjkLocale(locale)
    ? "根据当前数据，" + subject + concept + "为 " + measurement + "。"
    : "According to the current data, " +
      subject +
      concept +
      " is " +
      measurement +
      ".";
  return renderedFinding(
    finding,
    headline,
    qualityDetails(finding, sourceProducts, locale, policy),
  );
}

function renderPointClassification(
  finding: PointClassificationFinding,
  references: readonly ExplanationReference[],
  sourceProducts: readonly SourceProduct[],
  locale: string,
  policy: RendererPolicy,
): RenderedFinding {
  const concept = safeInline(finding.semanticConcept, 128);
  const subject = subjectPrefix(finding, references, locale);
  const publishedClass = safeInline(
    finding.classLabel ?? finding.classCode,
    256,
  );
  const headline = isCjkLocale(locale)
    ? "根据当前数据，" + subject + concept + "分类为 " + publishedClass + "。"
    : "According to the current data, " +
      subject +
      concept +
      " is classified as " +
      publishedClass +
      ".";
  return renderedFinding(
    finding,
    headline,
    qualityDetails(finding, sourceProducts, locale, policy),
  );
}

function renderFeatureCollection(
  finding: SpatialFeatureCollectionFinding,
  sourceProducts: readonly SourceProduct[],
  locale: string,
  policy: RendererPolicy,
): RenderedFinding {
  const concept = safeInline(finding.semanticConcept, 128);
  const headline =
    finding.returnedCount === 0 && finding.features.length === 0
      ? isCjkLocale(locale)
        ? "在当前可用数据及查询范围内未发现符合条件的对象。"
        : "No matching objects were found in the currently available data and query extent."
      : isCjkLocale(locale)
        ? "根据当前数据，找到 " +
          String(finding.returnedCount) +
          " 个与 " +
          concept +
          " 相关的对象。"
        : "According to the current data, " +
          String(finding.returnedCount) +
          " objects related to " +
          concept +
          " were found.";
  const displayed = finding.features.slice(
    0,
    policy.limits.maxDisplayedFeatureSummaries,
  );
  const featureSummaries = displayed.map((feature) =>
    projectFeatureSummary(feature),
  );
  const details = [
    ...displayed
      .map((feature, index) => featureDetail(feature, index, locale))
      .filter((detail): detail is string => detail !== undefined),
    ...qualityDetails(finding, sourceProducts, locale, policy),
  ].slice(0, 32);
  const summary: RenderedFindingSummary = {
    findingId: finding.findingId,
    findingKind: finding.findingKind,
    semanticConcept: finding.semanticConcept,
    headline: boundCharacters(headline, 1_000),
    details: details.map((detail) => boundCharacters(detail, 1_000)),
    returnedCount: finding.returnedCount,
    truncated: finding.truncated,
    featureSummaries,
    evidenceItemIds: finding.evidenceItemIds,
    sourceProductIds: finding.sourceProductIds,
  };
  return {
    summary,
    text: [summary.headline, ...summary.details].join("\n"),
  };
}

function renderProfile(
  finding: ProfileFinding,
  sourceProducts: readonly SourceProduct[],
  locale: string,
  policy: RendererPolicy,
): RenderedFinding {
  const concept = safeInline(finding.semanticConcept, 128);
  const unit = safeInline(finding.unit, 64);
  const headline = isCjkLocale(locale)
    ? "根据当前数据，" +
      concept +
      "剖面包含 " +
      String(finding.samples.length) +
      " 个采样值，单位为 " +
      unit +
      "。"
    : "According to the current data, the " +
      concept +
      " profile contains " +
      String(finding.samples.length) +
      " samples in " +
      unit +
      ".";
  const sampleDetails = finding.samples
    .slice(0, policy.limits.maxDisplayedFeatureSummaries)
    .map(({ distanceM, value }) =>
      isCjkLocale(locale)
        ? "距离 " +
          String(distanceM) +
          " m 处的值为 " +
          String(value) +
          " " +
          unit +
          "。"
        : "At " +
          String(distanceM) +
          " m, the value is " +
          String(value) +
          " " +
          unit +
          ".",
    );
  return renderedFinding(finding, headline, [
    ...sampleDetails,
    ...qualityDetails(finding, sourceProducts, locale, policy),
  ]);
}

function renderQualifiedExplanation(
  finding: QualifiedExplanationFinding,
  sourceProducts: readonly SourceProduct[],
  locale: string,
  policy: RendererPolicy,
): RenderedFinding {
  return renderedFinding(
    finding,
    safeInline(finding.summary, 1_000),
    qualityDetails(finding, sourceProducts, locale, policy),
  );
}

function renderCatalog(
  finding: CatalogFinding,
  sourceProducts: readonly SourceProduct[],
  locale: string,
  policy: RendererPolicy,
): RenderedFinding {
  const headline = isCjkLocale(locale)
    ? "当前目录返回 " + String(finding.returnedCount) + " 项。"
    : "The current catalog returned " +
      String(finding.returnedCount) +
      " entries.";
  return renderedFinding(
    finding,
    headline,
    qualityDetails(finding, sourceProducts, locale, policy),
  );
}

function renderedFinding(
  finding: WorldFinding,
  headline: string,
  details: readonly string[],
): RenderedFinding {
  const summary: RenderedFindingSummary = {
    findingId: finding.findingId,
    findingKind: finding.findingKind,
    semanticConcept: finding.semanticConcept,
    headline: boundCharacters(headline, 1_000),
    details: details
      .slice(0, 32)
      .map((detail) => boundCharacters(detail, 1_000)),
    ...("returnedCount" in finding
      ? { returnedCount: finding.returnedCount }
      : {}),
    ...("truncated" in finding ? { truncated: finding.truncated } : {}),
    evidenceItemIds: finding.evidenceItemIds,
    sourceProductIds: finding.sourceProductIds,
  };
  return {
    summary,
    text: [summary.headline, ...summary.details].join("\n"),
  };
}

function qualityDetails(
  finding: WorldFinding,
  sourceProducts: readonly SourceProduct[],
  locale: string,
  policy: RendererPolicy,
): string[] {
  const sourceProductIds = new Set(finding.sourceProductIds);
  const details: string[] = [];
  for (const product of sourceProducts) {
    if (
      !sourceProductIds.has(product.sourceProductId) ||
      product.qualitySummary === undefined
    ) {
      continue;
    }
    for (const key of policy.rules.allowedQualityMetricKeys) {
      const value = product.qualitySummary[key];
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        continue;
      }
      const renderedValue =
        typeof value === "number"
          ? String(value)
          : safeInline(String(value), 256);
      details.push(
        isCjkLocale(locale)
          ? "质量信息：" + safeInline(key, 128) + "=" + renderedValue + "。"
          : "Quality: " + safeInline(key, 128) + "=" + renderedValue + ".",
      );
    }
  }
  return [...new Set(details)].slice(0, 32);
}

function renderExplanationText(
  findingTexts: readonly string[],
  gaps: readonly ExplanationGap[],
  status: ExplanationStatus,
  locale: string,
  limit: number,
): string {
  const lines = [...findingTexts.filter((text) => text.length > 0)];
  for (const gap of gaps) {
    const rendered = renderGap(gap, locale);
    if (rendered !== undefined && !lines.includes(rendered)) {
      lines.push(rendered);
    }
  }
  if (lines.length === 0) {
    lines.push(
      status === "CANCELLED"
        ? isCjkLocale(locale)
          ? "该世界查询已取消。"
          : "The world query was cancelled."
        : status === "FAILED"
          ? isCjkLocale(locale)
            ? "当前世界查询失败，无法形成安全结论。"
            : "The world query failed, so no safe conclusion can be formed."
          : isCjkLocale(locale)
            ? "当前数据不足以形成安全的事实结论。"
            : "The current data is insufficient to form a safe factual conclusion.",
    );
  }
  return boundCharacters(lines.join("\n"), limit);
}

function renderGap(gap: ExplanationGap, locale: string): string | undefined {
  const cjk = isCjkLocale(locale);
  switch (gap.gapKind) {
    case "DATA_GAP":
      return cjk
        ? "当前没有可用于回答该问题的数据产品，不能判断目标是否存在。"
        : "No current data product is available to answer this question, so existence cannot be determined.";
    case "COVERAGE_GAP":
      return cjk
        ? "当前数据未完整覆盖查询范围，不能给出完整结论。"
        : "The current data does not fully cover the query extent, so a complete conclusion cannot be given.";
    case "CAPABILITY_GAP":
      return cjk
        ? "当前世界能力无法执行该分析。"
        : "The current world capability cannot perform this analysis.";
    case "REFERENCE_AMBIGUITY":
      return cjk
        ? "引用对象存在歧义，请先选择要查询的对象。"
        : "The referenced object is ambiguous; select the object to query.";
    case "PRODUCT_SELECTION_AMBIGUITY":
      return cjk
        ? "可用数据产品存在歧义，请先明确选择。"
        : "The available data product is ambiguous; select one explicitly.";
    case "SOURCE_CHANGED":
      return cjk
        ? "查询期间数据源已变化，当前结果不能作为确定的最新结论。"
        : "The source changed during the query, so this result is not a definitive current conclusion.";
    case "TRUNCATED":
      return cjk
        ? "结果已截断，仅显示部分内容。"
        : "The result was truncated and only partial content is shown.";
    case "UNSUPPORTED_FINDING_SCHEMA":
      return cjk
        ? "上游结果格式当前无法安全解释，未据此形成事实结论。"
        : "The upstream result format cannot be interpreted safely, so it was not used to form a factual claim.";
    case "EVIDENCE_INCOMPLETE":
      return cjk
        ? "部分结果缺少闭合证据，未纳入事实结论。"
        : "Some results lacked closed evidence and were excluded from factual claims.";
    case "UPSTREAM_FAILURE":
      return cjk
        ? "上游世界查询失败，无法形成安全结论。"
        : "The upstream world query failed, so no safe conclusion can be formed.";
    case "CURRENTNESS_UNAVAILABLE":
      return cjk
        ? "当前无法验证数据源是否仍为最新，不能将历史结果作为当前事实。"
        : "Source currentness cannot be verified, so the historical result cannot be presented as a current fact.";
  }
}

export function projectSourceProducts(
  sourceProducts: readonly SourceProduct[],
  policy: RendererPolicy = DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
): SanitizedExplanationSourceProduct[] {
  return sourceProducts.map((product) => {
    const qualitySummary =
      product.qualitySummary === undefined
        ? undefined
        : sanitizeQualitySummary(
            product.qualitySummary,
            policy.rules.allowedQualityMetricKeys,
          );
    return {
      sourceProductId: product.sourceProductId,
      authority: product.authority,
      productId: product.productId,
      productType: product.productType,
      productProfile: product.productProfile,
      contentHash: product.contentHash,
      descriptorId: product.descriptorId,
      descriptorHash: product.descriptorHash,
      ...(product.dataTime === undefined ? {} : { dataTime: product.dataTime }),
      ...(qualitySummary === undefined ? {} : { qualitySummary }),
    };
  });
}

export function assembleMapProjection(
  findings: readonly WorldFinding[],
  policy: RendererPolicy = DEFAULT_WORLD_EXPLANATION_RENDERER_POLICY,
): MapProjection | undefined {
  const features: MapProjectionFeature[] = [];
  const warnings: string[] = [];
  let truncated = false;

  findingLoop: for (const finding of findings) {
    if (
      finding.findingKind === "POINT_MEASUREMENT" ||
      finding.findingKind === "POINT_CLASSIFICATION"
    ) {
      if (features.length >= policy.limits.maxMapFeatures) {
        truncated = true;
        break;
      }
      features.push({
        projectionId: projectionId(finding.findingId, "point"),
        findingId: finding.findingId,
        semanticRole: safeInline(finding.semanticConcept, 128),
        geometry: cloneJsonObject(finding.point),
      });
      continue;
    }
    if (finding.findingKind !== "SPATIAL_FEATURE_COLLECTION") continue;
    for (const feature of finding.features) {
      const projected = projectSpatialFeature(
        finding,
        feature,
        policy,
        warnings,
      );
      if (projected !== undefined) {
        if (features.length >= policy.limits.maxMapFeatures) {
          truncated = true;
          break findingLoop;
        }
        features.push(projected);
      }
    }
  }
  if (features.length === 0 && warnings.length === 0) return undefined;
  return mapProjectionSchema.parse({
    schemaVersion: "sacs-map-projection/1.0",
    features,
    truncated,
    warnings: [...new Set(warnings)].slice(0, 32),
  });
}

function projectSpatialFeature(
  finding: SpatialFeatureCollectionFinding,
  feature: SpatialFeature,
  policy: RendererPolicy,
  warnings: string[],
): MapProjectionFeature | undefined {
  const base = {
    projectionId: projectionId(finding.findingId, feature.featureId),
    findingId: finding.findingId,
    featureId: feature.featureId,
    semanticRole: safeInline(finding.semanticConcept, 128),
    ...(feature.displayName === undefined
      ? {}
      : { label: safeInline(feature.displayName, 512) }),
  };
  for (const locator of policy.rules.mapLocatorPriority) {
    if (locator === "UPSTREAM_GEOMETRY" && feature.geometry !== undefined) {
      if (
        Buffer.byteLength(JSON.stringify(feature.geometry), "utf8") <=
        policy.limits.maxInlineGeometryBytes
      ) {
        return { ...base, geometry: cloneJsonObject(feature.geometry) };
      }
      warnings.push("INLINE_GEOMETRY_OMITTED");
    }
    if (locator === "REFERENCE_KEY" && feature.referenceKey !== undefined) {
      return { ...base, referenceKey: feature.referenceKey };
    }
    if (
      locator === "PAYLOAD_REF" &&
      feature.payloadRef !== undefined &&
      isSafePayloadRef(feature.payloadRef)
    ) {
      return { ...base, payloadRef: feature.payloadRef };
    }
  }
  return undefined;
}

function projectionId(findingId: string, featureIdentity: string): string {
  return (
    "projection-" +
    hashCanonicalJson({ findingId, featureIdentity }).slice(7, 39)
  );
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function sanitizeQualitySummary(
  qualitySummary: JsonObject,
  allowedKeys: readonly string[],
): JsonObject | undefined {
  const sanitized: JsonObject = {};
  for (const key of allowedKeys) {
    const value = qualitySummary[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    } else if (typeof value === "boolean") {
      sanitized[key] = value;
    } else if (typeof value === "string") {
      sanitized[key] = safeInline(value, 256);
    }
  }
  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

function projectFeatureSummary(
  feature: SpatialFeature,
): NonNullable<RenderedFindingSummary["featureSummaries"]>[number] {
  return {
    featureId: feature.featureId,
    ...(feature.displayName === undefined
      ? {}
      : { displayName: safeInline(feature.displayName, 512) }),
    ...(feature.classCode === undefined
      ? {}
      : { classCode: safeInline(feature.classCode, 128) }),
    ...(feature.classLabel === undefined
      ? {}
      : { classLabel: safeInline(feature.classLabel, 256) }),
    ...(feature.areaM2 === undefined ? {} : { areaM2: feature.areaM2 }),
    ...(feature.lengthM === undefined ? {} : { lengthM: feature.lengthM }),
    ...(feature.distanceM === undefined
      ? {}
      : { distanceM: feature.distanceM }),
    ...(feature.referenceKey === undefined
      ? {}
      : { referenceKey: feature.referenceKey }),
  };
}

function featureDetail(
  feature: SpatialFeature,
  index: number,
  locale: string,
): string | undefined {
  const label =
    feature.displayName === undefined
      ? feature.classLabel === undefined
        ? undefined
        : safeInline(feature.classLabel, 256)
      : safeInline(feature.displayName, 512);
  const metrics = [
    feature.distanceM === undefined
      ? undefined
      : "distanceM=" + String(feature.distanceM),
    feature.areaM2 === undefined
      ? undefined
      : "areaM2=" + String(feature.areaM2),
    feature.lengthM === undefined
      ? undefined
      : "lengthM=" + String(feature.lengthM),
  ].filter((value): value is string => value !== undefined);
  if (label === undefined && metrics.length === 0) return undefined;
  const prefix =
    label ??
    (isCjkLocale(locale)
      ? "第 " + String(index + 1) + " 个对象"
      : "Object " + String(index + 1));
  return metrics.length === 0
    ? prefix
    : prefix + " (" + metrics.join(", ") + ")";
}

function subjectPrefix(
  finding: WorldFinding,
  references: readonly ExplanationReference[],
  locale: string,
): string {
  const subjectId = finding.subjectReferenceProductIds?.[0];
  const reference = references.find(({ productId }) => productId === subjectId);
  if (reference === undefined) return "";
  return (
    safeInline(reference.displayName, 512) + (isCjkLocale(locale) ? "的" : " ")
  );
}

function safeInline(value: string, limit: number): string {
  const redacted = value
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(
      /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/giu,
      "$1://[REDACTED]@",
    )
    .replace(
      /(password|secret|token|api[_-]?key)\s*[:=]\s*\S+/giu,
      "$1=[REDACTED]",
    );
  const withoutControls = Array.from(redacted)
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  const escaped = withoutControls
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\`*_{}[\]()#!|~]/gu, "\\$&");
  return boundCharacters(escaped, limit);
}

function boundCharacters(value: string, limit: number): string {
  const characters = Array.from(value);
  if (characters.length <= limit) return value;
  if (limit === 1) return "…";
  return characters.slice(0, limit - 1).join("") + "…";
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

function isTruncated(finding: WorldFinding): boolean {
  return (
    (finding.findingKind === "SPATIAL_FEATURE_COLLECTION" ||
      finding.findingKind === "PROFILE" ||
      finding.findingKind === "CATALOG") &&
    finding.truncated
  );
}

function isCjkLocale(locale: string): boolean {
  return /^(?:zh|ja|ko)(?:-|$)/iu.test(locale);
}
