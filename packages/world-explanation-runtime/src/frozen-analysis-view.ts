import { mapLayerDescriptorSchema } from "../../analysis-contract/src/index.js";
import {
  parseGroundingContractIdentity,
  sourceStatusMapping,
  type AnalysisSourceSnapshot,
} from "../../analysis-contract/src/source.js";
import {
  FrozenWorldAnalysisContract,
  publicCanonicalHash,
  type WorldAnalysisFindings,
  type AnalysisSelection,
  type Choice,
} from "../../wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import type { JsonObject } from "../../world-explanation-contract/src/index.js";
import type {
  WorldAnalysisViewModel,
  WorldAnalysisTimelineItem,
  AnalysisViewLimits,
} from "./analysis-view.js";

type Finding = WorldAnalysisFindings["findings"][number];
type Action = Extract<Finding, { findingKind: "ACTION_TARGET_CANDIDATE" }>;
type Point = { type: "Point"; coordinates: [number, number] };
type Range = {
  start: string;
  end: string;
  bounds: "[)" | "[]" | "(]" | "()" | "UNSPECIFIED";
};
export interface FrozenChoiceView {
  choiceId: string;
  choiceKind: Choice["choiceKind"];
  candidateId: string;
  productId?: string;
  displayName: string;
  validUntil: string;
  enabled: boolean;
  selector: AnalysisSelection;
  sourceFindingId?: string;
}
export interface FrozenTimelineItem extends WorldAnalysisTimelineItem {
  findingId: string;
  resultHash: string;
  bounds?: Range["bounds"];
  extent?: JsonObject;
  sourceEventId?: string;
  periodRole?: string;
}
export interface FrozenAnalysisView extends Omit<
  WorldAnalysisViewModel,
  "choices" | "actionTargets"
> {
  choices: FrozenChoiceView[];
  actionTargets: Action[];
  evidenceLinks: {
    findingId: string;
    evidenceProductId: string;
    upstreamEvidenceIds: string[];
    receiptIds: string[];
  }[];
}
// Serialization boundary after public validation, not inference from arbitrary fields.
const json = (value: unknown): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject;
const unique = (values: string[]) => [...new Set(values)];
export function normalizeFrozenAnalysis(input: {
  analysisId: string;
  revisionId: string;
  runId: string;
  snapshot: AnalysisSourceSnapshot;
  limits: AnalysisViewLimits;
  now?: () => number;
}): FrozenAnalysisView {
  const { snapshot, limits } = input;
  if (snapshot.identity.kind !== "WSGS_GROUNDING_JOB")
    throw Error("ANALYSIS_SOURCE_IDENTITY_INVALID");
  const identity = parseGroundingContractIdentity(
    snapshot.identity.contractIdentity,
  );
  if (identity.contractVersion !== "sacs-wsgs-grounding/1.2")
    throw Error("ANALYSIS_SOURCE_CONTRACT_IDENTITY_INVALID");
  const view: FrozenAnalysisView = {
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
      ...identity,
      ...(snapshot.resultHash ? { resultHash: snapshot.resultHash } : {}),
    },
    summary: {
      title: "世界分析",
      primaryText: "世界分析进行中",
      qualifiers: [],
    },
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
    evidenceLinks: [],
    typedGaps: [],
    warnings: snapshot.observationReasonCode
      ? [snapshot.observationReasonCode]
      : [],
    currentness: "UNKNOWN",
  };
  if (!snapshot.result) {
    if (snapshot.terminal)
      view.summary.primaryText = `世界分析来源状态：${snapshot.sourceStatus}；未发布事实结果。`;
    return view;
  }
  // Validate complete wire result and all references/hashes BEFORE display limits.
  const result = new FrozenWorldAnalysisContract().parse(
    "result",
    snapshot.result,
    snapshot.identity.maxResultBytes,
  );
  if (
    result.groundingId !== snapshot.identity.sourceId ||
    result.resultHash !== snapshot.resultHash ||
    result.status !== snapshot.sourceStatus ||
    (snapshot.identity.requestId &&
      result.requestId !== snapshot.identity.requestId)
  )
    throw Error("ANALYSIS_SOURCE_RESPONSE_CONTRACT_VIOLATION");
  const world = result.worldAnalysisFindings;
  view.source.findingSetHash = world.findingSetHash;
  const facts: string[] = [];
  const qualifiers: string[] = [
    "仅解释已发布的历史与世界分析结果；COMPLETED 不表示设备任务完成。",
  ];
  view.findings = world.findings.map(json);
  view.sourceProducts = result.referenceProducts.map(json);
  view.typedGaps = world.gaps.map(json);
  view.warnings.push(...result.warnings);
  view.evidenceItemIds = result.evidenceItems.map((e) => e.evidenceProductId);
  const layer = (
    f: { findingId: string; semanticConcept: string },
    suffix: string,
    position: Point | JsonObject,
    title?: string,
  ) => {
    if (view.map.layers.length >= limits.maxMapLayers) {
      limited("MAP_LAYER_LIMIT");
      return;
    }
    view.map.layers.push(
      mapLayerDescriptorSchema.parse({
        schemaVersion: "sacs-map-layer/1.0",
        layerId:
          "layer-" +
          publicCanonicalHash({
            groundingId: result.groundingId,
            findingId: f.findingId,
            suffix,
          }).slice(7, 39),
        title: title ?? f.semanticConcept,
        role: "FINAL_FINDING",
        representation: "INLINE_GEOJSON",
        access: { kind: "INLINE_GEOJSON", data: json(position) },
        sourceAuthority: "WSGS",
        visibleByDefault: true,
        selectable: true,
        editable: false,
        analysisId: input.analysisId,
        revisionId: input.revisionId,
        findingIds: [f.findingId],
        loadStatus: "READY",
        relevanceStatus: "ACTIVE",
        currentness: "UNKNOWN",
        styleToken: "finding.primary",
      }),
    );
  };
  const limited = (code: string) => {
    if (!view.typedGaps.some((g) => g["messageCode"] === code))
      view.typedGaps.push({
        gapKind: "TRUNCATED",
        severity: "WARNING",
        messageCode: code,
      });
  };
  const timeline = (
    f: Finding,
    kind: WorldAnalysisTimelineItem["kind"],
    range: { start: string; end?: string; bounds?: Range["bounds"] },
    suffix: string,
    extra: Partial<FrozenTimelineItem> = {},
  ) => {
    if (view.timeline.items.length >= limits.maxTimelineItems) {
      limited("TIMELINE_ITEM_LIMIT");
      return;
    }
    const item: FrozenTimelineItem = {
      itemId:
        "time-" +
        publicCanonicalHash({ findingId: f.findingId, suffix }).slice(7, 39),
      kind,
      sourceId: "wsgs",
      ...range,
      evidenceItemIds: f.evidenceIds,
      findingId: f.findingId,
      resultHash: result.resultHash,
      ...extra,
    };
    view.timeline.items.push(item);
  };
  for (const f of world.findings) {
    view.warnings.push(...f.warnings, ...f.unknowns);
    for (const id of f.evidenceIds) {
      const evidence = result.evidenceItems.find(
        (e) => e.evidenceProductId === id,
      )!;
      view.evidenceLinks.push({
        findingId: f.findingId,
        evidenceProductId: id,
        upstreamEvidenceIds: [...evidence.evidenceIds],
        receiptIds: [...evidence.receiptIds],
      });
    }
    if (f.status === "NO_DATA" || f.status === "INDETERMINATE")
      qualifiers.push(
        `${f.findingId}：${f.status}，无法据此认定为零或未发生。`,
      );
    if (f.status === "PARTIAL")
      qualifiers.push(
        `${f.findingId}：仅部分数据可用，不影响其他独立有效结论。`,
      );
    if (f.display.truncated)
      qualifiers.push(
        `${f.findingId}：上游显示已裁剪；独立 FIRST/LAST 证明按原值保留。`,
      );
    switch (f.findingKind) {
      case "HISTORICAL_TRACE": {
        facts.push(
          `${f.findingId}：执行 ${f.executionNo ?? "未知"}；阶段范围 ${f.phaseScope}；生命周期 ${f.lifecycleState ?? "未知"}。`,
        );
        for (const [role, kind, ranges] of [
          ["selected", "TASK_INTERVAL", f.selectedPeriods],
          ["requested", "TASK_INTERVAL", f.requestedPeriods],
          ["active", "ACTIVE_PHASE", f.activePeriods],
          ["paused", "PAUSED_EXCLUDED", f.pausedPeriods],
          ["defined", "TRAJECTORY_DEFINED", f.definedPeriods],
        ] as const)
          ranges.forEach((range, i) =>
            timeline(f, kind, range, `${role}-${i}`, { periodRole: role }),
          );
        f.excludedPeriods.forEach((p, i) =>
          timeline(f, "PAUSED_EXCLUDED", p.period, `excluded-${i}`, {
            periodRole: "excluded",
          }),
        );
        f.trajectoryGaps.forEach((p, i) =>
          timeline(f, "DATA_GAP", p.period, `gap-${i}`),
        );
        qualifiers.push(
          `${f.findingId}：封存状态 ${f.coverage.finalizationState ?? "未知"} 不代表全部历史数据完整；不跨 Gap 插值连线。`,
        );
        break;
      }
      case "ROAD_ASSOCIATION": {
        qualifiers.push(
          `${f.findingId}：道路网络仅是参考模型，不是物理真相；离网不等于错误运动。前缀完整=${f.associationPrefixComplete}，后缀完整=${f.associationSuffixComplete}。`,
        );
        for (const visit of f.roadVisits) {
          facts.push(
            `${f.findingId}：道路 ${visit.displayName ?? visit.sourceFeatureId}，${visit.period.start} 至 ${visit.period.end} ${visit.period.bounds}。`,
          );
          timeline(f, "ROAD_VISIT", visit.period, visit.visitId);
          if (visit.entryPosition)
            layer(f, visit.visitId + "-entry", visit.entryPosition);
          if (visit.exitPosition)
            layer(f, visit.visitId + "-exit", visit.exitPosition);
        }
        for (const segment of f.offNetworkSegments) {
          timeline(f, "OFF_NETWORK", segment.period, segment.segmentId);
          facts.push(
            `${f.findingId}：离网解释 ${segment.interpretationHint}。`,
          );
          segment.pathPreview?.forEach((p, i) =>
            layer(
              f,
              `${segment.segmentId}-preview-${i}`,
              p,
              "稀疏历史预览（非导航路线）",
            ),
          );
        }
        f.ambiguousSegments.forEach((s) =>
          timeline(f, "AMBIGUITY", s.period, s.segmentId),
        );
        f.networkDataIssues.forEach((p, i) =>
          timeline(f, "QUALITY_BREAK", p.period, `quality-${i}`),
        );
        f.blockingPeriods.forEach((p, i) =>
          timeline(f, "DATA_GAP", p.period, `blocking-${i}`),
        );
        if (f.lastConfirmedRoad)
          facts.push(
            `${f.findingId}：最后可确认道路访问 ${f.lastConfirmedRoad.visitId}；范围 ${f.lastConfirmedRoad.confirmationScope}，不是绝对最终道路。`,
          );
        break;
      }
      case "TEMPORAL_EVENT": {
        for (const event of f.events) {
          const range =
            event.extent.kind === "INSTANT"
              ? event.extent.timeWindow
              : event.extent.period;
          timeline(
            f,
            event.extent.kind === "INSTANT"
              ? "INSTANT_EVENT"
              : "INTERVAL_EVENT",
            range,
            event.eventId,
            { extent: json(event.extent), sourceEventId: event.eventId },
          );
          facts.push(
            `${f.findingId} / ${event.eventId}：${event.eventType}，${range.start} 至 ${range.end} ${range.bounds}；${event.certainty}。`,
          );
          if (event.position) layer(f, event.eventId, event.position);
        }
        if (f.selection)
          facts.push(
            `${f.findingId}：${f.selection.kind} confirmed=${f.selection.confirmed}；${f.selection.confirmationScope}；${f.selection.reasonCode}。`,
          );
        f.blockingPeriods.forEach((p, i) =>
          timeline(f, "DATA_GAP", p.period, `blocking-${i}`),
        );
        f.selection?.blockingPeriods.forEach((p, i) =>
          timeline(f, "DATA_GAP", p.period, `selection-blocking-${i}`),
        );
        break;
      }
      case "METRIC_RANKING": {
        const unit =
          f.selectedSeries?.valueUnit ?? f.metric.unit ?? "单位未声明";
        for (const candidate of f.candidates) {
          facts.push(
            `${f.findingId} / ${candidate.candidateId}：原排名 ${candidate.rank}；排名中位值 ${candidate.rankingBasis.rankingValue} ${unit}；代表样本 ${candidate.representativeValue} ${unit}；样本数 ${candidate.sampleCount}。`,
          );
          layer(
            f,
            candidate.candidateId,
            candidate.representativeVisitedPosition,
            `历史访问样本：排名 ${candidate.rank}`,
          );
          timeline(
            f,
            "METRIC_OBSERVATION",
            { start: candidate.representativeObservedAt },
            candidate.candidateId,
          );
        }
        qualifiers.push(
          `${f.findingId}：仅历史已观察位置；metricTemporalCompletenessKnown=false，不代表最佳可达位置或完整时段。`,
        );
        f.coverage.trajectoryGaps.forEach((p, i) =>
          timeline(f, "DATA_GAP", p.period, `gap-${i}`),
        );
        f.coverage.excludedPeriods.forEach((p, i) =>
          timeline(f, "PAUSED_EXCLUDED", p.period, `excluded-${i}`),
        );
        break;
      }
      case "ACTION_TARGET_CANDIDATE": {
        view.actionTargets.push(JSON.parse(JSON.stringify(f)) as Action);
        layer(f, "historical-target", f.target, "历史行动候选（未授权执行）");
        facts.push(
          `${f.findingId}：历史候选来自 ${f.sourceFindingId} / ${f.sourceCandidateId}，原排名 ${f.sourceRank}。`,
        );
        qualifiers.push(
          "executionAuthorized=false；仍需当前环境验证、路线规划和执行确认。本次不会发起设备或 SDAR 执行。",
        );
        break;
      }
    }
  }
  for (const choice of world.choices)
    for (const candidate of choice.candidates) {
      if (view.choices.length >= limits.maxResultCandidates) {
        limited("CHOICE_LIMIT");
        continue;
      }
      view.choices.push({
        choiceId: choice.choiceId,
        choiceKind: choice.choiceKind,
        candidateId: candidate.candidateId,
        displayName: candidate.displayName,
        validUntil: choice.validUntil,
        enabled: (input.now?.() ?? Date.now()) < Date.parse(choice.validUntil),
        ...(choice.sourceFindingId
          ? { sourceFindingId: choice.sourceFindingId }
          : {}),
        ...("referenceProductId" in candidate
          ? { productId: candidate.referenceProductId }
          : {}),
        selector: {
          priorGroundingId: result.groundingId,
          priorResultHash: result.resultHash,
          findingSetHash: world.findingSetHash,
          choiceId: choice.choiceId,
          candidateId: candidate.candidateId,
        },
      });
    }
  if (result.geospatialFindings) {
    view.findings.push(...result.geospatialFindings.findings.map(json));
    view.sourceProducts.push(
      ...result.geospatialFindings.sourceProducts.map(json),
    );
    view.typedGaps.push(...result.geospatialFindings.gaps.map(json));
    for (const f of result.geospatialFindings.findings) {
      if (f.findingKind === "POINT_MEASUREMENT") {
        facts.push(`${f.semanticConcept}: ${f.value} ${f.unit}`);
        layer(f, "published-point", json(f.point));
      }
      if (f.findingKind === "POINT_CLASSIFICATION") {
        facts.push(`${f.semanticConcept}: ${f.classLabel ?? f.classCode}`);
        layer(f, "published-point", json(f.point));
      }
      if (f.findingKind === "SPATIAL_FEATURE_COLLECTION")
        for (const [i, feature] of f.features.entries())
          if (feature.geometry)
            layer(
              f,
              `feature-${i}`,
              json(feature.geometry),
              "已发布空间预览（非导航路线）",
            );
    }
  }
  if (view.typedGaps.length)
    qualifiers.push(
      "存在明确的数据或能力缺口；未推断缺失事实或几何。" +
        view.typedGaps
          .map((g) => String(g["messageCode"] ?? g["gapKind"]))
          .join("、"),
    );
  view.warnings = unique(view.warnings);
  if (view.choices.some((choice) => !choice.enabled))
    qualifiers.push(
      "候选已过期的结果仍可阅读；请重新查询，不会延长来源有效期。",
    );
  if (view.typedGaps.some((gap) => gap["messageCode"] === "CHOICE_LIMIT"))
    qualifiers.push(
      "候选列表受本地展示预算限制；选择按保存来源的候选身份解析，不能使用可见列表序号替代。",
    );
  view.summary = {
    title:
      view.status === "WAITING_SELECTION" ? "请选择分析候选" : "世界分析结果",
    primaryText: "",
    qualifiers: unique(qualifiers),
  };
  view.summary.primaryText = [
    view.summary.title,
    ...facts,
    ...view.summary.qualifiers,
  ]
    .join("\n")
    .slice(0, 16000);
  // View budget is independent of wire validation. Full authoritative result remains in storage.
  const budget = Math.max(16384, limits.maxSafePayloadBytes);
  while (Buffer.byteLength(JSON.stringify(view), "utf8") > budget) {
    limited("VIEW_BYTE_LIMIT");
    if (view.findings.length) {
      view.findings.pop();
      pruneDisplayDependencies(view);
      continue;
    }
    if (view.sourceProducts.length) {
      view.sourceProducts.pop();
      continue;
    }
    if (view.timeline.items.length) {
      view.timeline.items.pop();
      continue;
    }
    if (view.map.layers.length) {
      view.map.layers.pop();
      continue;
    }
    if (view.choices.length) {
      view.choices.pop();
      continue;
    }
    if (view.actionTargets.length) {
      view.actionTargets.pop();
      continue;
    }
    if (view.evidenceLinks.length) {
      view.evidenceLinks.pop();
      continue;
    }
    if (view.evidenceItemIds.length) {
      view.evidenceItemIds.pop();
      continue;
    }
    if (view.typedGaps.length > 1) {
      view.typedGaps.shift();
      continue;
    }
    if (view.warnings.length) {
      view.warnings.pop();
      continue;
    }
    if (view.summary.primaryText.length > 1024) {
      view.summary.primaryText = view.summary.primaryText.slice(0, 1024);
      continue;
    }
    if (view.summary.qualifiers.length) {
      view.summary.qualifiers.pop();
      continue;
    }
    break;
  }
  return view;
}

/** Full saved results remain selection authority; displayed derived objects need their closure. */
function pruneDisplayDependencies(view: FrozenAnalysisView): void {
  const remaining = new Set(
    view.findings.map((finding) => finding["findingId"]),
  );
  view.findings = view.findings.filter(
    (finding) =>
      finding["findingKind"] !== "ACTION_TARGET_CANDIDATE" ||
      remaining.has(finding["sourceFindingId"]),
  );
  const visible = new Set(view.findings.map((finding) => finding["findingId"]));
  view.map.layers = view.map.layers.filter((layer) =>
    layer.findingIds.every((id) => visible.has(id)),
  );
  view.timeline.items = view.timeline.items.filter(
    (item) => item.findingId !== undefined && visible.has(item.findingId),
  );
  view.actionTargets = view.actionTargets.filter(
    (action) =>
      visible.has(action.findingId) && visible.has(action.sourceFindingId),
  );
  view.evidenceLinks = view.evidenceLinks.filter((link) =>
    visible.has(link.findingId),
  );
}
