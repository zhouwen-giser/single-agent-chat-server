import { describe, expect, it } from "@jest/globals";
import { normalizeWorldAnalysis } from "../packages/world-explanation-runtime/src/analysis-view.js";
import { focusTargetSchema } from "../packages/analysis-contract/src/index.js";
import { assertDurableFocusIdentity } from "../packages/analysis-map/src/index.js";
import {
  publicCanonicalHash,
  publicFindingSetHash,
  publicResultHash,
  type GroundingResult12,
} from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import { publicExample } from "./helpers/frozen-wsgs-http.js";

const sample = (name: string) => publicExample<GroundingResult12>(name);
const seal = (r: GroundingResult12) => {
  r.worldAnalysisFindings.findingSetHash = publicFindingSetHash(
    r.worldAnalysisFindings,
  );
  r.resultHash = publicResultHash(r);
  return r;
};
const viewOf = (r: GroundingResult12, limited = false) =>
  normalizeWorldAnalysis({
    analysisId: "a-1",
    revisionId: "r-1",
    runId: "run-1",
    now: () => Date.parse("2026-09-06T10:00:30+08:00"),
    ...(limited
      ? { limits: { maxSafePayloadBytes: 16384, maxMapLayers: 1 } }
      : {}),
    snapshot: {
      identity: {
        kind: "WSGS_GROUNDING_JOB",
        sourceId: r.groundingId,
        sourceHash: publicCanonicalHash({ requestId: r.requestId }),
        contractIdentity: {
          contractVersion: "sacs-wsgs-grounding/1.2",
          resultProfile: "wsgs-world-analysis-findings/1.0",
        },
      },
      sourceStatus: r.status,
      resultHash: r.resultHash,
      result: r,
      terminal: true,
      observedAt: "2026-09-06T10:00:30+08:00",
    },
  });
describe("Grounding cross-view public identity linkage", () => {
  it("links ranking cards, map features, observations, evidence and products through exact IDs", () => {
    const source = sample("ranking");
    const view = viewOf(source);
    const links = view.linkage;
    expect(links).toBeDefined();
    expect(links?.features).toHaveLength(2);
    const finding = links?.findings[0];
    expect(finding?.sourceProductIds).toEqual(
      expect.arrayContaining(["ugv1", "trajectory-1"]),
    );
    expect(finding?.evidenceItemIds).toEqual(
      source.worldAnalysisFindings.findings[0]?.evidenceIds,
    );
    for (const choice of links?.choices ?? []) {
      expect(choice.focusTargets).toHaveLength(1);
      const feature = links?.features.find(
        (f) =>
          f.relationKey === choice.candidateId &&
          f.findingId === choice.findingId,
      );
      expect(choice.focusTargets[0]?.featureId).toBe(feature?.featureId);
      expect(
        links?.timeline.filter((t) =>
          t.featureIds.includes(feature?.featureId ?? ""),
        ),
      ).toHaveLength(1);
    }
    for (const feature of links?.features ?? []) {
      expect(() => focusTargetSchema.parse(feature.focus)).not.toThrow();
      expect(() => assertDurableFocusIdentity(feature.focus)).not.toThrow();
      expect(view.map.layers.some((l) => l.layerId === feature.layerId)).toBe(
        true,
      );
    }
  });
  it("does not use equal display labels or positions as candidate identity", () => {
    const source = sample("ranking");
    const first = viewOf(source);
    for (const choice of source.worldAnalysisFindings.choices)
      for (const candidate of choice.candidates)
        candidate.displayName = "identical label";
    const finding = source.worldAnalysisFindings.findings[0];
    if (finding?.findingKind !== "METRIC_RANKING") throw Error("FIXTURE_KIND");
    const position = finding.candidates[0]?.representativeVisitedPosition;
    if (!position) throw Error("FIXTURE_POSITION");
    for (const candidate of finding.candidates)
      candidate.representativeVisitedPosition = JSON.parse(
        JSON.stringify(position),
      );
    const second = viewOf(seal(source));
    expect(second.linkage).toEqual(first.linkage);
    expect(
      new Set(
        second.linkage?.choices.flatMap((c) =>
          c.focusTargets.map((f) => f.featureId),
        ),
      ).size,
    ).toBe(2);
  });
  it("links temporal geometry only by its published event identity", () => {
    const view = viewOf(sample("event"));
    for (const item of view.timeline.items) {
      const linked = view.linkage?.timeline.find(
        (t) => t.itemId === item.itemId,
      );
      if (item.sourceEventId) {
        expect(linked?.featureIds).toEqual(
          view.linkage?.features
            .filter(
              (f) =>
                f.relationKey === item.sourceEventId &&
                f.findingId === item.findingId,
            )
            .map((f) => f.featureId),
        );
      }
    }
  });
  it("does not confuse identical IDs across road visits and off-network segments", () => {
    const source = sample("road");
    const f = source.worldAnalysisFindings.findings[0];
    if (f?.findingKind !== "ROAD_ASSOCIATION" || !f.roadVisits[0])
      throw Error("FIXTURE_KIND");
    const visit = f.roadVisits[0];
    visit.entryPosition = { type: "Point", coordinates: [116.1, 39.1] };
    f.offNetworkSegments = [
      {
        segmentId: visit.visitId,
        period: visit.period,
        sampleCount: 2,
        pathPreview: [
          { type: "Point", coordinates: [116.2, 39.2] },
          { type: "Point", coordinates: [116.3, 39.3] },
        ],
        interpretationHint: "OPEN_AREA_MOVEMENT",
        reasonCodes: [],
      },
    ];
    const view = viewOf(seal(source));
    const road = view.timeline.items.find((t) => t.kind === "ROAD_VISIT");
    const off = view.timeline.items.find((t) => t.kind === "OFF_NETWORK");
    expect(road?.itemId).not.toBe(off?.itemId);
    for (const [item, kind] of [
      [road, "ROAD_VISIT"],
      [off, "OFF_NETWORK"],
    ] as const) {
      const links = view.linkage?.timeline.find(
        (t) => t.itemId === item?.itemId,
      );
      expect(links?.featureIds.length).toBeGreaterThan(0);
      for (const id of links?.featureIds ?? [])
        expect(
          view.linkage?.features.find((feature) => feature.featureId === id)
            ?.relationKind,
        ).toBe(kind);
    }
  });
  it("keeps identity stable under period reordering and emits no trace geometry across gaps", () => {
    const source = sample("trace");
    const f = source.worldAnalysisFindings.findings[0];
    if (f?.findingKind !== "HISTORICAL_TRACE") throw Error("FIXTURE_KIND");
    f.selectedPeriods = [
      {
        start: "2026-09-06T09:00:00+08:00",
        end: "2026-09-06T09:01:00+08:00",
        bounds: "[)",
      },
      {
        start: "2026-09-06T09:02:00+08:00",
        end: "2026-09-06T09:03:00+08:00",
        bounds: "[)",
      },
    ];
    const first = viewOf(seal(source));
    f.selectedPeriods.reverse();
    const next = viewOf(seal(source));
    expect(next.timeline.items.map((t) => t.itemId).sort()).toEqual(
      first.timeline.items.map((t) => t.itemId).sort(),
    );
    expect(next.map.layers).toEqual([]);
    expect(next.linkage?.features).toEqual([]);
    expect(
      next.linkage?.timeline.every((t) => t.focusTargets.length === 0),
    ).toBe(true);
  });
  it("reference choices focus the exact public reference key without fabricating geometry", () => {
    const view = viewOf(sample("all-choices"));
    const referenceChoices =
      view.linkage?.choices.filter((c) => c.sourceProductId) ?? [];
    expect(referenceChoices.length).toBeGreaterThan(0);
    for (const choice of referenceChoices) {
      const product = view.sourceProducts.find(
        (p) => p["productId"] === choice.sourceProductId,
      );
      expect(choice.focusTargets).toContainEqual(
        expect.objectContaining({
          targetKind: "WORLD_REFERENCE",
          referenceKey: product?.["referenceKey"],
        }),
      );
    }
  });
  it("display clipping never leaves navigation to removed features, findings, timeline or products", () => {
    const source = sample("action");
    source.warnings = Array.from(
      { length: 80 },
      (_, i) => `${i}:` + "x".repeat(2000),
    );
    const view = viewOf(seal(source), true);
    expect(Buffer.byteLength(JSON.stringify(view))).toBeLessThanOrEqual(16384);
    for (const f of view.linkage?.findings ?? []) {
      expect(view.findings.some((v) => v["findingId"] === f.findingId)).toBe(
        true,
      );
      expect(
        f.layerIds.every((id) => view.map.layers.some((l) => l.layerId === id)),
      ).toBe(true);
      expect(
        f.timelineItemIds.every((id) =>
          view.timeline.items.some((t) => t.itemId === id),
        ),
      ).toBe(true);
      expect(
        f.sourceProductIds.every((id) =>
          view.sourceProducts.some(
            (p) => p["productId"] === id || p["sourceProductId"] === id,
          ),
        ),
      ).toBe(true);
    }
    for (const choice of view.linkage?.choices ?? [])
      expect(
        choice.focusTargets.every(
          (f) =>
            !f.layerId || view.map.layers.some((l) => l.layerId === f.layerId),
        ),
      ).toBe(true);
  });
});
