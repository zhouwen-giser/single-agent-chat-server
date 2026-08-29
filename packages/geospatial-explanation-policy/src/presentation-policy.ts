import { z } from "zod";

export const geospatialPresentationSourceKinds = [
  "GEOSPATIAL_FINDING",
  "PREDICATE_EVALUATION",
  "CORRELATION_FINDING",
  "GENERIC_SAFE_PAYLOAD",
] as const;

const presentationSourceKindSchema = z.enum(geospatialPresentationSourceKinds);

export const geospatialAuthorityPresentationPolicySchema = z.strictObject({
  schemaVersion: z.literal("sacs-geospatial-authority-presentation-policy/1.0"),
  taskAuthority: z.literal("SDAR"),
  worldAuthority: z.literal("WSGS_GOWM"),
  currentProductAuthority: z.literal("GDPS"),
  compositionAuthority: z.literal("SACS_COMPARE_ONLY"),
  fusionPositiveSources: z
    .array(z.enum(["PREDICATE_EVALUATION", "CORRELATION_FINDING"]))
    .length(2)
    .refine((value) => new Set(value).size === value.length),
  geospatialFindingRole: z.literal("WORLD_CONTEXT_ONLY"),
  geospatialFindingCanDirectlyAffectFusion: z.literal(false),
  forbiddenInferences: z
    .array(
      z.enum([
        "TASK_FAILED",
        "PLAN_VIOLATED",
        "ROUTE_FEASIBLE",
        "TARGET_VISIBLE",
        "ACTION_SUCCEEDED",
      ]),
    )
    .length(5)
    .refine((value) => new Set(value).size === value.length),
});

export const DEFAULT_GEOSPATIAL_AUTHORITY_PRESENTATION_POLICY =
  geospatialAuthorityPresentationPolicySchema.parse({
    schemaVersion: "sacs-geospatial-authority-presentation-policy/1.0",
    taskAuthority: "SDAR",
    worldAuthority: "WSGS_GOWM",
    currentProductAuthority: "GDPS",
    compositionAuthority: "SACS_COMPARE_ONLY",
    fusionPositiveSources: ["PREDICATE_EVALUATION", "CORRELATION_FINDING"],
    geospatialFindingRole: "WORLD_CONTEXT_ONLY",
    geospatialFindingCanDirectlyAffectFusion: false,
    forbiddenInferences: [
      "TASK_FAILED",
      "PLAN_VIOLATED",
      "ROUTE_FEASIBLE",
      "TARGET_VISIBLE",
      "ACTION_SUCCEEDED",
    ],
  });

export const geospatialPresentationSourceDecisionSchema = z
  .strictObject({
    sourceKind: presentationSourceKindSchema,
    section: z.enum([
      "SDAR_TASK_PLAN",
      "WORLD_EXPLANATION",
      "SACS_FUSION_CHECKS",
      "NON_FACT_CONTEXT",
    ]),
    fusionEligible: z.boolean(),
    taskOutcomeInferenceAllowed: z.literal(false),
  })
  .superRefine((value, context) => {
    const expectedEligible =
      value.sourceKind === "PREDICATE_EVALUATION" ||
      value.sourceKind === "CORRELATION_FINDING";
    const expectedSection =
      value.sourceKind === "GEOSPATIAL_FINDING"
        ? "WORLD_EXPLANATION"
        : expectedEligible
          ? "SACS_FUSION_CHECKS"
          : "NON_FACT_CONTEXT";
    if (
      value.fusionEligible !== expectedEligible ||
      value.section !== expectedSection
    ) {
      context.addIssue({
        code: "custom",
        message: "presentation source crossed an authority boundary",
      });
    }
  });

const separatedPresentationInputSchema = z.strictObject({
  taskPlanText: z.string().min(1).max(16_000),
  worldExplanationText: z.string().min(1).max(16_000),
  fusionChecksText: z.string().min(1).max(16_000),
});

export const authoritySeparatedPresentationSchema = z.strictObject({
  schemaVersion: z.literal("sacs-geospatial-authority-presentation/1.0"),
  sections: z.tuple([
    z.strictObject({
      section: z.literal("SDAR_TASK_PLAN"),
      authority: z.literal("SDAR"),
      content: z.string().min(1).max(16_000),
    }),
    z.strictObject({
      section: z.literal("WORLD_EXPLANATION"),
      authority: z.literal("WSGS_GOWM"),
      content: z.string().min(1).max(16_000),
    }),
    z.strictObject({
      section: z.literal("SACS_FUSION_CHECKS"),
      authority: z.literal("SACS_COMPARE_ONLY"),
      content: z.string().min(1).max(16_000),
    }),
  ]),
  geospatialFindingRole: z.literal("WORLD_CONTEXT_ONLY"),
  fusionEvidenceKinds: z.tuple([
    z.literal("PREDICATE_EVALUATION"),
    z.literal("CORRELATION_FINDING"),
  ]),
  taskOutcomeInferenceAllowed: z.literal(false),
});

export type GeospatialPresentationSourceDecision = z.infer<
  typeof geospatialPresentationSourceDecisionSchema
>;
export type AuthoritySeparatedPresentation = z.infer<
  typeof authoritySeparatedPresentationSchema
>;

export function classifyGeospatialPresentationSource(
  value: unknown,
): GeospatialPresentationSourceDecision {
  const sourceKind = presentationSourceKindSchema.parse(value);
  const fusionEligible =
    sourceKind === "PREDICATE_EVALUATION" ||
    sourceKind === "CORRELATION_FINDING";
  return geospatialPresentationSourceDecisionSchema.parse({
    sourceKind,
    section:
      sourceKind === "GEOSPATIAL_FINDING"
        ? "WORLD_EXPLANATION"
        : fusionEligible
          ? "SACS_FUSION_CHECKS"
          : "NON_FACT_CONTEXT",
    fusionEligible,
    taskOutcomeInferenceAllowed: false,
  });
}

export function composeAuthoritySeparatedPresentation(
  value: unknown,
): AuthoritySeparatedPresentation {
  const input = separatedPresentationInputSchema.parse(value);
  return authoritySeparatedPresentationSchema.parse({
    schemaVersion: "sacs-geospatial-authority-presentation/1.0",
    sections: [
      {
        section: "SDAR_TASK_PLAN",
        authority: "SDAR",
        content: input.taskPlanText,
      },
      {
        section: "WORLD_EXPLANATION",
        authority: "WSGS_GOWM",
        content: input.worldExplanationText,
      },
      {
        section: "SACS_FUSION_CHECKS",
        authority: "SACS_COMPARE_ONLY",
        content: input.fusionChecksText,
      },
    ],
    geospatialFindingRole: "WORLD_CONTEXT_ONLY",
    fusionEvidenceKinds: ["PREDICATE_EVALUATION", "CORRELATION_FINDING"],
    taskOutcomeInferenceAllowed: false,
  });
}
