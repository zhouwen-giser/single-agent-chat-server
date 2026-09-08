import { describe, expect, it, jest } from "@jest/globals";
import { EventEncoder } from "@ag-ui/encoder";
import type { GeoJsonLineString } from "../dependencies/wsgs-world-analysis-v1/public/generated/grounding-result-1.2.js";
import {
  AnalysisControlClient,
  HeadlessAnalysisReferenceClient,
  HeadlessMapEngineAdapter,
  createFrozenChoiceResolution,
  createFrozenSourceQuery,
  presentFrozenAnalysis,
  presentFrozenChoice,
} from "../packages/analysis-client/src/index.js";
import {
  projectAnalysisStateSnapshot,
  projectAnalysisText,
} from "../packages/ag-ui-analysis-adapter/src/index.js";
import { projectSharedTimeline } from "../packages/analysis-timeline/src/index.js";
import {
  normalizeWorldAnalysis,
  type AnalysisViewLimits,
} from "../packages/world-explanation-runtime/src/analysis-view.js";
import type { FrozenChoiceView } from "../packages/world-explanation-runtime/src/frozen-analysis-view.js";
import {
  publicCanonicalHash,
  publicFindingSetHash,
  publicResultHash,
  type GroundingResult12,
} from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import { planFrozenGroundingRequest } from "../packages/grounding-request-planner/src/frozen-request.js";
import { publicExample } from "./helpers/frozen-wsgs-http.js";
import { analysisStateBody } from "./v05-analysis-fixtures.js";

const now = () => Date.parse("2026-09-06T10:00:30.000+08:00");
const identity = {
  contractVersion: "sacs-wsgs-grounding/1.2",
  resultProfile: "wsgs-world-analysis-findings/1.0",
} as const;
const result = (name: string) => publicExample<GroundingResult12>(name);
function viewOf(
  source: GroundingResult12,
  limits?: Partial<AnalysisViewLimits>,
) {
  return normalizeWorldAnalysis({
    analysisId: "analysis-1",
    revisionId: "revision-1",
    runId: "run-1",
    now,
    ...(limits ? { limits } : {}),
    snapshot: {
      identity: {
        kind: "WSGS_GROUNDING_JOB",
        sourceId: source.groundingId,
        sourceHash: publicCanonicalHash({ requestId: source.requestId }),
        contractIdentity: identity,
        requestId: source.requestId,
      },
      sourceStatus: source.status,
      terminal: true,
      resultHash: source.resultHash,
      result: source,
      observedAt: "2026-09-06T10:00:30.000+08:00",
    },
  });
}
const contextOf = (view = viewOf(result("ranking"))) => ({
  view,
  activeRevisionId: view.revisionId,
  activeRevisionNumber: 1,
  interventionId: "saved-choice-intervention",
  now,
});
const command = {
  commandId: "selection-command-2",
  idempotencyKey: "selection-command-2",
  originalText: "使用此候选",
};

describe("frozen world consumer existing headless interaction C04", () => {
  it("AC-034 official SSE keeps text, map, timeline and Choice on the same validated source", async () => {
    const source = result("ranking");
    const view = viewOf(source);
    const body = analysisStateBody();
    const state = {
      ...body,
      worldExplanation: JSON.parse(JSON.stringify(view)),
      map: {
        ...body.map,
        layersById: Object.fromEntries(
          view.map.layers.map((layer) => [layer.layerId, layer]),
        ),
      },
      timeline: projectSharedTimeline({
        schemaVersion: "sacs-shared-timeline/1.0",
        ...view.timeline,
      }),
    };
    const engine = new HeadlessMapEngineAdapter();
    const client = new HeadlessAnalysisReferenceClient(engine);
    const encoder = new EventEncoder({ accept: "text/event-stream" });
    for (const event of [
      projectAnalysisStateSnapshot({ stateRevision: 1, state }),
      ...projectAnalysisText({
        messageId: "world-facts",
        text: view.summary.primaryText,
      }),
    ])
      await client.acceptSseChunk(encoder.encodeSSE(event));
    const shared = client.state.sharedState!;
    expect(shared.worldExplanation).toEqual(view);
    expect(client.state.textByMessageId["world-facts"]).toBe(
      view.summary.primaryText,
    );
    expect(shared.timeline.items).toEqual(view.timeline.items);
    expect(Object.values(shared.map.layersById)).toEqual(view.map.layers);
    expect(view.source.findingSetHash).toBe(
      source.worldAnalysisFindings.findingSetHash,
    );
    for (const item of shared.timeline.items!) {
      expect(item.resultHash).toBe(source.resultHash);
      expect(
        view.findings.some(
          (finding) => finding["findingId"] === item.findingId,
        ),
      ).toBe(true);
    }
    expect(client.state.textByMessageId["world-facts"]).toContain(
      "排名中位值 -40 dBm；代表样本 -42 dBm",
    );
    expect(client.state.textByMessageId["world-facts"]).toContain(
      "排名中位值 -50 dBm；代表样本 -45 dBm",
    );
    expect(engine.scenes).toHaveLength(1);
  });

  it.each([0, 1, 2, 3, 4])(
    "AC-020 AC-036 every Choice kind %i sends exact identities via the existing Control client",
    async (index) => {
      const context = contextOf(viewOf(result("all-choices")));
      const choice = context.view.choices.filter(
        (item): item is FrozenChoiceView => "selector" in item,
      )[index]!;
      const send = jest.fn(async () => ({
        status: 200,
        body: { accepted: true },
      }));
      const client = new AnalysisControlClient({ send });
      await client.resolveFrozenChoice({
        context,
        choices: [choice],
        ...command,
      });
      expect(send).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/analyses/analysis-1/interventions/saved-choice-intervention:resolve",
        headers: {},
        body: {
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          response: {
            expectedRevisionId: "revision-1",
            expectedRevisionNumber: 1,
            originalText: command.originalText,
            analysisSelections: [choice.selector],
          },
        },
      });
      expect(Object.keys(choice.selector).sort()).toEqual([
        "candidateId",
        "choiceId",
        "findingSetHash",
        "priorGroundingId",
        "priorResultHash",
      ]);
    },
  );

  it("AC-036 clipped display does not become the candidate authority or change source hashes", () => {
    const source = result("ranking");
    const full = viewOf(source);
    const retainedButton = full.choices[1] as FrozenChoiceView;
    const clipped = viewOf(source, { maxResultCandidates: 1 });
    expect(clipped.choices).toHaveLength(1);
    expect(
      clipped.choices.some(
        (choice) =>
          "candidateId" in choice &&
          choice.candidateId === retainedButton.candidateId,
      ),
    ).toBe(false);
    expect(presentFrozenAnalysis(contextOf(clipped)).displayLimited).toBe(true);
    const resolution = createFrozenChoiceResolution({
      context: contextOf(clipped),
      choices: [retainedButton],
      ...command,
    });
    const planned = planFrozenGroundingRequest({
      principalId: "principal-1",
      threadId: "thread-1",
      analysisId: "analysis-1",
      commandId: command.commandId,
      expectedRevisionId: "revision-1",
      text: command.originalText,
      createdAt: "2026-09-06T10:00:30.000+08:00",
      now,
      selections: resolution.response["analysisSelections"] as unknown[],
      context: {
        principalId: "principal-1",
        threadId: "thread-1",
        analysisId: "analysis-1",
        revisionId: "revision-1",
        contractIdentity: identity,
        result: source,
      },
    });
    expect(planned.kind).toBe("QUERY");
    if (planned.kind !== "QUERY") throw Error("EXPECTED_QUERY");
    expect(planned.request.analysisSelections).toEqual([
      retainedButton.selector,
    ]);
    expect(clipped.source.resultHash).toBe(full.source.resultHash);
    expect(clipped.source.findingSetHash).toBe(full.source.findingSetHash);
    expect(() =>
      planFrozenGroundingRequest({
        principalId: "principal-1",
        threadId: "thread-1",
        analysisId: "analysis-1",
        commandId: "missing-source",
        text: command.originalText,
        createdAt: "2026-09-06T10:00:30.000+08:00",
        now,
        selections: [retainedButton.selector],
      }),
    ).toThrow("SELECTION_UNAVAILABLE");
  });

  it("AC-025 AC-036 realtime expiry and missing intervention disable selection but preserve reading and requery", async () => {
    const context = contextOf();
    const choice = context.view.choices[0] as FrozenChoiceView;
    const expired = { ...context, now: () => Date.parse(choice.validUntil) };
    expect(choice.enabled).toBe(true);
    expect(presentFrozenChoice(expired, choice)).toMatchObject({
      enabled: false,
      disabledReason: "SELECTION_EXPIRED",
      refreshAction: "SUBMIT_NEW_QUERY",
    });
    expect(presentFrozenAnalysis(expired).text).toBe(
      context.view.summary.primaryText,
    );
    expect(() =>
      createFrozenChoiceResolution({
        context: expired,
        choices: [choice],
        ...command,
      }),
    ).toThrow("SELECTION_EXPIRED");
    expect(
      presentFrozenChoice({ ...context, interventionId: undefined }, choice),
    ).toMatchObject({
      enabled: false,
      disabledReason: "SELECTION_UNAVAILABLE",
    });
    const send = jest.fn(async () => ({ status: 200, body: {} }));
    await new AnalysisControlClient({ send }).queryFrozenAnalysis({
      context: expired,
      ...command,
      contextMode: "CONTINUE",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/v1/analyses/analysis-1/proposals",
        body: expect.objectContaining({
          kind: "GROUNDING_SOURCE_QUERY",
          originalText: command.originalText,
          contextMode: "CONTINUE",
        }),
      }),
    );
    expect(
      createFrozenSourceQuery({
        context: expired,
        ...command,
        contextMode: "REPLACE",
      }),
    ).not.toHaveProperty("analysisSelections");
    expect(choice.validUntil).toBe(
      (context.view.choices[0] as FrozenChoiceView).validUntil,
    );
  });

  it("AC-028 a new active revision makes old selectors and targets historical, never relabelled", () => {
    const context = {
      ...contextOf(viewOf(result("action"))),
      activeRevisionId: "revision-2",
    };
    expect(
      presentFrozenAnalysis(context).actions.every(
        (action) => action.current === false,
      ),
    ).toBe(true);
    const choiceContext = { ...contextOf(), activeRevisionId: "revision-2" };
    expect(
      presentFrozenAnalysis(choiceContext).choices.every(
        (choice) => choice.disabledReason === "ANALYSIS_REVISION_CONFLICT",
      ),
    ).toBe(true);
    expect(() =>
      createFrozenSourceQuery({ context, ...command, contextMode: "REPLACE" }),
    ).toThrow("ANALYSIS_REVISION_CONFLICT");
  });

  it("AC-035 map keeps actual points and previews only, never roads synthesized from IDs or H3", () => {
    const ranking = result("ranking");
    const rankingView = viewOf(ranking);
    const finding = ranking.worldAnalysisFindings.findings[0]!;
    if (finding.findingKind !== "METRIC_RANKING") throw Error("FIXTURE_KIND");
    expect(
      rankingView.map.layers.map((layer) =>
        layer.access.kind === "INLINE_GEOJSON" ? layer.access.data : undefined,
      ),
    ).toEqual(
      finding.candidates.map(
        (candidate) => candidate.representativeVisitedPosition,
      ),
    );
    const roads = viewOf(result("road"));
    for (const layer of roads.map.layers) {
      expect(layer.access.kind).toBe("INLINE_GEOJSON");
      if (layer.access.kind === "INLINE_GEOJSON")
        expect(layer.access.data["type"]).toBe("Point");
    }
    expect(roads.summary.primaryText).toContain("参考模型");
    const trace = viewOf(result("trace"));
    expect(trace.map.layers).toEqual([]);
    expect(trace.summary.primaryText).toContain("不跨 Gap 插值连线");
  });

  it("AC-035 published LineString previews retain exact independent segments and remain non-navigation beside a trace Gap", () => {
    const source = result("trace");
    const trace = source.worldAnalysisFindings.findings[0];
    const geo = result("coexist").geospatialFindings;
    if (trace?.findingKind !== "HISTORICAL_TRACE" || !geo)
      throw Error("FIXTURE_KIND");
    const period = trace.selectedPeriods[0];
    const evidence = source.evidenceItems[0];
    if (!period || !evidence) throw Error("FIXTURE_REFERENCE");
    trace.trajectoryGaps = [
      { period, kind: "SOURCE_GAP", reasonCodes: ["INCOMPLETE"] },
    ];
    const lines: GeoJsonLineString[] = [
      {
        type: "LineString",
        coordinates: [
          [116.1, 39.1],
          [116.11, 39.11],
        ],
      },
      {
        type: "LineString",
        coordinates: [
          [116.2, 39.2],
          [116.21, 39.21],
        ],
      },
    ];
    const evidenceItemIds = [evidence.evidenceProductId];
    geo.sourceProducts = [
      {
        sourceProductId: "line-preview-source",
        authority: "GDPS_CURRENT_PRODUCT",
        productId: "line-preview-product",
        productType: "SPATIAL_FEATURE_COLLECTION",
        productProfile: "line-preview/1.0",
        contentHash: publicCanonicalHash(lines),
        descriptorId: "line-preview-descriptor",
        descriptorHash: publicCanonicalHash({ id: "line-preview-descriptor" }),
        evidenceItemIds,
      },
    ];
    geo.findings = [
      {
        findingId: "line-preview",
        findingKind: "SPATIAL_FEATURE_COLLECTION",
        semanticConcept: "PUBLISHED_LINE_PREVIEW",
        querySemantics: "PUBLISHED_GEOMETRY_ONLY",
        status: "COMPLETED",
        evidenceItemIds,
        sourceProductIds: ["line-preview-source"],
        returnedCount: 2,
        truncated: false,
        features: lines.map((geometry, index) => ({
          featureId: `preview-${index}`,
          geometry,
        })),
      },
    ];
    geo.findingSetHash = publicCanonicalHash(geo.findings);
    geo.sourceProductSetHash = publicCanonicalHash(geo.sourceProducts);
    source.geospatialFindings = geo;
    source.worldAnalysisFindings.findingSetHash = publicFindingSetHash(
      source.worldAnalysisFindings,
    );
    source.resultHash = publicResultHash(source);
    const original = JSON.stringify(source);
    const view = viewOf(source);
    // The published spatial previews have no time-to-geometry association.
    // Keep their independent segments; the trace Gap cannot authorize a bridge.
    expect(view.map.layers).toHaveLength(2);
    expect(
      view.map.layers.map((layer) =>
        layer.access.kind === "INLINE_GEOJSON" ? layer.access.data : null,
      ),
    ).toEqual(lines);
    for (const layer of view.map.layers) {
      expect(layer.title).toBe("已发布空间预览（非导航路线）");
      expect(layer.findingIds).toEqual(["line-preview"]);
    }
    expect(view.timeline.items).toContainEqual(
      expect.objectContaining({
        kind: "DATA_GAP",
        findingId: trace.findingId,
        ...period,
      }),
    );
    expect(view.summary.primaryText).toContain("不跨 Gap 插值连线");
    expect(view.source.resultHash).toBe(source.resultHash);
    expect(JSON.stringify(source)).toBe(original);
  });

  it("AC-036 view byte clipping removes dependent action/geometry/timeline when finding closure is gone", () => {
    const source = result("action");
    // The public finding list is not dependency order. Removing the last item
    // must also remove an earlier action that depends on that ranking.
    source.worldAnalysisFindings.findings.reverse();
    source.warnings = Array.from(
      { length: 80 },
      (_, index) => `${index}:` + "x".repeat(3990),
    );
    source.worldAnalysisFindings.findingSetHash = publicFindingSetHash(
      source.worldAnalysisFindings,
    );
    source.resultHash = publicResultHash(source);
    const view = viewOf(source, { maxSafePayloadBytes: 16384 });
    expect(Buffer.byteLength(JSON.stringify(view), "utf8")).toBeLessThanOrEqual(
      16384,
    );
    expect(view.typedGaps).toContainEqual(
      expect.objectContaining({ messageCode: "VIEW_BYTE_LIMIT" }),
    );
    const ids = new Set(view.findings.map((finding) => finding["findingId"]));
    expect(
      view.map.layers.every((layer) =>
        layer.findingIds.every((id) => ids.has(id)),
      ),
    ).toBe(true);
    expect(
      view.timeline.items.every(
        (item) => item.findingId !== undefined && ids.has(item.findingId),
      ),
    ).toBe(true);
    expect(view.actionTargets).toEqual([]);
    expect(
      view.findings.some(
        (finding) => finding["findingKind"] === "ACTION_TARGET_CANDIDATE",
      ),
    ).toBe(false);
    expect(view.source.resultHash).toBe(source.resultHash);
  });

  it("AC-037 Top-K has no action; explicit public candidate retains exact point and four immutable requirements", () => {
    expect(presentFrozenAnalysis(contextOf()).actions).toEqual([]);
    const source = result("action");
    const view = viewOf(source);
    const action = view.actionTargets[0]!;
    if (action.findingKind !== "ACTION_TARGET_CANDIDATE")
      throw Error("FIXTURE_KIND");
    expect(presentFrozenAnalysis(contextOf(view)).actions[0]).toMatchObject({
      target: action.target,
      sourceFindingId: action.sourceFindingId,
      sourceCandidateId: action.sourceCandidateId,
      sourceRank: action.sourceRank,
      requirements: {
        currentValidationRequired: true,
        routePlanningRequired: true,
        executionConfirmationRequired: true,
      },
      executionAuthorized: false,
    });
    expect(
      presentFrozenAnalysis(contextOf(view)).actions[0],
    ).not.toHaveProperty("execute");
  });

  it.each([
    "currentValidationRequired",
    "routePlanningRequired",
    "executionConfirmationRequired",
    "executionAuthorized",
  ] as const)(
    "AC-037 rejects tampered %s in wire and local action card",
    (flag) => {
      const source = result("action");
      const view = viewOf(source);
      const local = view.actionTargets[0]!;
      if (local.findingKind !== "ACTION_TARGET_CANDIDATE")
        throw Error("FIXTURE_KIND");
      (
        (flag === "executionAuthorized"
          ? local
          : local.requirements) as unknown as Record<string, unknown>
      )[flag] = flag === "executionAuthorized";
      expect(() => presentFrozenAnalysis(contextOf(view))).toThrow(
        "HISTORICAL_ACTION_REQUIREMENTS_INVALID",
      );
      const wire = source.worldAnalysisFindings.findings.find(
        (finding) => finding.findingKind === "ACTION_TARGET_CANDIDATE",
      )!;
      if (wire.findingKind !== "ACTION_TARGET_CANDIDATE")
        throw Error("FIXTURE_KIND");
      (
        (flag === "executionAuthorized"
          ? wire
          : wire.requirements) as unknown as Record<string, unknown>
      )[flag] = flag === "executionAuthorized";
      source.worldAnalysisFindings.findingSetHash = publicFindingSetHash(
        source.worldAnalysisFindings,
      );
      source.resultHash = publicResultHash(source);
      expect(() => viewOf(source)).toThrow();
    },
  );
});
