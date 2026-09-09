import { describe, it, expect } from "@jest/globals";
import {
  planFrozenGroundingRequest,
  type FrozenSourceContext,
} from "../packages/grounding-request-planner/src/frozen-request.js";
import { createWsgsHttpClient } from "../packages/wsgs-http-adapter/src/index.js";
import {
  FrozenWorldAnalysisContract,
  type GroundingResult12,
  type AnalysisSelection,
  type GroundingRequest12,
} from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  publicExample,
  startFrozenWsgsPeer,
  frozenResult,
} from "./helpers/frozen-wsgs-http.js";
const now = () => Date.parse("2026-09-06T10:00:30.000+08:00");
const context = (name = "ranking"): FrozenSourceContext => ({
  principalId: "p1",
  threadId: "t1",
  analysisId: "a1",
  revisionId: "r1",
  contractIdentity: {
    contractVersion: "sacs-wsgs-grounding/1.2",
    resultProfile: "wsgs-world-analysis-findings/1.0",
  },
  result: publicExample<GroundingResult12>(name),
});
const input = (name = "ranking") => ({
  ...context(name),
  context: context(name),
  commandId: "command-2",
  expectedRevisionId: "r1",
  text: "使用第二个",
  createdAt: "2026-09-06T10:00:30.000+08:00",
  now,
});
const selector = (
  source: FrozenSourceContext,
  choice = 0,
  candidate = 1,
): AnalysisSelection => ({
  priorGroundingId: source.result.groundingId,
  priorResultHash: source.result.resultHash,
  findingSetHash: source.result.worldAnalysisFindings.findingSetHash,
  choiceId: source.result.worldAnalysisFindings.choices[choice]!.choiceId,
  candidateId:
    source.result.worldAnalysisFindings.choices[choice]!.candidates[candidate]!
      .candidateId,
});
describe("frozen full-source request planning (control integration remains C03)", () => {
  it("AC-019 emits the five exact selection fields and empty reference selection through actual HTTP", async () => {
    const plan = planFrozenGroundingRequest(input());
    if (plan.kind !== "QUERY") throw Error("EXPECTED_QUERY");
    expect(plan.request.executionPolicy.deadlineMs).toBe(120_000);
    expect(plan.request.analysisSelections).toEqual([selector(context())]);
    expect(plan.request.contextCapsule.priorGroundings).toEqual([
      {
        groundingId: context().result.groundingId,
        resultHash: context().result.resultHash,
        selectedProductIds: [],
      },
    ]);
    const peer = await startFrozenWsgsPeer((r) => ({
      value: frozenResult("empty", JSON.parse(r.body) as GroundingRequest12),
    }));
    try {
      const http = createWsgsHttpClient({
        baseUrl: peer.baseUrl,
        contractVersion: "sacs-wsgs-grounding/1.2",
      });
      await http.createGrounding(plan.request, plan.idempotencyKey);
      expect(JSON.parse(peer.captured[0]!.body)).toEqual(plan.request);
      expect(
        Object.keys(
          JSON.parse(peer.captured[0]!.body).analysisSelections[0],
        ).sort(),
      ).toEqual(
        [
          "candidateId",
          "choiceId",
          "findingSetHash",
          "priorGroundingId",
          "priorResultHash",
        ].sort(),
      );
    } finally {
      await peer.close();
    }
  });
  it.each([0, 1, 2, 3, 4])(
    "AC-020 supports public choice kind at index %i using IDs",
    (index) => {
      const source = context("all-choices"),
        selection = selector(source, index, 0);
      const plan = planFrozenGroundingRequest({
        ...input("all-choices"),
        text: "使用此候选",
        selections: [selection],
      });
      if (plan.kind !== "QUERY") throw Error("EXPECTED_QUERY");
      expect(plan.request.analysisSelections).toEqual([selection]);
      const choice = source.result.worldAnalysisFindings.choices[index]!;
      const candidate = choice.candidates[0]!;
      expect(
        plan.request.contextCapsule.priorGroundings[0]!.selectedProductIds,
      ).toEqual(
        "referenceProductId" in candidate ? [candidate.referenceProductId] : [],
      );
      expect(() =>
        new FrozenWorldAnalysisContract().parse("request", plan.request),
      ).not.toThrow();
    },
  );
  it.each(["principalId", "threadId", "analysisId"] as const)(
    "AC-021 rejects foreign %s without exposing source content",
    (field) => {
      expect(() =>
        planFrozenGroundingRequest({ ...input(), [field]: "foreign" }),
      ).toThrow("SELECTION_UNAVAILABLE");
    },
  );
  it.each(["priorGroundingId", "priorResultHash", "findingSetHash"] as const)(
    "AC-021 ordinal text does not repair a foreign %s anchor",
    (field) => {
      const value = selector(context());
      value[field] =
        field === "priorGroundingId" ? "foreign" : "sha256:" + "f".repeat(64);
      expect(() =>
        planFrozenGroundingRequest({ ...input(), selections: [value] }),
      ).toThrow("SELECTION_UNAVAILABLE");
    },
  );
  it("AC-023 only one fresh context can resolve an ordinal", () => {
    expect(planFrozenGroundingRequest(input()).kind).toBe("QUERY");
    expect(planFrozenGroundingRequest(input("all-choices"))).toEqual({
      kind: "CLARIFICATION",
      reasonCode: "SELECTION_AMBIGUOUS",
    });
    expect(planFrozenGroundingRequest(input("empty"))).toEqual({
      kind: "CLARIFICATION",
      reasonCode: "SELECTION_CONTEXT_REQUIRED",
    });
  });
  it("AC-024 rejects click/text disagreement, duplicate/conflicting choices, extra fields and more than eight selectors", () => {
    const one = selector(context(), 0, 0),
      two = selector(context());
    for (const selections of [
      [one],
      [two, two],
      [one, two],
      [{ ...two, providerArgs: {} }],
      Array.from({ length: 9 }, () => two),
    ])
      expect(() =>
        planFrozenGroundingRequest({ ...input(), selections }),
      ).toThrow();
    expect(() =>
      planFrozenGroundingRequest({ ...input(), text: "第一个或第二个" }),
    ).toThrow("SELECTION_CONFLICT");
  });
  it("AC-025 clock boundary rejects expiry without changing source TTL or identity", () => {
    const args = input(),
      before = JSON.stringify(args.context.result);
    const until = Date.parse(
      args.context.result.worldAnalysisFindings.choices[0]!.validUntil,
    );
    expect(
      planFrozenGroundingRequest({ ...args, now: () => until - 1 }).kind,
    ).toBe("QUERY");
    expect(planFrozenGroundingRequest({ ...args, now: () => until })).toEqual({
      kind: "CLARIFICATION",
      reasonCode: "SELECTION_EXPIRED",
    });
    expect(() =>
      planFrozenGroundingRequest({
        ...args,
        text: "此候选",
        selections: [selector(args.context)],
        now: () => until,
      }),
    ).toThrow("SELECTION_EXPIRED");
    expect(JSON.stringify(args.context.result)).toBe(before);
  });
  it("AC-010 AC-026 stable command body/key; changed semantics retain key for durable conflict detection", () => {
    const a = planFrozenGroundingRequest(input()),
      b = planFrozenGroundingRequest(input());
    expect(a).toEqual(b);
    const changed = planFrozenGroundingRequest({
      ...input(),
      text: "只查活动阶段",
    });
    const next = planFrozenGroundingRequest({
      ...input(),
      commandId: "next-command",
      text: "只查活动阶段",
    });
    if (a.kind !== "QUERY" || changed.kind !== "QUERY" || next.kind !== "QUERY")
      throw Error("EXPECTED_QUERY");
    expect(a.idempotencyKey).toBe(changed.idempotencyKey);
    expect(a.requestHash).not.toBe(changed.requestHash);
    expect(next.idempotencyKey).not.toBe(a.idempotencyKey);
    expect(a.semanticHash).not.toBe(a.requestHash);
  });
  it("AC-027 AC-028 display only does not requery; context replacement removes old selections and prior anchor", () => {
    expect(
      planFrozenGroundingRequest({ ...input(), text: "聚焦地图" }),
    ).toEqual({ kind: "PRESENTATION", action: "FOCUS_MAP" });
    expect(
      planFrozenGroundingRequest({ ...input(), text: "展开卡片" }),
    ).toEqual({ kind: "PRESENTATION", action: "EXPAND_CARD" });
    const changed = planFrozenGroundingRequest({
      ...input(),
      commandId: "next",
      text: "改查第二次任务的丢包率",
      contextMode: "REPLACE",
    });
    if (changed.kind !== "QUERY") throw Error("EXPECTED_QUERY");
    expect(changed.request.analysisSelections).toBeUndefined();
    expect(changed.request.contextCapsule.priorGroundings).toEqual([]);
    expect(() =>
      planFrozenGroundingRequest({
        ...input(),
        contextMode: "REPLACE",
        selections: [selector(context())],
      }),
    ).toThrow("SELECTION_CONFLICT");
    expect(() =>
      planFrozenGroundingRequest({
        ...input(),
        expectedRevisionId: "stale-revision",
      }),
    ).toThrow("ANALYSIS_REVISION_CONFLICT");
  });
});
