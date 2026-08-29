import { describe, expect, it } from "@jest/globals";

import {
  AuthorityFusionEvaluator,
  AuthorityFusionRenderer,
  calculateOverall,
  parsePlanRealityRequirements,
  parseSdarTaskObservationV2,
} from "../packages/authority-fusion/src/index.js";
import {
  parseWsgsGroundingResult,
  type WsgsGroundingResult,
} from "../packages/wsgs-http-adapter/src/index.js";

const observedAt = "2026-08-29T08:00:00.000Z";
const hash = "sha256:" + "a".repeat(64);

describe("SACS v0.4 S10 Authority Fusion evaluator", () => {
  it("AC-U001 maps typed SUPPORTED evidence to SATISFIED", () => {
    const result = evaluate("COMPLETED", [
      predicateEvidence("p-1", "SUPPORTED"),
    ]);
    expect(result.checks).toMatchObject([
      { evaluation: "SATISFIED", evidenceItemIds: ["evidence-p-1"] },
    ]);
    expect(result.overall).toBe("CONSISTENT");
  });

  it("AC-U002/U005/U009 maps completed typed false to required VIOLATED and INCONSISTENT", () => {
    const result = evaluate("COMPLETED", [
      predicateEvidence("p-1", "NOT_SUPPORTED"),
    ]);
    expect(result.checks[0]).toMatchObject({
      evaluation: "VIOLATED",
      observed: "NOT_SUPPORTED",
      evidenceItemIds: ["evidence-p-1"],
    });
    expect(result.overall).toBe("INCONSISTENT");
  });

  it("AC-U003/U007 maps typed NO_DATA to UNKNOWN without a violation", () => {
    const result = evaluate("COMPLETED", [predicateNoData("p-1")]);
    expect(result.checks[0]).toMatchObject({
      evaluation: "UNKNOWN",
      evidenceItemIds: ["evidence-p-1"],
    });
    expect(result.overall).toBe("UNKNOWN");
  });

  it("AC-U004 returns NOT_COMPARABLE when no structured requirement exists", () => {
    const result = evaluator().evaluate({
      task: task("INPUT_REQUIRED"),
      requirements: parsePlanRealityRequirements({
        ...requirements(),
        predicates: [],
        comparability: "NOT_COMPARABLE",
        reasonCodes: ["PUBLISHED_STRUCTURED_PLAN_ABSENT"],
      }),
      grounding: grounding([]),
    });
    expect(result).toMatchObject({
      overall: "NOT_COMPARABLE",
      checks: [{ evaluation: "NOT_COMPARABLE", evidenceItemIds: [] }],
    });
  });

  it("AC-U006 calculates CONSISTENT only when every required check is satisfied", () => {
    expect(
      calculateOverall([
        check("required-1", true, "SATISFIED"),
        check("optional-1", false, "UNKNOWN"),
      ]),
    ).toBe("CONSISTENT");
  });

  it("AC-U008 does not prematurely violate a WORKING destination", () => {
    const result = evaluate("WORKING", [
      predicateEvidence("p-1", "NOT_SUPPORTED"),
    ]);
    expect(result.checks[0]).toMatchObject({
      evaluation: "UNKNOWN",
      reasonCode: "TASK_NOT_TERMINAL_DO_NOT_PREMATURELY_VIOLATE",
    });
    expect(result.overall).toBe("UNKNOWN");
  });

  it("AC-U010 preserves FAILED without inferring a cause", () => {
    const result = evaluate("FAILED", [
      predicateEvidence("p-1", "NOT_SUPPORTED"),
    ]);
    expect(result.checks[0]).toMatchObject({
      evaluation: "UNKNOWN",
      reasonCode: "FAILED_TASK_CAUSE_NOT_INFERRED",
    });
  });

  it("AC-U011 observes CANCELED without mutating the task or grounding", () => {
    const taskValue = task("CANCELED");
    const groundingValue = grounding([
      predicateEvidence("p-1", "NOT_SUPPORTED"),
    ]);
    const before = JSON.stringify({ taskValue, groundingValue });
    const result = evaluator().evaluate({
      task: taskValue,
      requirements: requirements(),
      grounding: groundingValue,
    });
    expect(result.checks[0]).toMatchObject({
      evaluation: "UNKNOWN",
      reasonCode: "CANCELED_TASK_OBSERVATION_ONLY",
    });
    expect(JSON.stringify({ taskValue, groundingValue })).toBe(before);
  });

  it("AC-U012 degrades only the check whose evidence is partial", () => {
    const result = evaluator().evaluate({
      task: task("COMPLETED"),
      requirements: requirements(["p-1", "p-2"]),
      grounding: grounding([
        predicateEvidence("p-1", "SUPPORTED"),
        predicateNoData("p-2"),
      ]),
    });
    expect(result.checks.map(({ evaluation }) => evaluation)).toEqual([
      "SATISFIED",
      "UNKNOWN",
    ]);
    expect(result.overall).toBe("UNKNOWN");
  });

  it("AC-U013 ignores an optional correlation gap when required predicates pass", () => {
    const value = requirements();
    const result = evaluator().evaluate({
      task: task("COMPLETED"),
      requirements: parsePlanRealityRequirements({
        ...value,
        correlationHints: [
          {
            hintId: "context-hint",
            externalAuthority: "SDAR",
            kind: "OPERATION_CORRELATION",
            value: "context-1",
            relationHint: "RELATED_TO",
          },
        ],
      }),
      grounding: grounding([predicateEvidence("p-1", "SUPPORTED")]),
    });
    expect(result.checks).toMatchObject([
      { required: false, evaluation: "UNKNOWN" },
      { required: true, evaluation: "SATISFIED" },
    ]);
    expect(result.overall).toBe("CONSISTENT");
  });

  it("AC-U016 backs every comparable semantic decision with typed evidence IDs", () => {
    const result = evaluate("COMPLETED", [
      predicateEvidence("p-1", "SUPPORTED"),
    ]);
    expect(
      result.checks.every(
        (check) =>
          check.evaluation === "NOT_COMPARABLE" ||
          check.evidenceItemIds.length > 0,
      ),
    ).toBe(true);
  });

  it("AC-U017 ignores untyped safe payload claims and renders only decisions", () => {
    const untyped = {
      ...predicateEvidence("p-1", "SUPPORTED"),
      productKind: "WORLD_FACT" as const,
      safePayload: { predicateId: "p-1", status: "SUPPORTED" },
    };
    const result = evaluate("COMPLETED", [untyped]);
    expect(result.checks[0]).toMatchObject({
      evaluation: "UNKNOWN",
      evidenceItemIds: [],
    });
    expect(new AuthorityFusionRenderer().render(result)).not.toContain(
      "safePayload",
    );
  });
});

function evaluator() {
  return new AuthorityFusionEvaluator({ now: () => new Date(observedAt) });
}

function evaluate(
  state: "WORKING" | "COMPLETED" | "FAILED" | "CANCELED",
  evidenceItems: WsgsGroundingResult["evidenceItems"],
) {
  return evaluator().evaluate({
    task: task(state),
    requirements: requirements(),
    grounding: grounding(evidenceItems),
  });
}

function task(
  state: "INPUT_REQUIRED" | "WORKING" | "COMPLETED" | "FAILED" | "CANCELED",
) {
  return parseSdarTaskObservationV2({
    schemaVersion: "2.0",
    taskId: "task-1",
    taskState: state,
    observedAt,
    correlation: {
      system: "SDAR",
      externalTaskId: "task-1",
      contextId: "context-1",
    },
  });
}

function requirements(predicateIds: readonly string[] = ["p-1"]) {
  return parsePlanRealityRequirements({
    schemaVersion: "1.0",
    taskId: "task-1",
    taskSnapshotHash: hash,
    correlationHints: [],
    predicates: predicateIds.map((predicateId) => ({
      schemaUri: "urn:gowm:v0.4:external-predicate",
      schemaHash: hash,
      value: { predicateId },
    })),
    comparability: "COMPARABLE",
  });
}

function grounding(evidenceItems: WsgsGroundingResult["evidenceItems"]) {
  return parseWsgsGroundingResult({
    schemaVersion: "1.0",
    requestId: "request-1",
    groundingId: "grounding-1",
    status: "COMPLETED",
    source: { messageId: "message-1", originalTextSha256: hash },
    mentions: [],
    referenceProducts: [],
    evidenceItems,
    ambiguities: [],
    unresolvedMentions: [],
    capabilityGaps: [],
    warnings: [],
    execution: {
      parserVersion: "1",
      semanticModelReceiptIds: [],
      queryCompilerVersion: "1",
      normalizerVersion: "1",
      elapsedMs: 1,
    },
    resultHash: hash,
  });
}

function predicateEvidence(
  predicateId: string,
  status: "SUPPORTED" | "NOT_SUPPORTED",
) {
  return {
    evidenceProductId: "evidence-" + predicateId,
    productKind: "PREDICATE_EVALUATION" as const,
    authority: "gowm",
    sourceOperation: "predicate.evaluate",
    upstreamStatus: "COMPLETED" as const,
    payloadSchemaUri: "urn:gowm:v0.4:predicate-evaluation",
    payloadSchemaHash: hash,
    safePayload: {
      evaluationId: "evaluation-" + predicateId,
      predicateId,
      status,
      evaluatedAtWorldVersion: 7,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      assumptions: [],
      warnings: [],
      methodVersion: "1",
    },
    receiptIds: [],
    evidenceIds: [],
    unknowns: [],
    warnings: [],
  };
}

function predicateNoData(predicateId: string) {
  return {
    ...predicateEvidence(predicateId, "SUPPORTED"),
    upstreamStatus: "NO_DATA" as const,
    safePayload: { noData: true },
  };
}

function check(
  checkId: string,
  required: boolean,
  evaluation: "SATISFIED" | "VIOLATED" | "UNKNOWN" | "NOT_COMPARABLE",
) {
  return {
    checkId,
    type: "PLAN_PREDICATE" as const,
    required,
    evaluation,
    evidenceItemIds: [],
  };
}
