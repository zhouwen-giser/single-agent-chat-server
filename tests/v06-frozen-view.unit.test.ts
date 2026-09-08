import { readFileSync } from "node:fs";
import { describe, it, expect } from "@jest/globals";
import {
  normalizeWorldAnalysis,
  type AnalysisViewLimits,
} from "../packages/world-explanation-runtime/src/analysis-view.js";
import { timelineProjectionSchema } from "../packages/analysis-contract/src/index.js";
import {
  publicCanonicalHash,
  publicFindingSetHash,
  publicResultHash,
  type GroundingResult12,
} from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import { publicExample } from "./helpers/frozen-wsgs-http.js";
const now = () => Date.parse("2026-09-06T10:00:30.000+08:00");
const contractIdentity = {
  contractVersion: "sacs-wsgs-grounding/1.2",
  resultProfile: "wsgs-world-analysis-findings/1.0",
} as const;
const sample = (name: string) => publicExample<GroundingResult12>(name);
const reseal = (result: GroundingResult12) => {
  result.worldAnalysisFindings.findingSetHash = publicFindingSetHash(
    result.worldAnalysisFindings,
  );
  result.resultHash = publicResultHash(result);
  return result;
};
const normalize = (
  result: GroundingResult12,
  limits?: Partial<AnalysisViewLimits>,
  maxResultBytes?: number,
) =>
  normalizeWorldAnalysis({
    analysisId: "a1",
    revisionId: "r1",
    runId: "run1",
    now,
    ...(limits ? { limits } : {}),
    snapshot: {
      identity: {
        kind: "WSGS_GROUNDING_JOB",
        sourceId: result.groundingId,
        sourceHash: publicCanonicalHash({ requestId: result.requestId }),
        contractIdentity,
        requestId: result.requestId,
        ...(maxResultBytes ? { maxResultBytes } : {}),
      },
      sourceStatus: result.status,
      terminal: true,
      resultHash: result.resultHash,
      result,
      observedAt: "2026-09-06T10:00:30.000+08:00",
    },
  });
const manifest = JSON.parse(
  readFileSync(
    "dependencies/wsgs-world-analysis-v1/public/examples/manifest.json",
    "utf8",
  ),
) as { examples: { path: string; schema: string; valid: boolean }[] };
describe("frozen public five-finding projection through normal mapper C02", () => {
  it.each(
    manifest.examples
      .filter((e) => e.schema === "result" && e.valid)
      .map((e) => e.path.replace(/^examples\//u, "").replace(/\.json$/u, "")),
  )(
    "AC-011 AC-012 accepts official %s, preserves world and optional geo without shape inference",
    (name) => {
      const result = sample(name),
        before = JSON.stringify(result),
        view = normalize(result);
      expect(view.source).toMatchObject({
        ...contractIdentity,
        resultHash: result.resultHash,
      });
      expect(
        view.findings.slice(0, result.worldAnalysisFindings.findings.length),
      ).toEqual(result.worldAnalysisFindings.findings);
      expect(view.typedGaps).toEqual(
        expect.arrayContaining(result.worldAnalysisFindings.gaps),
      );
      if (result.geospatialFindings)
        expect(view.findings).toEqual(
          expect.arrayContaining(result.geospatialFindings.findings),
        );
      expect(JSON.stringify(result)).toBe(before);
      expect(() =>
        timelineProjectionSchema.parse({
          schemaVersion: "sacs-shared-timeline/1.0",
          ...view.timeline,
        }),
      ).not.toThrow();
    },
  );
  it("AC-011 refuses missing world component even when geo exists", () => {
    const result = sample("coexist");
    delete (result as unknown as Record<string, unknown>)[
      "worldAnalysisFindings"
    ];
    expect(() => normalize(result)).toThrow();
  });
  it("AC-012 evidence links distinguish local products from upstream evidence and receipts", () => {
    const result = sample("ranking");
    const item = result.evidenceItems[0]!;
    item.evidenceIds = ["upstream-evidence-distinct"];
    item.receiptIds = ["upstream-receipt-distinct"];
    reseal(result);
    const view = normalize(result);
    expect(view.evidenceLinks).toContainEqual({
      findingId: result.worldAnalysisFindings.findings[0]!.findingId,
      evidenceProductId: item.evidenceProductId,
      upstreamEvidenceIds: ["upstream-evidence-distinct"],
      receiptIds: ["upstream-receipt-distinct"],
    });
    expect(view.timeline.items[0]!.evidenceItemIds).not.toContain(
      "upstream-evidence-distinct",
    );
    result.worldAnalysisFindings.findings[0]!.evidenceIds = [
      "upstream-evidence-distinct",
    ];
    reseal(result);
    expect(() => normalize(result)).toThrow();
  });
  it.each(["[)", "[]", "(]", "()", "UNSPECIFIED"] as const)(
    "AC-013 retains offset, nanosecond precision and %s bounds without gap lines",
    (bounds) => {
      const result = sample("trace");
      const f = result.worldAnalysisFindings.findings[0]!;
      if (f.findingKind !== "HISTORICAL_TRACE") throw Error("WRONG_FIXTURE");
      f.selectedPeriods = [
        {
          start: "2026-09-05T10:00:00.000000001+08:00",
          end: "2026-09-05T10:00:00.000000002+08:00",
          bounds,
        },
      ];
      f.trajectoryGaps = [
        {
          period: f.selectedPeriods[0]!,
          kind: "SOURCE_GAP",
          reasonCodes: ["INCOMPLETE"],
        },
      ];
      const view = normalize(reseal(result));
      expect(view.findings[0]).toEqual(f);
      expect(
        view.timeline.items.find((t) => t.periodRole === "selected"),
      ).toMatchObject({ ...f.selectedPeriods[0]! });
      expect(view.timeline.items.some((t) => t.kind === "DATA_GAP")).toBe(true);
      expect(view.map.layers).toHaveLength(0);
      expect(view.summary.primaryText).toContain(
        "SEALED 不代表全部历史数据完整",
      );
      expect(() =>
        timelineProjectionSchema.parse({
          schemaVersion: "sacs-shared-timeline/1.0",
          ...view.timeline,
        }),
      ).not.toThrow();
    },
  );
  it("AC-014 missing road geometry is not filled; off-network and unknown suffix remain explicit", () => {
    const result = sample("road");
    const f = result.worldAnalysisFindings.findings[0]!;
    if (f.findingKind !== "ROAD_ASSOCIATION") throw Error("WRONG_FIXTURE");
    for (const visit of f.roadVisits) {
      delete visit.entryPosition;
      delete visit.exitPosition;
    }
    for (const segment of f.offNetworkSegments) {
      delete segment.entryPosition;
      delete segment.exitPosition;
      delete segment.pathPreview;
    }
    f.associationSuffixComplete = false;
    const view = normalize(reseal(result));
    expect(view.findings[0]).toEqual(f);
    expect(view.map.layers).toHaveLength(0);
    expect(view.summary.primaryText).toContain("离网不等于错误运动");
    expect(view.summary.primaryText).toContain("后缀完整=false");
    expect(view.summary.primaryText).toContain("不是绝对最终道路");
  });
  it("AC-014 preserves off-network preview, ambiguity and quality/gap periods as distinct layers and events", () => {
    const result = sample("road");
    const f = result.worldAnalysisFindings.findings[0]!;
    if (f.findingKind !== "ROAD_ASSOCIATION") throw Error("WRONG_FIXTURE");
    const period = f.roadVisits[0]!.period;
    const points = [
      {
        type: "Point" as const,
        coordinates: [116.1, 39.1] as [number, number],
      },
      {
        type: "Point" as const,
        coordinates: [116.2, 39.2] as [number, number],
      },
    ];
    f.offNetworkSegments = [
      {
        segmentId: "off-1",
        period,
        sampleCount: 2,
        pathPreview: points,
        interpretationHint: "OPEN_AREA_MOVEMENT",
        reasonCodes: [],
      },
    ];
    f.ambiguousSegments = [
      {
        segmentId: "ambiguous-1",
        period,
        candidateFeatureIds: ["road-A", "road-B"],
      },
    ];
    f.networkDataIssues = [
      {
        issueKind: "MISSING_PATH_CANDIDATE",
        period,
        relatedFeatureIds: ["road-A"],
        observationCount: 2,
        reasonCodes: [],
      },
    ];
    f.blockingPeriods = [
      { period, kind: "SOURCE_GAP", reasonCodes: ["INCOMPLETE"] },
    ];
    const view = normalize(reseal(result));
    expect(view.timeline.items.map((t) => t.kind)).toEqual(
      expect.arrayContaining([
        "ROAD_VISIT",
        "OFF_NETWORK",
        "AMBIGUITY",
        "QUALITY_BREAK",
        "DATA_GAP",
      ]),
    );
    expect(
      view.map.layers.map((l) =>
        l.access.kind === "INLINE_GEOJSON" ? l.access.data : null,
      ),
    ).toEqual(points);
    expect(view.map.layers.every((l) => l.title.includes("非导航路线"))).toBe(
      true,
    );
    expect(view.summary.primaryText).toContain("OPEN_AREA_MOVEMENT");
  });
  it.each(["FIRST", "LAST"] as const)(
    "AC-015 %s proof is never recomputed from visible event order",
    (kind) => {
      for (const name of ["event", "event-incomplete"]) {
        const result = sample(name),
          f = result.worldAnalysisFindings.findings[0]!;
        if (f.findingKind !== "TEMPORAL_EVENT" || !f.selection)
          throw Error("WRONG_FIXTURE");
        f.selection.kind = kind;
        f.selection.reasonCode = f.selection.confirmed
          ? kind === "FIRST"
            ? "FIRST_EVENT_CONFIRMED"
            : "LAST_EVENT_CONFIRMED"
          : kind === "FIRST"
            ? "FIRST_EVENT_NOT_CERTAIN"
            : "LAST_EVENT_NOT_CERTAIN";
        const view = normalize(reseal(result), { maxTimelineItems: 1 });
        expect(view.findings[0]?.["selection"]).toEqual(f.selection);
      }
    },
  );
  it.each(["ENTER", "EXIT", "DWELL", "STOP", "PASS_NEAR", "CROSS"] as const)(
    "AC-015 preserves %s window and independent confirmed proof",
    (eventType) => {
      const result = sample("event-display-truncated-proof-retained");
      const f = result.worldAnalysisFindings.findings[0]!;
      if (f.findingKind !== "TEMPORAL_EVENT") throw Error("WRONG_FIXTURE");
      f.eventTypes = [eventType];
      const event = f.events[0]!;
      event.eventType = eventType;
      if (eventType !== "CROSS") delete event.target;
      const view = normalize(reseal(result), { maxTimelineItems: 1 });
      expect(view.findings[0]?.["selection"]).toEqual(f.selection);
      expect(view.findings[0]?.["selection"]).toMatchObject({
        confirmed: true,
      });
      expect(view.timeline.items[0]!.extent).toEqual(event.extent);
      if (event.extent.kind === "INSTANT") {
        expect(view.timeline.items[0]).toMatchObject({
          ...event.extent.timeWindow,
        });
        expect(view.timeline.items[0]!.end).not.toBe(event.extent.estimatedAt);
      }
      expect(view.summary.primaryText).toContain(eventType);
      expect(view.summary.primaryText).toContain("confirmed=true");
    },
  );
  it("AC-015 keeps unconfirmed selection and blocking periods without local FIRST/LAST inference", () => {
    const result = sample("event-incomplete");
    const f = result.worldAnalysisFindings.findings[0]!;
    const view = normalize(result);
    if (f.findingKind !== "TEMPORAL_EVENT") throw Error("WRONG_FIXTURE");
    expect(view.findings[0]?.["selection"]).toEqual(f.selection);
    expect(view.summary.primaryText).toContain("confirmed=false");
    expect(view.timeline.items.some((t) => t.kind === "DATA_GAP")).toBe(true);
  });
  it("AC-016 official medians -40/-50 are distinct from representative -42/-45; original ranks/units/points remain", () => {
    const result = sample("ranking"),
      view = normalize(result);
    expect(view.summary.primaryText).toContain(
      "排名中位值 -40 dBm；代表样本 -42 dBm",
    );
    expect(view.summary.primaryText).toContain(
      "排名中位值 -50 dBm；代表样本 -45 dBm",
    );
    expect(view.summary.primaryText).toContain(
      "metricTemporalCompletenessKnown=false",
    );
    const f = result.worldAnalysisFindings.findings[0]!;
    if (f.findingKind !== "METRIC_RANKING") throw Error("WRONG_FIXTURE");
    expect(view.findings[0]).toEqual(f);
    expect(
      view.map.layers.map((l) =>
        l.access.kind === "INLINE_GEOJSON" ? l.access.data : null,
      ),
    ).toEqual(f.candidates.map((c) => c.representativeVisitedPosition));
    expect(view.actionTargets).toHaveLength(0);
  });
  it("AC-017 unknown does not become zero/false or erase independent results", () => {
    const result = sample("trace-no-data");
    const view = normalize(result);
    expect(view.summary.primaryText).toContain("无法据此认定为零或未发生");
    expect(view.findings).toEqual(result.worldAnalysisFindings.findings);
    const partial = normalize(sample("action-requirements"));
    expect(partial.summary.primaryText).toContain("排名中位值 -40");
    expect(partial.typedGaps.length).toBeGreaterThan(0);
  });
  it("AC-018 wire >256KiB remains legal, display budgets only apply after full validation and do not alter public hash", () => {
    const result = sample("ranking");
    result.warnings = Array.from(
      { length: 80 },
      (_, i) => `${i}:` + "x".repeat(3990),
    );
    reseal(result);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(262144);
    const hash = result.resultHash,
      setHash = result.worldAnalysisFindings.findingSetHash;
    const view = normalize(
      result,
      { maxSafePayloadBytes: 16384, maxResultCandidates: 1 },
      1048576,
    );
    expect(Buffer.byteLength(JSON.stringify(view))).toBeLessThanOrEqual(16384);
    expect(view.source.resultHash).toBe(hash);
    expect(result.worldAnalysisFindings.findingSetHash).toBe(setHash);
    expect(() => normalize(result, undefined, 262144)).toThrow();
    result.worldAnalysisFindings.findings[0]!.evidenceIds = [
      "not-a-local-product",
    ];
    reseal(result);
    expect(() =>
      normalize(result, { maxSafePayloadBytes: 16384, maxResultCandidates: 1 }),
    ).toThrow();
  });
  it("AC-020 AC-036 display clipping leaves selectors based on IDs, never rank or false product IDs", () => {
    const result = sample("all-choices"),
      view = normalize(result);
    expect(
      new Set(
        view.choices.map((c) => ("choiceKind" in c ? c.choiceKind : null)),
      ).size,
    ).toBe(5);
    const ranking = normalize(sample("ranking"), { maxResultCandidates: 1 });
    expect(ranking.choices).toHaveLength(1);
    expect(ranking.choices[0]).not.toHaveProperty("productId");
    expect(ranking.choices[0]).toMatchObject({
      enabled: true,
      selector: { priorGroundingId: result.groundingId },
    });
    expect(
      sample("ranking").worldAnalysisFindings.choices[0]!.candidates,
    ).toHaveLength(2);
  });
  it("AC-037 action remains exact source target with four restrictive flags, no Top-K auto-action", () => {
    const result = sample("action"),
      view = normalize(result);
    const action = result.worldAnalysisFindings.findings.find(
      (f) => f.findingKind === "ACTION_TARGET_CANDIDATE",
    )!;
    expect(view.actionTargets).toEqual([action]);
    expect(view.actionTargets[0]).toMatchObject({
      executionAuthorized: false,
      requirements: {
        currentValidationRequired: true,
        routePlanningRequired: true,
        executionConfirmationRequired: true,
      },
    });
    expect(view.summary.primaryText).toContain(
      "仍需当前环境验证、路线规划和执行确认",
    );
    expect(normalize(sample("ranking")).actionTargets).toHaveLength(0);
  });
  it.each([
    "currentValidationRequired",
    "routePlanningRequired",
    "executionConfirmationRequired",
    "executionAuthorized",
  ])("AC-037 rejects relaxing %s before any display", (flag) => {
    const result = sample("action"),
      action = result.worldAnalysisFindings.findings.find(
        (f) => f.findingKind === "ACTION_TARGET_CANDIDATE",
      )!;
    if (action.findingKind !== "ACTION_TARGET_CANDIDATE")
      throw Error("WRONG_FIXTURE");
    if (flag === "executionAuthorized")
      (action as unknown as Record<string, unknown>)[flag] = true;
    else
      (action.requirements as unknown as Record<string, unknown>)[flag] = false;
    expect(() => normalize(reseal(result))).toThrow();
  });
});
