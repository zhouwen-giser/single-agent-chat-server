import { z } from "zod";

import { taskSelectorSchema } from "../../task-directory/src/index.js";

export const turnRoutes = [
  "GENERAL_CHAT",
  "WORLD_ANSWER",
  "SDAR_TASK",
  "TASK_QUERY",
  "HYBRID_PLAN_REALITY_COMPARE",
  "CLARIFICATION",
] as const;

export const groundingRequirements = [
  "NONE",
  "RESOLVE_REFERENCES",
  "ANSWER_WORLD_QUERY",
  "VALIDATE_REFERENCES",
  "COMPARE_PLAN_REALITY",
] as const;

export const answerModes = [
  "DIRECT",
  "GROUNDED",
  "TASK_STATUS",
  "HYBRID_COMPARISON",
  "CLARIFICATION",
] as const;

export const wsgsOperations = [
  "GROUND_REFERENCES",
  "COMPILE_WORLD_QUERY",
  "EXECUTE_WORLD_QUERY",
  "VALIDATE_REFERENCES",
] as const;

export const wsgsRequestedProducts = [
  "MENTIONS",
  "RESOLVED_REFERENCES",
  "DERIVED_REFERENCES",
  "REFERENCE_SETS",
  "GROUNDING_GRAPH",
  "WORLD_QUERY",
  "WORLD_EVIDENCE",
  "OPERATIONAL_TASKS",
  "EVENT_TIMELINES",
  "CORRELATION_FINDINGS",
  "PREDICATE_EVALUATIONS",
] as const;

const followUpActions = [
  "confirm_plan",
  "reject_plan",
  "revise_plan",
  "patch_goal",
  "cancel_goal",
  "provide_input",
  "pause",
  "resume",
] as const;

const taskDirectiveSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("CREATE") }),
  z.strictObject({
    action: z.literal("LIST"),
    includeTerminal: z.boolean(),
  }),
  z.strictObject({
    action: z.literal("STATUS"),
    selector: taskSelectorSchema.optional(),
  }),
  z.strictObject({
    action: z.literal("FOLLOW_UP"),
    selector: taskSelectorSchema,
    followUpAction: z.enum(followUpActions),
  }),
  z.strictObject({
    action: z.literal("CANCEL"),
    selector: taskSelectorSchema,
  }),
]);

const worldFocusUsageSchema = z.strictObject({
  knownWorldReferences: z.boolean(),
  priorGrounding: z.boolean(),
  mapSelections: z.boolean(),
  externalCorrelationHints: z.boolean(),
  externalPredicates: z.boolean(),
});

export const turnPlanSchema = z
  .strictObject({
    schemaVersion: z.literal("0.4"),
    turnRoute: z.enum(turnRoutes),
    groundingRequirement: z.enum(groundingRequirements),
    answerMode: z.enum(answerModes),
    taskDirective: taskDirectiveSchema.optional(),
    worldFocusUsage: worldFocusUsageSchema,
    clarification: z.string().min(1).max(4_000).optional(),
  })
  .superRefine((value, context) => {
    const usesWorldFocus = Object.values(value.worldFocusUsage).some(Boolean);
    if (value.turnRoute === "CLARIFICATION" && !value.clarification) {
      context.addIssue({
        code: "custom",
        message: "CLARIFICATION requires a bounded clarification question",
        path: ["clarification"],
      });
    }
    if (value.turnRoute !== "CLARIFICATION" && value.clarification) {
      context.addIssue({
        code: "custom",
        message: "clarification is only allowed on the CLARIFICATION route",
        path: ["clarification"],
      });
    }
    if (
      ["WORLD_ANSWER", "HYBRID_PLAN_REALITY_COMPARE"].includes(
        value.turnRoute,
      ) &&
      value.groundingRequirement === "NONE"
    ) {
      context.addIssue({
        code: "custom",
        message: "world routes require grounding",
        path: ["groundingRequirement"],
      });
    }
    if (
      value.turnRoute === "HYBRID_PLAN_REALITY_COMPARE" &&
      value.groundingRequirement !== "COMPARE_PLAN_REALITY"
    ) {
      context.addIssue({
        code: "custom",
        message: "hybrid comparison requires COMPARE_PLAN_REALITY",
        path: ["groundingRequirement"],
      });
    }
    if (usesWorldFocus && value.groundingRequirement === "NONE") {
      context.addIssue({
        code: "custom",
        message: "world-focus inputs require grounding",
        path: ["worldFocusUsage"],
      });
    }
    if (
      ["SDAR_TASK", "TASK_QUERY", "HYBRID_PLAN_REALITY_COMPARE"].includes(
        value.turnRoute,
      ) !== Boolean(value.taskDirective)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "task routes require a task directive and other routes forbid it",
        path: ["taskDirective"],
      });
    }
  });

export const groundingRequestPlanSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  plannedBy: z.literal("SACS_DETERMINISTIC_V1"),
  operation: z.enum(wsgsOperations),
  requestedProducts: z
    .array(z.enum(wsgsRequestedProducts))
    .min(1)
    .max(16)
    .refine((value) => new Set(value).size === value.length, {
      message: "requested products must be unique",
    }),
  contextUsage: worldFocusUsageSchema,
  executionPolicy: z.strictObject({
    readOnly: z.literal(true),
    deadlineMs: z.number().int().min(100).max(120_000),
    maxQueryOperations: z.number().int().min(1).max(64),
    maxCandidatesPerMention: z.number().int().min(1).max(20),
    maxResultBytes: z.number().int().min(1_024).max(67_108_864),
    allowApproximation: z.boolean(),
  }),
});

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const identifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const referenceKeySchema = z.strictObject({
  namespace: z.literal("gowm"),
  kind: z.string().min(1).max(64),
  id: z.string().regex(/^wrf_[0-9a-f]{32}$/u),
  version: z.string().min(1).max(128),
});

export const operationalGroundingBundleSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    purpose: z.literal("SDAR_OPERATION"),
    groundingId: identifierSchema,
    groundingResultHash: sha256Schema,
    references: z
      .array(
        z.strictObject({
          productId: identifierSchema,
          referenceKey: referenceKeySchema,
          sourceWorldVersion: z.number().int().nonnegative(),
          validUntil: z.iso.datetime(),
          revalidationRequired: z.literal(false),
          validationStatus: z.literal("VALIDATED"),
          confirmationStatus: z.enum(["NOT_REQUIRED", "EXPLICITLY_CONFIRMED"]),
        }),
      )
      .min(1)
      .max(64),
    evidenceItemIds: z.array(identifierSchema).max(128),
    ambiguityPolicy: z.strictObject({
      outcome: z.enum(["NO_AMBIGUITY", "EXPLICITLY_CONFIRMED"]),
      autoAcceptSuggestedUnique: z.literal(false),
    }),
    validation: z.strictObject({
      authority: z.literal("WSGS"),
      operation: z.literal("VALIDATE_REFERENCES"),
      validatedAt: z.iso.datetime(),
      validationResultHash: sha256Schema,
    }),
    createdAt: z.iso.datetime(),
  })
  .superRefine((value, context) => {
    const validatedAt = Date.parse(value.validation.validatedAt);
    for (const [index, reference] of value.references.entries()) {
      if (Date.parse(reference.validUntil) <= validatedAt) {
        context.addIssue({
          code: "custom",
          message: "operational references must be valid after validation",
          path: ["references", index, "validUntil"],
        });
      }
    }
  });

export const hybridPlanRealityCompareSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  mode: z.literal("HYBRID_PLAN_REALITY_COMPARE"),
  generatedAt: z.iso.datetime(),
  plan: z.strictObject({
    authority: z.literal("SDAR"),
    taskId: identifierSchema,
    observedStatus: z.string().min(1).max(128),
    publishedSummary: z.string().min(1).max(8_000),
    observedAt: z.iso.datetime(),
  }),
  reality: z.strictObject({
    authority: z.literal("WSGS_GOWM"),
    groundingId: identifierSchema,
    resultHash: sha256Schema,
    sourceWorldVersion: z.number().int().nonnegative(),
    evidenceItemIds: z.array(identifierSchema).max(128),
    observedAt: z.iso.datetime(),
  }),
  composition: z.strictObject({
    authority: z.literal("SACS"),
    relationship: z.literal("COMPARE_ONLY"),
    summary: z.string().min(1).max(8_000),
    differences: z
      .array(
        z.strictObject({
          subject: z.string().min(1).max(512),
          planned: z.string().min(1).max(2_000),
          observed: z.string().min(1).max(2_000),
        }),
      )
      .max(128),
  }),
});

export type TurnPlan = z.infer<typeof turnPlanSchema>;
export type GroundingRequestPlan = z.infer<typeof groundingRequestPlanSchema>;
export type OperationalGroundingBundle = z.infer<
  typeof operationalGroundingBundleSchema
>;
export type HybridPlanRealityCompare = z.infer<
  typeof hybridPlanRealityCompareSchema
>;

export function parseTurnPlan(value: unknown): TurnPlan {
  return turnPlanSchema.parse(value);
}

export function parseGroundingRequestPlan(
  value: unknown,
): GroundingRequestPlan {
  return groundingRequestPlanSchema.parse(value);
}

export function parseOperationalGroundingBundle(
  value: unknown,
): OperationalGroundingBundle {
  return operationalGroundingBundleSchema.parse(value);
}

export function parseHybridPlanRealityCompare(
  value: unknown,
): HybridPlanRealityCompare {
  return hybridPlanRealityCompareSchema.parse(value);
}
