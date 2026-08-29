import { describe, expect, it } from "@jest/globals";

import {
  GroundingPlanningError,
  planGroundingRequest,
} from "../packages/grounding-request-planner/src/index.js";
import type { TurnPlan } from "../packages/world-grounding-contract/src/index.js";

const noFocus = {
  knownWorldReferences: false,
  priorGrounding: false,
  mapSelections: false,
  externalCorrelationHints: false,
  externalPredicates: false,
};

describe("deterministic GroundingRequestPlanner", () => {
  it.each([
    {
      requirement: "RESOLVE_REFERENCES" as const,
      operation: "GROUND_REFERENCES",
      requestedProducts: ["MENTIONS", "RESOLVED_REFERENCES", "GROUNDING_GRAPH"],
    },
    {
      requirement: "ANSWER_WORLD_QUERY" as const,
      operation: "EXECUTE_WORLD_QUERY",
      requestedProducts: [
        "MENTIONS",
        "RESOLVED_REFERENCES",
        "WORLD_QUERY",
        "WORLD_EVIDENCE",
      ],
    },
    {
      requirement: "VALIDATE_REFERENCES" as const,
      operation: "VALIDATE_REFERENCES",
      requestedProducts: ["RESOLVED_REFERENCES"],
    },
    {
      requirement: "COMPARE_PLAN_REALITY" as const,
      operation: "EXECUTE_WORLD_QUERY",
      requestedProducts: [
        "RESOLVED_REFERENCES",
        "WORLD_EVIDENCE",
        "OPERATIONAL_TASKS",
        "EVENT_TIMELINES",
        "CORRELATION_FINDINGS",
        "PREDICATE_EVALUATIONS",
      ],
    },
  ])(
    "maps $requirement without model-selected operation or product inputs",
    ({ requirement, operation, requestedProducts }) => {
      const plan = planGroundingRequest(
        turnPlan(requirement, requirement === "COMPARE_PLAN_REALITY"),
      );
      expect(plan).toEqual({
        schemaVersion: "1.0",
        plannedBy: "SACS_DETERMINISTIC_V1",
        operation,
        requestedProducts,
        contextUsage: noFocus,
        executionPolicy: {
          readOnly: true,
          deadlineMs: 30_000,
          maxQueryOperations: 16,
          maxCandidatesPerMention: 5,
          maxResultBytes: 1_048_576,
          allowApproximation: false,
        },
      });
    },
  );

  it("fails closed when no grounding is required", () => {
    expect(() => planGroundingRequest(turnPlan("NONE", false))).toThrow(
      GroundingPlanningError,
    );
  });
});

function turnPlan(
  groundingRequirement: TurnPlan["groundingRequirement"],
  hybrid: boolean,
): TurnPlan {
  const operational =
    groundingRequirement === "RESOLVE_REFERENCES" ||
    groundingRequirement === "VALIDATE_REFERENCES";
  return {
    schemaVersion: "0.4",
    turnRoute:
      groundingRequirement === "NONE"
        ? "GENERAL_CHAT"
        : hybrid
          ? "HYBRID_PLAN_REALITY_COMPARE"
          : operational
            ? "SDAR_TASK"
            : "WORLD_ANSWER",
    groundingRequirement,
    answerMode:
      groundingRequirement === "NONE"
        ? "DIRECT"
        : hybrid
          ? "HYBRID_COMPARISON"
          : "GROUNDED",
    ...(hybrid
      ? {
          taskDirective: {
            action: "STATUS" as const,
            selector: { reference: "focused" as const },
          },
        }
      : operational
        ? { taskDirective: { action: "CREATE" as const } }
        : {}),
    worldFocusUsage: noFocus,
  };
}
