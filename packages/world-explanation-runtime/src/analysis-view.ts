import { z } from "zod";
import {
  mapLayerDescriptorSchema,
  type MapLayerDescriptor,
} from "../../analysis-contract/src/index.js";
import {
  sourceStatusMapping,
  type AnalysisSourceSnapshot,
} from "../../analysis-contract/src/source.js";
import {
  hashCanonicalJson,
  type JsonObject,
  type JsonValue,
} from "../../world-explanation-contract/src/index.js";
import { WsgsAuthoritativeContract } from "../../wsgs-geospatial-consumer/src/authoritative.js";
import type { LegacyWsgsGroundingResult } from "../../wsgs-http-adapter/src/index.js";
import {
  normalizeFrozenAnalysis,
  type FrozenChoiceView,
  type FrozenAnalysisView,
} from "./frozen-analysis-view.js";
import {
  assertBoundedAnalysisJson,
  WsgsResultSchemaRegistry,
} from "../../wsgs-geospatial-consumer/src/analysis-payload.js";
export {
  assertBoundedAnalysisJson,
  WsgsResultSchemaRegistry,
} from "../../wsgs-geospatial-consumer/src/analysis-payload.js";

const point = z.strictObject({
  type: z.literal("Point"),
  coordinates: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]),
});
const period = z
  .strictObject({ start: z.iso.datetime(), end: z.iso.datetime() })
  .refine((p) => Date.parse(p.start) <= Date.parse(p.end));
const base = {
  findingId: z.string().min(1).max(256),
  status: z.enum(["COMPLETED", "PARTIAL", "NO_DATA", "INDETERMINATE"]),
  evidenceItemIds: z.array(z.string().max(256)).max(128),
  warnings: z.array(z.string().max(4096)).max(128),
};
/** Internal models only: the locked main has no authoritative historical binding. */
export const historicalFindingSchema = z.discriminatedUnion("findingKind", [
  z.strictObject({
    ...base,
    findingKind: z.literal("HISTORICAL_ROAD_ASSOCIATION"),
    networkRole: z.literal("REFERENCE_MODEL_NOT_PHYSICAL_TRUTH"),
    roadVisits: z
      .array(
        z.strictObject({
          roadId: z.string(),
          displayName: z.string(),
          period,
          point: point.optional(),
        }),
      )
      .max(1000),
    offNetworkSegments: z.array(period).max(1000),
    ambiguousPeriods: z.array(period).max(1000),
    qualityBreakPeriods: z.array(period).max(1000),
    upstreamGapPeriods: z.array(period).max(1000),
    associationSuffixComplete: z.boolean(),
  }),
  z.strictObject({
    ...base,
    findingKind: z.literal("HISTORICAL_TEMPORAL_EVENT"),
    eventType: z.enum(["ENTER", "EXIT", "DWELL", "STOP", "PASS_NEAR", "CROSS"]),
    events: z
      .array(
        z.strictObject({
          eventId: z.string(),
          instant: z.iso.datetime().optional(),
          period: period.optional(),
          point: point.optional(),
        }),
      )
      .max(1000),
    selection: z
      .strictObject({
        kind: z.enum(["FIRST", "LAST"]),
        selectedEventId: z.string().optional(),
        confirmed: z.boolean(),
        reasonCode: z.string(),
      })
      .optional(),
    blockingPeriods: z.array(period).max(1000),
  }),
  z.strictObject({
    ...base,
    findingKind: z.literal("HISTORICAL_METRIC_RANKING"),
    metricConceptId: z.string(),
    candidateDomain: z.literal("PAST_OBSERVED_LOCATIONS"),
    candidates: z
      .array(
        z.strictObject({
          candidateId: z.string(),
          rank: z.number().int().min(1),
          value: z.number().optional(),
          representativeVisitedPosition: point,
          observedAt: z.iso.datetime().optional(),
          h3CellId: z.string().optional(),
        }),
      )
      .max(100),
    metricTemporalCompletenessKnown: z.literal(false),
  }),
  z.strictObject({
    ...base,
    findingKind: z.literal("HISTORICAL_ACTION_TARGET_CANDIDATE"),
    position: point,
    sourceRank: z.number().int().min(1),
    currentValidationRequired: z.literal(true),
    routePlanningRequired: z.literal(true),
    executionAuthorized: z.literal(false),
  }),
]);
export type HistoricalFinding = z.infer<typeof historicalFindingSchema>;
export interface WorldAnalysisTimelineItem {
  itemId: string;
  kind:
    | "ROAD_VISIT"
    | "OFF_NETWORK"
    | "AMBIGUITY"
    | "QUALITY_BREAK"
    | "DATA_GAP"
    | "PAUSED_EXCLUDED"
    | "TRAJECTORY_DEFINED"
    | "TASK_INTERVAL"
    | "ACTIVE_PHASE"
    | "INSTANT_EVENT"
    | "INTERVAL_EVENT"
    | "METRIC_OBSERVATION";
  sourceId: "wsgs";
  start: string;
  end?: string;
  findingId?: string;
  resultHash?: string;
  bounds?: "[)" | "[]" | "(]" | "()" | "UNSPECIFIED";
  extent?: JsonObject;
  sourceEventId?: string;
  periodRole?: string;
  evidenceItemIds: string[];
}
export interface WorldAnalysisViewModel {
  schemaVersion: "sacs-world-analysis-view/1.0";
  analysisId: string;
  revisionId: string;
  runId: string;
  groundingId: string;
  status: (typeof sourceStatusMapping)[keyof typeof sourceStatusMapping]["view"];
  source: {
    kind: string;
    sourceId: string;
    sourceHash: string;
    contractVersion: string;
    resultProfile: string;
    resultHash?: string;
  };
  summary: { title: string; primaryText: string; qualifiers: string[] };
  findings: JsonObject[];
  sourceProducts: JsonObject[];
  map: { sceneRevision: number; layers: MapLayerDescriptor[] };
  timeline: {
    items: WorldAnalysisTimelineItem[];
    sources: Record<
      string,
      { sourceKind: "WSGS"; timeSemantics: string; displayRole: "HISTORICAL" }
    >;
  };
  choices: (
    | { choiceId: string; productId: string; displayName: string }
    | FrozenChoiceView
  )[];
  actionTargets: (
    | Extract<
        HistoricalFinding,
        { findingKind: "HISTORICAL_ACTION_TARGET_CANDIDATE" }
      >
    | FrozenAnalysisView["actionTargets"][number]
  )[];
  evidenceLinks?: FrozenAnalysisView["evidenceLinks"];
  evidenceItemIds: string[];
  typedGaps: JsonObject[];
  warnings: string[];
  currentness: "CURRENT" | "STALE" | "UNKNOWN";
}
export interface AnalysisAnswerProjection {
  headline: string;
  facts: string[];
  qualifiers: string[];
  choices: string[];
  unavailableCapabilities: string[];
}

const unique = (values: string[]) => [...new Set(values)].sort();
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const objects = (value: unknown): JsonObject[] =>
  Array.isArray(value) ? (value as JsonObject[]) : [];
export const analysisViewLimitsSchema = z.strictObject({
  maxMapLayers: z.number().int().min(1).max(128).default(128),
  maxTimelineItems: z.number().int().min(1).max(1000).default(1000),
  maxResultCandidates: z.number().int().min(1).max(100).default(100),
  maxSafePayloadBytes: z.number().int().min(1024).max(262144).default(262144),
});
export type AnalysisViewLimits = z.infer<typeof analysisViewLimitsSchema>;
export function normalizeWorldAnalysis(input: {
  analysisId: string;
  revisionId: string;
  runId: string;
  snapshot: AnalysisSourceSnapshot;
  authority?: WsgsAuthoritativeContract;
  limits?: Partial<AnalysisViewLimits>;
  now?: () => number;
}): WorldAnalysisViewModel {
  const { snapshot } = input;
  const limits = analysisViewLimitsSchema.parse(input.limits ?? {});
  if (
    snapshot.identity.kind === "WSGS_GROUNDING_JOB" &&
    snapshot.identity.contractIdentity?.contractVersion ===
      "sacs-wsgs-grounding/1.2"
  )
    return normalizeFrozenAnalysis({ ...input, limits });
  const authority = input.authority ?? new WsgsAuthoritativeContract();
  const registry = new WsgsResultSchemaRegistry(
    authority,
    limits.maxSafePayloadBytes,
  );
  const view: WorldAnalysisViewModel = {
    schemaVersion: "sacs-world-analysis-view/1.0",
    analysisId: input.analysisId,
    revisionId: input.revisionId,
    runId: input.runId,
    groundingId: snapshot.identity.sourceId,
    status: sourceStatusMapping[snapshot.sourceStatus].view,
    source: {
      kind: snapshot.identity.kind,
      sourceId: snapshot.identity.sourceId,
      sourceHash: snapshot.identity.sourceHash,
      contractVersion: "sacs-wsgs-grounding/1.1",
      resultProfile: "sacs-wsgs-geospatial-findings/1.0",
      ...(snapshot.resultHash ? { resultHash: snapshot.resultHash } : {}),
    },
    summary: { title: "世界分析", primaryText: "", qualifiers: [] },
    findings: [],
    sourceProducts: [],
    map: { sceneRevision: 0, layers: [] },
    timeline: {
      items: [],
      sources: {
        wsgs: {
          sourceKind: "WSGS",
          timeSemantics: "DERIVED_WORLD_ANALYSIS",
          displayRole: "HISTORICAL",
        },
      },
    },
    choices: [],
    actionTargets: [],
    evidenceItemIds: [],
    typedGaps: [],
    warnings: [],
    currentness: "UNKNOWN",
  };
  // This branch is the isolated legacy 1.1 mapper. It still validates before use.
  const result = snapshot.result as LegacyWsgsGroundingResult | undefined;
  if (result) {
    assertBoundedAnalysisJson(result);
    authority.validate("result", result);
    if (
      result.groundingId !== snapshot.identity.sourceId ||
      result.resultHash !== snapshot.resultHash ||
      result.status !== snapshot.sourceStatus
    )
      throw Error("ANALYSIS_SOURCE_IDENTITY_INVALID");
    const geo = result.geospatialFindings as unknown as JsonObject | undefined;
    if (geo) {
      view.findings = cloneJson(objects(geo["findings"]));
      view.sourceProducts = cloneJson(objects(geo["sourceProducts"]));
      view.typedGaps = cloneJson(objects(geo["gaps"]));
    }
    for (const reference of result.referenceProducts)
      view.findings.push({
        findingKind: "WORLD_REFERENCE",
        findingId: reference.productId,
        ...cloneJson(reference),
      });
    for (const evidence of result.evidenceItems) {
      view.evidenceItemIds.push(evidence.evidenceProductId);
      view.warnings.push(...evidence.warnings);
      const decoded = registry.resolve(evidence);
      if (decoded.finding) view.findings.push(decoded.finding);
      if (decoded.unsupported)
        view.typedGaps.push({
          gapKind: "UNSUPPORTED_FINDING_SCHEMA",
          severity: "WARNING",
          messageCode: "WSGS_RESULT_SCHEMA_UNSUPPORTED",
          evidenceItemIds: [evidence.evidenceProductId],
        });
    }
    for (const ambiguity of result.ambiguities)
      for (const productId of ambiguity.candidateProductIds) {
        const product = result.referenceProducts.find(
          (p) => p.productId === productId,
        );
        if (product)
          view.choices.push({
            choiceId: ambiguity.ambiguityId,
            productId,
            displayName: product.displayName,
          });
      }
    view.warnings = unique([...view.warnings, ...result.warnings]);
    view.evidenceItemIds = unique(view.evidenceItemIds);
  }
  view.findings.sort((a, b) =>
    String(a["findingId"]).localeCompare(String(b["findingId"]), "en"),
  );
  for (const finding of view.findings) projectPublishedFinding(view, finding);
  if (view.map.layers.length > limits.maxMapLayers) {
    view.map.layers = view.map.layers.slice(0, limits.maxMapLayers);
    view.typedGaps.push({
      gapKind: "TRUNCATED",
      severity: "WARNING",
      messageCode: "MAP_LAYER_LIMIT",
    });
  }
  if (view.choices.length > limits.maxResultCandidates) {
    view.choices = view.choices.slice(0, limits.maxResultCandidates);
    view.typedGaps.push({
      gapKind: "TRUNCATED",
      severity: "WARNING",
      messageCode: "CHOICE_LIMIT",
    });
  }
  if (view.timeline.items.length > limits.maxTimelineItems) {
    view.timeline.items = view.timeline.items.slice(0, limits.maxTimelineItems);
    view.typedGaps.push({
      gapKind: "TRUNCATED",
      severity: "WARNING",
      messageCode: "TIMELINE_ITEM_LIMIT",
    });
  }
  const answer = projectAnalysisAnswer(view);
  const text = [answer.headline, ...answer.facts, ...answer.qualifiers].join(
    "\n",
  );
  if (text.length > 8192) {
    view.typedGaps.push({
      gapKind: "TRUNCATED",
      severity: "WARNING",
      messageCode: "SUMMARY_TEXT_LIMIT",
    });
    answer.qualifiers.push(
      "摘要已达到展示上限，完整已发布结果保留在结构化视图中。",
    );
  }
  view.summary = {
    title: answer.headline,
    primaryText:
      text.length > 8192 ? text.slice(0, 8100) + "\n摘要已截断。" : text,
    qualifiers: answer.qualifiers,
  };
  assertBoundedAnalysisJson(view);
  return view;
}
function projectPublishedFinding(
  view: WorldAnalysisViewModel,
  f: JsonObject,
): void {
  const id = String(f["findingId"]);
  const add = (suffix: string, access: MapLayerDescriptor["access"]) =>
    view.map.layers.push(
      mapLayerDescriptorSchema.parse({
        schemaVersion: "sacs-map-layer/1.0",
        layerId: "layer-" + hashCanonicalJson({ id, suffix }).slice(7, 39),
        title: String(
          f["semanticConcept"] ?? f["displayName"] ?? f["findingKind"],
        ),
        role: "FINAL_FINDING",
        representation: access.kind,
        access,
        sourceAuthority: "WSGS",
        visibleByDefault: true,
        selectable: true,
        editable: false,
        analysisId: view.analysisId,
        revisionId: view.revisionId,
        findingIds: [id],
        loadStatus: "READY",
        relevanceStatus: "ACTIVE",
        currentness: "UNKNOWN",
        styleToken: "finding.primary",
      }),
    );
  if (
    (f["findingKind"] === "POINT_MEASUREMENT" ||
      f["findingKind"] === "POINT_CLASSIFICATION") &&
    f["point"]
  )
    add("point", { kind: "INLINE_GEOJSON", data: point.parse(f["point"]) });
  if (f["findingKind"] === "SPATIAL_FEATURE_COLLECTION")
    for (const [i, feature] of objects(f["features"]).entries()) {
      if (feature["geometry"])
        add(String(i), {
          kind: "INLINE_GEOJSON",
          data: feature["geometry"] as JsonObject,
        });
      else if (feature["referenceKey"])
        add(String(i), {
          kind: "REFERENCE_SET",
          referenceKeys: [feature["referenceKey"] as JsonObject],
        });
    }
  if (f["findingKind"] === "WORLD_REFERENCE" && f["referenceKey"])
    add("reference", {
      kind: "REFERENCE_SET",
      referenceKeys: [f["referenceKey"] as JsonObject],
    });
  // PROFILE samples and bounded trajectory previews are deliberately not joined.
}
export function projectAnalysisAnswer(
  view: Pick<
    WorldAnalysisViewModel,
    "status" | "findings" | "choices" | "typedGaps"
  >,
): AnalysisAnswerProjection {
  const facts: string[] = [];
  const qualifiers: string[] = [];
  if (view.status === "PARTIAL")
    qualifiers.push("以下结论仅基于可用的部分数据。");
  if (view.status === "UNRESOLVED")
    qualifiers.push("目前无法确定；未找到数据不表示数值为零或事件未发生。");
  for (const f of view.findings) {
    if (f["status"] === "NO_DATA" || f["status"] === "INDETERMINATE") {
      qualifiers.push("缺少足够数据，无法确认结果；不应解释为零或未发生。");
      continue;
    }
    if (f["status"] === "PARTIAL" || f["truncated"] === true)
      qualifiers.push("结果不完整，仅展示已发布的部分内容。");
    if (f["findingKind"] === "POINT_MEASUREMENT")
      facts.push(
        `${String(f["semanticConcept"])}: ${String(f["value"])} ${String(f["unit"])}`,
      );
    if (f["findingKind"] === "POINT_CLASSIFICATION")
      facts.push(
        `${String(f["semanticConcept"])}: ${String(f["classLabel"] ?? f["classCode"])}`,
      );
    if (f["findingKind"] === "WORLD_REFERENCE")
      facts.push(String(f["displayName"]));
  }
  if (view.typedGaps.length)
    qualifiers.push("存在数据或契约缺口，未推断缺失事实或几何。");
  return {
    headline:
      view.status === "RUNNING"
        ? "世界分析进行中"
        : view.status === "WAITING_SELECTION"
          ? "需要选择明确的世界对象"
          : "世界分析结果",
    facts: facts.slice(0, 100),
    qualifiers: unique(qualifiers),
    choices: view.choices.map((c) => c.displayName),
    unavailableCapabilities: unique(
      view.typedGaps.map((g) => String(g["messageCode"] ?? g["gapKind"])),
    ),
  };
}
export function hashWorldAnalysisView(view: WorldAnalysisViewModel) {
  return hashCanonicalJson(view as unknown as JsonValue);
}

/** Pure internal mechanics. Production admission still requires a locked registry binding. */
export function projectHistoricalFinding(
  view: WorldAnalysisViewModel,
  value: unknown,
): WorldAnalysisViewModel {
  assertBoundedAnalysisJson(value, 262144);
  const f = historicalFindingSchema.parse(value);
  const next = cloneJson(view);
  next.findings.push(f as unknown as JsonObject);
  const interval = (
    kind: WorldAnalysisTimelineItem["kind"],
    range: { start: string; end?: string },
    suffix: string,
  ) =>
    next.timeline.items.push({
      itemId: f.findingId + "-" + suffix,
      kind,
      sourceId: "wsgs",
      ...range,
      evidenceItemIds: f.evidenceItemIds,
    });
  const position = (
    p: z.infer<typeof point>,
    suffix: string,
    styleToken: MapLayerDescriptor["styleToken"] = "finding.primary",
  ) =>
    next.map.layers.push(
      mapLayerDescriptorSchema.parse({
        schemaVersion: "sacs-map-layer/1.0",
        layerId:
          "layer-" +
          hashCanonicalJson({ id: f.findingId, suffix }).slice(7, 39),
        title: f.findingKind,
        role: styleToken === "focus.execution" ? "FOCUS" : "FINAL_FINDING",
        representation: "INLINE_GEOJSON",
        access: { kind: "INLINE_GEOJSON", data: p },
        sourceAuthority: "WSGS",
        visibleByDefault: true,
        selectable: true,
        editable: false,
        analysisId: next.analysisId,
        revisionId: next.revisionId,
        findingIds: [f.findingId],
        loadStatus: "READY",
        relevanceStatus: "ACTIVE",
        currentness: "UNKNOWN",
        styleToken,
      }),
    );
  if (f.findingKind === "HISTORICAL_ROAD_ASSOCIATION") {
    for (const [i, visit] of f.roadVisits.entries()) {
      interval("ROAD_VISIT", visit.period, "visit-" + i);
      if (visit.point) position(visit.point, "visit-" + i);
    }
    for (const [kind, ranges] of [
      ["OFF_NETWORK", f.offNetworkSegments],
      ["AMBIGUITY", f.ambiguousPeriods],
      ["QUALITY_BREAK", f.qualityBreakPeriods],
      ["DATA_GAP", f.upstreamGapPeriods],
    ] as const)
      for (const [i, p] of ranges.entries()) interval(kind, p, kind + "-" + i);
    if (f.offNetworkSegments.length)
      next.summary.qualifiers.push("未关联到当前参考路网；这不表示轨迹错误。");
    if (!f.associationSuffixComplete)
      next.summary.qualifiers.push(
        "道路关联后缀不完整，只能确认已发布的道路访问。",
      );
  }
  if (f.findingKind === "HISTORICAL_TEMPORAL_EVENT") {
    for (const event of f.events) {
      if (event.instant)
        interval("INSTANT_EVENT", { start: event.instant }, event.eventId);
      else if (event.period)
        interval("INTERVAL_EVENT", event.period, event.eventId);
      if (event.point) position(event.point, event.eventId);
    }
    for (const [i, p] of f.blockingPeriods.entries())
      interval("DATA_GAP", p, "blocking-" + i);
    if (f.selection?.kind === "LAST" && !f.selection.confirmed)
      next.summary.qualifiers.push(
        "这是最后已确认项，无法断言为绝对最后一项。",
      );
  }
  if (f.findingKind === "HISTORICAL_METRIC_RANKING") {
    next.summary.qualifiers.push(
      "排名仅基于可用历史样本；不代表当前最佳，指标时间覆盖完整性未知。",
    );
    for (const candidate of f.candidates) {
      position(
        candidate.representativeVisitedPosition,
        candidate.candidateId,
        "finding.candidate",
      );
      if (candidate.observedAt)
        interval(
          "METRIC_OBSERVATION",
          { start: candidate.observedAt },
          candidate.candidateId,
        );
    }
  }
  if (f.findingKind === "HISTORICAL_ACTION_TARGET_CANDIDATE") {
    next.actionTargets.push(f);
    position(f.position, "target", "focus.execution");
    next.summary.qualifiers.push(
      "历史候选需当前有效性验证及路线规划；未授权执行。",
    );
  }
  if (f.status === "NO_DATA" || f.status === "INDETERMINATE")
    next.summary.qualifiers.push(
      "可用数据不足，无法确认；不等于零或事件未发生。",
    );
  next.evidenceItemIds = unique([
    ...next.evidenceItemIds,
    ...f.evidenceItemIds,
  ]);
  next.warnings = unique([...next.warnings, ...f.warnings]);
  next.summary.qualifiers = unique(next.summary.qualifiers);
  next.summary.primaryText = [
    next.summary.primaryText,
    ...next.summary.qualifiers,
  ]
    .join("\n")
    .slice(0, 8192);
  next.timeline.items.sort(
    (a, b) =>
      a.start.localeCompare(b.start) || a.itemId.localeCompare(b.itemId),
  );
  if (next.map.layers.length > 128 || next.timeline.items.length > 1000) {
    next.map.layers = next.map.layers.slice(0, 128);
    next.timeline.items = next.timeline.items.slice(0, 1000);
    next.typedGaps.push({
      gapKind: "TRUNCATED",
      severity: "WARNING",
      messageCode: "HISTORICAL_PROJECTION_LIMIT",
    });
    next.summary.qualifiers.push("展示数量已达到上限，结果已截断。");
  }
  assertBoundedAnalysisJson(next);
  return next;
}
