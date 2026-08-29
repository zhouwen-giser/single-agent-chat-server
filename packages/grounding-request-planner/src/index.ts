import {
  groundingRequestPlanSchema,
  parseTurnPlan,
  type GroundingRequestPlan,
  type TurnPlan,
} from "../../world-grounding-contract/src/index.js";

export class GroundingPlanningError extends Error {
  readonly code = "GROUNDING_NOT_REQUIRED";

  constructor() {
    super("TurnPlan does not require WSGS grounding");
  }
}

const executionPolicy = {
  readOnly: true,
  deadlineMs: 30_000,
  maxQueryOperations: 16,
  maxCandidatesPerMention: 5,
  maxResultBytes: 1_048_576,
  allowApproximation: false,
} as const;

export function planGroundingRequest(input: TurnPlan): GroundingRequestPlan {
  const turnPlan = parseTurnPlan(input);
  const base = {
    schemaVersion: "1.0" as const,
    plannedBy: "SACS_DETERMINISTIC_V1" as const,
    contextUsage: turnPlan.worldFocusUsage,
    executionPolicy,
  };

  switch (turnPlan.groundingRequirement) {
    case "RESOLVE_REFERENCES":
      return groundingRequestPlanSchema.parse({
        ...base,
        operation: "GROUND_REFERENCES",
        requestedProducts: [
          "MENTIONS",
          "RESOLVED_REFERENCES",
          "GROUNDING_GRAPH",
        ],
      });
    case "ANSWER_WORLD_QUERY":
      return groundingRequestPlanSchema.parse({
        ...base,
        operation: "EXECUTE_WORLD_QUERY",
        requestedProducts: [
          "MENTIONS",
          "RESOLVED_REFERENCES",
          "WORLD_QUERY",
          "WORLD_EVIDENCE",
        ],
      });
    case "VALIDATE_REFERENCES":
      return groundingRequestPlanSchema.parse({
        ...base,
        operation: "VALIDATE_REFERENCES",
        requestedProducts: ["RESOLVED_REFERENCES"],
      });
    case "COMPARE_PLAN_REALITY":
      return groundingRequestPlanSchema.parse({
        ...base,
        operation: "EXECUTE_WORLD_QUERY",
        requestedProducts: [
          "RESOLVED_REFERENCES",
          "WORLD_EVIDENCE",
          "OPERATIONAL_TASKS",
          "EVENT_TIMELINES",
          "CORRELATION_FINDINGS",
          "PREDICATE_EVALUATIONS",
        ],
      });
    case "NONE":
      throw new GroundingPlanningError();
  }
}
