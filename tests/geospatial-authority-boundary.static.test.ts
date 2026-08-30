import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";

import {
  AuthorityFusionEvaluator,
  parsePlanRealityRequirements,
  parseSdarTaskObservationV2,
} from "../packages/authority-fusion/src/index.js";
import {
  classifyGeospatialPresentationSource,
  composeAuthoritySeparatedPresentation,
  DEFAULT_GEOSPATIAL_AUTHORITY_PRESENTATION_POLICY,
  geospatialPresentationSourceDecisionSchema,
} from "../packages/geospatial-explanation-policy/src/index.js";
import {
  parseWsgsGroundingResult,
  type WsgsGroundingResult,
} from "../packages/wsgs-http-adapter/src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const hash = `sha256:${"a".repeat(64)}`;
const observedAt = "2026-08-29T08:00:00.000Z";

describe("S23 geospatial Authority Fusion presentation boundary", () => {
  it("classifies findings as context and only typed fusion products as eligible", () => {
    expect(classifyGeospatialPresentationSource("GEOSPATIAL_FINDING")).toEqual({
      sourceKind: "GEOSPATIAL_FINDING",
      section: "WORLD_EXPLANATION",
      fusionEligible: false,
      taskOutcomeInferenceAllowed: false,
    });
    expect(
      classifyGeospatialPresentationSource("PREDICATE_EVALUATION"),
    ).toMatchObject({ fusionEligible: true });
    expect(
      classifyGeospatialPresentationSource("CORRELATION_FINDING"),
    ).toMatchObject({ fusionEligible: true });
    expect(DEFAULT_GEOSPATIAL_AUTHORITY_PRESENTATION_POLICY).toMatchObject({
      taskAuthority: "SDAR",
      worldAuthority: "WSGS_GOWM",
      compositionAuthority: "SACS_COMPARE_ONLY",
      geospatialFindingCanDirectlyAffectFusion: false,
    });
    expect(() =>
      geospatialPresentationSourceDecisionSchema.parse({
        sourceKind: "GEOSPATIAL_FINDING",
        section: "SACS_FUSION_CHECKS",
        fusionEligible: true,
        taskOutcomeInferenceAllowed: false,
      }),
    ).toThrow();
  });

  it("keeps task, world, and compare-only sections structurally separate", () => {
    const presentation = composeAuthoritySeparatedPresentation({
      taskPlanText: "Task is still working.",
      worldExplanationText: "Road water was reported by the world authority.",
      fusionChecksText: "No typed plan predicate was available.",
    });
    expect(
      presentation.sections.map(({ section, authority }) => [
        section,
        authority,
      ]),
    ).toEqual([
      ["SDAR_TASK_PLAN", "SDAR"],
      ["WORLD_EXPLANATION", "WSGS_GOWM"],
      ["SACS_FUSION_CHECKS", "SACS_COMPARE_ONLY"],
    ]);
    expect(presentation.taskOutcomeInferenceAllowed).toBe(false);
    expect(() =>
      composeAuthoritySeparatedPresentation({
        taskPlanText: "Task",
        worldExplanationText: "World",
        fusionChecksText: "Checks",
        inferredTaskOutcome: "FAILED",
      }),
    ).toThrow();
  });

  it("does not change evaluator output when a finding claims a task outcome", () => {
    const evaluator = new AuthorityFusionEvaluator({
      now: () => new Date(observedAt),
    });
    const input = {
      task: task(),
      requirements: requirements(),
    };
    const withoutFinding = evaluator.evaluate({
      ...input,
      grounding: grounding(),
    });
    const withFinding = evaluator.evaluate({
      ...input,
      grounding: grounding(geospatialFindings()),
    });
    expect(withFinding).toEqual(withoutFinding);
    expect(withFinding).toMatchObject({
      overall: "UNKNOWN",
      checks: [
        {
          evaluation: "UNKNOWN",
          reasonCode: "PREDICATE_EVALUATION_UNAVAILABLE",
        },
      ],
    });
  });

  it("statically preserves the evaluator's exact typed evidence gates", () => {
    const evaluatorSource = readFileSync(
      `${root}packages/authority-fusion/src/index.ts`,
      "utf8",
    );
    expect(evaluatorSource).not.toContain("geospatialFindings");
    expect(evaluatorSource).toMatch(
      /item\.productKind !== "PREDICATE_EVALUATION"/u,
    );
    expect(evaluatorSource).toMatch(
      /item\.productKind !== "CORRELATION_FINDING"/u,
    );
    for (const forbidden of [
      "TASK_FAILED",
      "PLAN_VIOLATED",
      "ROUTE_FEASIBLE",
      "TARGET_VISIBLE",
      "ACTION_SUCCEEDED",
    ]) {
      expect(evaluatorSource).not.toContain(forbidden);
    }
  });
});

function task() {
  return parseSdarTaskObservationV2({
    schemaVersion: "2.0",
    taskId: "task-1",
    taskState: "COMPLETED",
    observedAt,
    correlation: {
      system: "SDAR",
      externalTaskId: "task-1",
      contextId: "context-1",
    },
  });
}

function requirements() {
  return parsePlanRealityRequirements({
    schemaVersion: "1.0",
    taskId: "task-1",
    taskSnapshotHash: hash,
    correlationHints: [],
    predicates: [
      {
        schemaUri: "urn:gowm:v0.4:external-predicate",
        schemaHash: hash,
        value: { predicateId: "predicate-1" },
      },
    ],
    comparability: "COMPARABLE",
  });
}

function grounding(
  geospatialFindings?: WsgsGroundingResult["geospatialFindings"],
) {
  return parseWsgsGroundingResult({
    schemaVersion: "1.0",
    requestId: "request-1",
    groundingId: "grounding-1",
    status: "COMPLETED",
    source: { messageId: "message-1", originalTextSha256: hash },
    mentions: [],
    referenceProducts: [],
    evidenceItems: [],
    ...(geospatialFindings === undefined ? {} : { geospatialFindings }),
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

function geospatialFindings(): NonNullable<
  WsgsGroundingResult["geospatialFindings"]
> {
  return {
    profile: "sacs-wsgs-geospatial-findings/1.0",
    profileSchemaHash: hash,
    findings: [
      {
        findingId: "finding-water",
        findingKind: "QUALIFIED_EXPLANATION",
        semanticConcept: "ROAD_WATER",
        querySemantics: "QUALIFIED_EXPLANATION",
        status: "COMPLETED",
        evidenceItemIds: ["evidence-water"],
        sourceProductIds: [],
        explanationCode: "ROAD_WATER_REPORTED",
        summary: "Road water was reported.",
        reasonCodes: [],
        publishedFacts: {
          taskOutcome: "FAILED",
          planViolated: true,
        },
      },
    ],
    sourceProducts: [],
    gaps: [],
    findingSetHash: hash,
    sourceProductSetHash: hash,
  };
}
