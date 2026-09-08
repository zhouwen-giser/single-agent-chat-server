import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import {
  assertBoundedAnalysisJson,
  historicalFindingSchema,
  normalizeWorldAnalysis,
  hashWorldAnalysisView,
  projectAnalysisAnswer,
  projectHistoricalFinding,
  WsgsResultSchemaRegistry,
} from "../packages/world-explanation-runtime/src/analysis-view.js";
import { WsgsAuthoritativeContract } from "../packages/wsgs-geospatial-consumer/src/authoritative.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";
const read = (path: string) =>
  JSON.parse(readFileSync("dependencies/wsgs-v06/" + path, "utf8"));
const authority = new WsgsAuthoritativeContract();
const normalize = (
  result = read("examples/grounding-result-with-geospatial-findings.json"),
) =>
  normalizeWorldAnalysis({
    analysisId: "analysis-1",
    revisionId: "revision-1",
    runId: "run-1",
    authority,
    snapshot: {
      identity: {
        kind: "WSGS_GROUNDING_JOB",
        sourceId: result.groundingId,
        sourceHash: "sha256:" + "a".repeat(64),
      },
      sourceStatus: result.status,
      terminal: true,
      observedAt: "2026-09-06T00:00:00Z",
      resultHash: result.resultHash,
      result,
    },
  });
const base = {
  findingId: "history-1",
  status: "COMPLETED",
  evidenceItemIds: ["evidence-1"],
  warnings: [],
};
const period = { start: "2026-09-06T00:00:00Z", end: "2026-09-06T01:00:00Z" };
const point = { type: "Point", coordinates: [116, 39] };
describe("v06 single authoritative world analysis view", () => {
  it("parses every authoritative finding example without private provider imports", () => {
    const registry = new WsgsResultSchemaRegistry(authority);
    const schema = read("world-finding.schema.json");
    const hash = read("contract-release-lock.json").artifacts[
      "world-finding.schema.json"
    ];
    const files = readdirSync("dependencies/wsgs-v06/examples").filter((f) =>
      f.startsWith("world-finding-"),
    );
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files)
      expect(
        registry.parse(schema.$id, hash, read("examples/" + file)),
      ).toBeDefined();
  });
  it("preserves source products, raw evidence links, finding provenance and typed gaps", () => {
    const result = read(
      "examples/grounding-result-with-geospatial-findings.json",
    );
    result.geospatialFindings.gaps = [read("examples/typed-gap.json")];
    const view = normalize(result);
    expect(view.sourceProducts).toEqual(
      result.geospatialFindings.sourceProducts,
    );
    expect(view.typedGaps).toContainEqual(result.geospatialFindings.gaps[0]);
    expect(view.findings[0]).toEqual(result.geospatialFindings.findings[0]);
    expect(view.currentness).toBe("UNKNOWN");
  });
  it("rejects unknown URI and known URI hash drift without normalizing by shape", () => {
    const registry = new WsgsResultSchemaRegistry(authority);
    const finding = read("examples/world-finding-point-measurement.json");
    expect(
      registry.parse("urn:unknown", "sha256:" + "a".repeat(64), finding),
    ).toBeUndefined();
    expect(
      registry.parse(
        read("world-finding.schema.json").$id,
        "sha256:" + "a".repeat(64),
        finding,
      ),
    ).toBeUndefined();
    const result = read(
      "examples/grounding-result-with-geospatial-findings.json",
    );
    result.evidenceItems[0].safePayload = {
      geometry: point,
      claim: "must not become a fact",
    };
    const view = normalize(result);
    expect(
      view.typedGaps.some((g) => g["gapKind"] === "UNSUPPORTED_FINDING_SCHEMA"),
    ).toBe(true);
    expect(JSON.stringify(view)).not.toContain("must not become a fact");
    expect(view.evidenceItemIds).toContain(
      result.evidenceItems[0].evidenceProductId,
    );
  });
  it("rejects oversized, dangerous and deeply nested payloads before recursive parsing", () => {
    expect(() =>
      assertBoundedAnalysisJson({ value: "x".repeat(300_000) }, 262144),
    ).toThrow("LIMIT");
    let value: unknown = {};
    for (let i = 0; i < 40; i++) value = { child: value };
    expect(() => assertBoundedAnalysisJson(value)).toThrow("LIMIT");
    expect(() =>
      assertBoundedAnalysisJson(JSON.parse('{"__proto__":{}}')),
    ).toThrow("INVALID");
  });
  it("produces deterministic canonical view hashes", () => {
    expect(hashWorldAnalysisView(normalize())).toBe(
      hashWorldAnalysisView(normalize()),
    );
  });
  it("marks partial/no-data and never treats absence as zero", () => {
    const view = normalize();
    const answer = projectAnalysisAnswer({
      ...view,
      status: "PARTIAL",
      findings: [
        { findingKind: "POINT_MEASUREMENT", status: "NO_DATA", value: 0 },
      ],
    });
    expect(answer.facts).toEqual([]);
    expect(answer.qualifiers.join(" ")).toContain("部分数据");
    expect(answer.qualifiers.join(" ")).toContain("不应解释为零");
  });
  it("does not invent road geometry; off-network, quality, ambiguity and gaps stay distinct", () => {
    const view = projectHistoricalFinding(normalize(), {
      ...base,
      findingKind: "HISTORICAL_ROAD_ASSOCIATION",
      networkRole: "REFERENCE_MODEL_NOT_PHYSICAL_TRUTH",
      roadVisits: [{ roadId: "road-1", displayName: "Road 1", period }],
      offNetworkSegments: [period],
      ambiguousPeriods: [period],
      qualityBreakPeriods: [period],
      upstreamGapPeriods: [period],
      associationSuffixComplete: false,
    });
    expect(view.map.layers).toHaveLength(normalize().map.layers.length);
    expect(view.timeline.items.map((i) => i.kind).sort()).toEqual([
      "AMBIGUITY",
      "DATA_GAP",
      "OFF_NETWORK",
      "QUALITY_BREAK",
      "ROAD_VISIT",
    ]);
    expect(view.summary.primaryText).toContain("未关联到当前参考路网");
  });
  it("qualifies unconfirmed LAST and projects only published event points/times", () => {
    const view = projectHistoricalFinding(normalize(), {
      ...base,
      findingKind: "HISTORICAL_TEMPORAL_EVENT",
      eventType: "CROSS",
      events: [{ eventId: "event-1", instant: period.start, point }],
      selection: {
        kind: "LAST",
        selectedEventId: "event-1",
        confirmed: false,
        reasonCode: "SUFFIX_INCOMPLETE",
      },
      blockingPeriods: [period],
    });
    expect(view.summary.primaryText).toContain("最后已确认项");
    expect(view.timeline.items.map((i) => i.kind)).toContain("INSTANT_EVENT");
    expect(view.map.layers.at(-1)?.access).toEqual({
      kind: "INLINE_GEOJSON",
      data: point,
    });
  });
  it("uses visited position, not an H3 center, and keeps temporal completeness unknown", () => {
    const view = projectHistoricalFinding(normalize(), {
      ...base,
      findingKind: "HISTORICAL_METRIC_RANKING",
      metricConceptId: "terrain.slope",
      candidateDomain: "PAST_OBSERVED_LOCATIONS",
      candidates: [
        {
          candidateId: "candidate-1",
          rank: 1,
          value: 10,
          representativeVisitedPosition: point,
          h3CellId: "8928308280fffff",
        },
      ],
      metricTemporalCompletenessKnown: false,
    });
    expect(view.map.layers.at(-1)?.access).toEqual({
      kind: "INLINE_GEOJSON",
      data: point,
    });
    expect(view.summary.primaryText).toContain("可用历史样本");
  });
  it("keeps historical action targets non-executing and rejects relaxed flags", () => {
    const target = {
      ...base,
      findingKind: "HISTORICAL_ACTION_TARGET_CANDIDATE",
      position: point,
      sourceRank: 1,
      currentValidationRequired: true,
      routePlanningRequired: true,
      executionAuthorized: false,
    };
    const view = projectHistoricalFinding(normalize(), target);
    expect(view.actionTargets[0]).toEqual(target);
    expect(() =>
      historicalFindingSchema.parse({ ...target, executionAuthorized: true }),
    ).toThrow();
    expect(() =>
      historicalFindingSchema.parse({
        ...target,
        currentValidationRequired: false,
      }),
    ).toThrow();
  });
  it("never connects bounded profile samples into a trajectory", () => {
    const result = read(
      "examples/grounding-result-with-geospatial-findings.json",
    );
    result.geospatialFindings.findings = [
      read("examples/world-finding-profile.json"),
    ];
    result.geospatialFindings.findingSetHash = hashCanonicalJson(
      result.geospatialFindings.findings,
    );
    expect(normalize(result).map.layers).toEqual([]);
  });
});
