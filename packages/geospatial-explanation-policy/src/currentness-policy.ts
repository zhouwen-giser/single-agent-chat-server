import { z } from "zod";

import {
  defaultWsgsGeospatialConsumerLock,
  parseWsgsGeospatialConsumerLock,
  type WsgsGeospatialConsumerLock,
} from "../../wsgs-geospatial-consumer/src/index.js";
import {
  explanationGapSchema,
  identifierSchema,
  sha256Schema,
  sourceCurrentnessSchema,
  type ExplanationGap,
  type SourceCurrentness,
} from "../../world-explanation-contract/src/index.js";
import { mapGeospatialGapSituation } from "./gap-policy.js";

const sourceIdentitySchema = z.strictObject({
  productId: identifierSchema,
  previousContentHash: sha256Schema,
});

const currentnessRouteSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    authority: z.literal("WSGS"),
    mode: z.literal("DEDICATED_OPERATION"),
    operation: z.string().min(1).max(128),
  }),
  z.strictObject({
    authority: z.literal("WSGS"),
    mode: z.literal("EXECUTE_WORLD_QUERY_PROFILE"),
    operation: z.literal("EXECUTE_WORLD_QUERY"),
    profile: z.string().min(1).max(128),
  }),
]);

export const geospatialCurrentnessPlanInputSchema = z.strictObject({
  consumerLock: z.unknown().default(defaultWsgsGeospatialConsumerLock),
  sourceProduct: sourceIdentitySchema,
  gapId: identifierSchema,
});

export const geospatialCurrentnessRequestPlanSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal("sacs-geospatial-currentness-request/1.0"),
    status: z.literal("REQUEST_READY"),
    sourceProduct: sourceIdentitySchema,
    consumerLockHash: sha256Schema,
    request: currentnessRouteSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal("sacs-geospatial-currentness-request/1.0"),
    status: z.literal("CURRENTNESS_UNAVAILABLE"),
    sourceProduct: sourceIdentitySchema,
    consumerLockHash: sha256Schema,
    gap: explanationGapSchema,
  }),
]);

const currentnessValidationEnvelopeSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    authority: z.literal("WSGS"),
    mode: z.literal("DEDICATED_OPERATION"),
    operation: z.string().min(1).max(128),
    result: z.unknown(),
  }),
  z.strictObject({
    authority: z.literal("WSGS"),
    mode: z.literal("EXECUTE_WORLD_QUERY_PROFILE"),
    operation: z.literal("EXECUTE_WORLD_QUERY"),
    profile: z.string().min(1).max(128),
    result: z.unknown(),
  }),
]);

export const geospatialCurrentnessEvaluationInputSchema = z.strictObject({
  consumerLock: z.unknown().default(defaultWsgsGeospatialConsumerLock),
  sourceProduct: sourceIdentitySchema,
  reuseMode: z.enum(["STRICT_CURRENT", "BEST_EFFORT"]),
  gapId: identifierSchema,
  validation: currentnessValidationEnvelopeSchema.optional(),
});

export const geospatialCurrentnessDecisionSchema = z
  .strictObject({
    schemaVersion: z.literal("sacs-geospatial-currentness-decision/1.0"),
    sourceProduct: sourceIdentitySchema,
    validationStatus: z.enum([
      "CURRENT",
      "CHANGED",
      "NOT_AVAILABLE",
      "UNKNOWN",
      "UNSUPPORTED",
    ]),
    reuseDecision: z.enum([
      "REUSE_AS_CURRENT",
      "BLOCK_CURRENT_REUSE",
      "NEW_GROUNDING_REQUIRED",
    ]),
    presentation: z.enum([
      "CURRENT_FACT",
      "HISTORICAL_RECORD_ONLY",
      "UNAVAILABLE",
    ]),
    canPresentAsCurrent: z.boolean(),
    absenceInferenceAllowed: z.literal(false),
    messageCode: z.string().min(1).max(128),
    validationGroundingId: identifierSchema.optional(),
    validationResultHash: sha256Schema.optional(),
    gap: explanationGapSchema.optional(),
    sourceAdvanced: z
      .strictObject({
        previousContentHash: sha256Schema,
        actualContentHash: sha256Schema,
      })
      .optional(),
  })
  .superRefine((value, context) => {
    const addIssue = (message: string): void => {
      context.addIssue({ code: "custom", message });
    };
    if (value.validationStatus === "CURRENT") {
      if (
        value.reuseDecision !== "REUSE_AS_CURRENT" ||
        value.presentation !== "CURRENT_FACT" ||
        !value.canPresentAsCurrent ||
        value.gap !== undefined ||
        value.sourceAdvanced !== undefined ||
        value.validationGroundingId === undefined ||
        value.validationResultHash === undefined
      ) {
        addIssue("CURRENT must be exact WSGS-validated current reuse");
      }
      return;
    }
    if (value.canPresentAsCurrent) {
      addIssue("only CURRENT may be presented as current");
    }
    if (value.validationStatus === "CHANGED") {
      if (
        value.presentation !== "HISTORICAL_RECORD_ONLY" ||
        value.gap?.gapKind !== "SOURCE_CHANGED" ||
        value.validationGroundingId === undefined ||
        value.validationResultHash === undefined
      ) {
        addIssue(
          "CHANGED must be historical and retain its source-changed gap",
        );
      }
      if (
        value.reuseDecision === "NEW_GROUNDING_REQUIRED" &&
        (value.messageCode !== "SOURCE_ADVANCED" ||
          value.sourceAdvanced === undefined ||
          value.sourceAdvanced.previousContentHash !==
            value.sourceProduct.previousContentHash ||
          value.sourceAdvanced.actualContentHash ===
            value.sourceProduct.previousContentHash)
      ) {
        addIssue(
          "best-effort CHANGED requires a distinct SOURCE_ADVANCED pair",
        );
      }
      if (
        value.reuseDecision === "BLOCK_CURRENT_REUSE" &&
        (value.messageCode !== "SOURCE_CHANGED_STRICT_REPLAY_BLOCKED" ||
          value.sourceAdvanced !== undefined)
      ) {
        addIssue("strict CHANGED must block reuse without source advancement");
      }
      if (value.reuseDecision === "REUSE_AS_CURRENT") {
        addIssue("CHANGED can never be reused as current");
      }
      return;
    }
    if (
      value.reuseDecision !== "BLOCK_CURRENT_REUSE" ||
      value.presentation !== "UNAVAILABLE" ||
      value.sourceAdvanced !== undefined ||
      value.gap === undefined
    ) {
      addIssue("unavailable or unknown currentness must block current reuse");
    }
    if (
      value.validationStatus === "NOT_AVAILABLE" &&
      value.gap?.gapKind !== "DATA_GAP"
    ) {
      addIssue("NOT_AVAILABLE requires DATA_GAP");
    }
    if (
      value.validationStatus === "UNSUPPORTED" &&
      value.gap?.gapKind !== "CURRENTNESS_UNAVAILABLE"
    ) {
      addIssue("UNSUPPORTED requires CURRENTNESS_UNAVAILABLE");
    }
    if (
      value.validationStatus === "UNKNOWN" &&
      !["CURRENTNESS_UNAVAILABLE", "EVIDENCE_INCOMPLETE"].includes(
        value.gap?.gapKind ?? "",
      )
    ) {
      addIssue("UNKNOWN requires an explicit fail-closed gap");
    }
  });

export type GeospatialCurrentnessRequestPlan = z.infer<
  typeof geospatialCurrentnessRequestPlanSchema
>;
export type GeospatialCurrentnessDecision = z.infer<
  typeof geospatialCurrentnessDecisionSchema
>;

export function planGeospatialCurrentnessValidation(
  value: unknown,
): GeospatialCurrentnessRequestPlan {
  const input = geospatialCurrentnessPlanInputSchema.parse(value);
  const lock = parseWsgsGeospatialConsumerLock(input.consumerLock);
  if (lock.status === "BLOCKED" || lock.currentness.mode === "UNSUPPORTED") {
    return unavailablePlan(input.sourceProduct, input.gapId, lock);
  }
  const request = selectedRoute(lock);
  if (request === undefined) {
    return unavailablePlan(input.sourceProduct, input.gapId, lock);
  }
  return geospatialCurrentnessRequestPlanSchema.parse({
    schemaVersion: "sacs-geospatial-currentness-request/1.0",
    status: "REQUEST_READY",
    sourceProduct: input.sourceProduct,
    consumerLockHash: lock.consumerLockHash,
    request,
  });
}

export function evaluateGeospatialCurrentness(
  value: unknown,
): GeospatialCurrentnessDecision {
  const input = geospatialCurrentnessEvaluationInputSchema.parse(value);
  const lock = parseWsgsGeospatialConsumerLock(input.consumerLock);
  if (lock.status === "BLOCKED" || lock.currentness.mode === "UNSUPPORTED") {
    return unavailableDecision(
      input.sourceProduct,
      input.gapId,
      "CURRENTNESS_UNAVAILABLE",
    );
  }
  if (
    input.validation === undefined ||
    !routeMatchesLock(lock, input.validation)
  ) {
    return evidenceIncompleteDecision(
      input.sourceProduct,
      input.gapId,
      "CURRENTNESS_VALIDATION_ROUTE_MISMATCH",
    );
  }
  const validation = sourceCurrentnessSchema.safeParse(input.validation.result);
  if (
    !validation.success ||
    validation.data.productId !== input.sourceProduct.productId ||
    validation.data.previousContentHash !==
      input.sourceProduct.previousContentHash
  ) {
    return evidenceIncompleteDecision(
      input.sourceProduct,
      input.gapId,
      "CURRENTNESS_VALIDATION_BINDING_MISMATCH",
    );
  }
  return currentnessDecision(
    input.sourceProduct,
    input.reuseMode,
    input.gapId,
    validation.data,
  );
}

function selectedRoute(
  lock: WsgsGeospatialConsumerLock,
): z.infer<typeof currentnessRouteSchema> | undefined {
  if (lock.currentness.mode === "DEDICATED_OPERATION") {
    return lock.currentness.operation === undefined
      ? undefined
      : currentnessRouteSchema.parse({
          authority: "WSGS",
          mode: "DEDICATED_OPERATION",
          operation: lock.currentness.operation,
        });
  }
  if (lock.currentness.mode === "EXECUTE_WORLD_QUERY_PROFILE") {
    return lock.currentness.profile === undefined
      ? undefined
      : currentnessRouteSchema.parse({
          authority: "WSGS",
          mode: "EXECUTE_WORLD_QUERY_PROFILE",
          operation: "EXECUTE_WORLD_QUERY",
          profile: lock.currentness.profile,
        });
  }
  return undefined;
}

function routeMatchesLock(
  lock: WsgsGeospatialConsumerLock,
  validation: z.infer<typeof currentnessValidationEnvelopeSchema>,
): boolean {
  const selected = selectedRoute(lock);
  if (
    selected === undefined ||
    selected.mode !== validation.mode ||
    selected.operation !== validation.operation
  ) {
    return false;
  }
  return selected.mode === "DEDICATED_OPERATION"
    ? true
    : validation.mode === "EXECUTE_WORLD_QUERY_PROFILE" &&
        selected.profile === validation.profile;
}

function unavailablePlan(
  sourceProduct: z.infer<typeof sourceIdentitySchema>,
  gapId: string,
  lock: WsgsGeospatialConsumerLock,
): GeospatialCurrentnessRequestPlan {
  return geospatialCurrentnessRequestPlanSchema.parse({
    schemaVersion: "sacs-geospatial-currentness-request/1.0",
    status: "CURRENTNESS_UNAVAILABLE",
    sourceProduct,
    consumerLockHash: lock.consumerLockHash,
    gap: currentnessGap(gapId),
  });
}

function unavailableDecision(
  sourceProduct: z.infer<typeof sourceIdentitySchema>,
  gapId: string,
  messageCode: string,
): GeospatialCurrentnessDecision {
  return geospatialCurrentnessDecisionSchema.parse({
    schemaVersion: "sacs-geospatial-currentness-decision/1.0",
    sourceProduct,
    validationStatus: "UNSUPPORTED",
    reuseDecision: "BLOCK_CURRENT_REUSE",
    presentation: "UNAVAILABLE",
    canPresentAsCurrent: false,
    absenceInferenceAllowed: false,
    messageCode,
    gap: currentnessGap(gapId),
  });
}

function evidenceIncompleteDecision(
  sourceProduct: z.infer<typeof sourceIdentitySchema>,
  gapId: string,
  messageCode: string,
): GeospatialCurrentnessDecision {
  const gap = mapGeospatialGapSituation({
    upstream: "EVIDENCE_INCOMPLETE",
    gapId,
  }).gap;
  return geospatialCurrentnessDecisionSchema.parse({
    schemaVersion: "sacs-geospatial-currentness-decision/1.0",
    sourceProduct,
    validationStatus: "UNKNOWN",
    reuseDecision: "BLOCK_CURRENT_REUSE",
    presentation: "UNAVAILABLE",
    canPresentAsCurrent: false,
    absenceInferenceAllowed: false,
    messageCode,
    gap,
  });
}

function currentnessDecision(
  sourceProduct: z.infer<typeof sourceIdentitySchema>,
  reuseMode: "STRICT_CURRENT" | "BEST_EFFORT",
  gapId: string,
  validation: SourceCurrentness,
): GeospatialCurrentnessDecision {
  const validationIdentity = {
    validationGroundingId: validation.validationGroundingId,
    validationResultHash: validation.validationResultHash,
  };
  switch (validation.status) {
    case "CURRENT":
      return geospatialCurrentnessDecisionSchema.parse({
        schemaVersion: "sacs-geospatial-currentness-decision/1.0",
        sourceProduct,
        validationStatus: "CURRENT",
        reuseDecision: "REUSE_AS_CURRENT",
        presentation: "CURRENT_FACT",
        canPresentAsCurrent: true,
        absenceInferenceAllowed: false,
        messageCode: "SOURCE_CURRENT",
        ...validationIdentity,
      });
    case "CHANGED": {
      const gap = requiredGap(
        mapGeospatialGapSituation({
          upstream: "SOURCE_CHANGED_DURING_QUERY",
          gapId,
        }).gap,
      );
      return geospatialCurrentnessDecisionSchema.parse({
        schemaVersion: "sacs-geospatial-currentness-decision/1.0",
        sourceProduct,
        validationStatus: "CHANGED",
        reuseDecision:
          reuseMode === "STRICT_CURRENT"
            ? "BLOCK_CURRENT_REUSE"
            : "NEW_GROUNDING_REQUIRED",
        presentation: "HISTORICAL_RECORD_ONLY",
        canPresentAsCurrent: false,
        absenceInferenceAllowed: false,
        messageCode:
          reuseMode === "STRICT_CURRENT"
            ? "SOURCE_CHANGED_STRICT_REPLAY_BLOCKED"
            : "SOURCE_ADVANCED",
        ...validationIdentity,
        gap,
        ...(reuseMode === "BEST_EFFORT"
          ? {
              sourceAdvanced: {
                previousContentHash: validation.previousContentHash,
                actualContentHash: validation.currentContentHash,
              },
            }
          : {}),
      });
    }
    case "NOT_AVAILABLE":
      return unavailableValidationDecision(
        sourceProduct,
        validation,
        requiredGap(
          mapGeospatialGapSituation({
            upstream: "PRODUCT_NOT_AVAILABLE",
            gapId,
          }).gap,
        ),
        "CURRENT_SOURCE_PRODUCT_NOT_AVAILABLE",
      );
    case "UNKNOWN":
      return unavailableValidationDecision(
        sourceProduct,
        validation,
        currentnessGap(gapId),
        "CURRENTNESS_UNKNOWN",
      );
  }
}

function unavailableValidationDecision(
  sourceProduct: z.infer<typeof sourceIdentitySchema>,
  validation: SourceCurrentness,
  gap: ExplanationGap,
  messageCode: string,
): GeospatialCurrentnessDecision {
  return geospatialCurrentnessDecisionSchema.parse({
    schemaVersion: "sacs-geospatial-currentness-decision/1.0",
    sourceProduct,
    validationStatus: validation.status,
    reuseDecision: "BLOCK_CURRENT_REUSE",
    presentation: "UNAVAILABLE",
    canPresentAsCurrent: false,
    absenceInferenceAllowed: false,
    messageCode,
    validationGroundingId: validation.validationGroundingId,
    validationResultHash: validation.validationResultHash,
    gap,
  });
}

function currentnessGap(gapId: string): ExplanationGap {
  return requiredGap(
    mapGeospatialGapSituation({
      upstream: "CURRENTNESS_UNAVAILABLE",
      gapId,
    }).gap,
  );
}

function requiredGap(value: ExplanationGap | undefined): ExplanationGap {
  if (value === undefined) throw new Error("required gap mapping is missing");
  return value;
}
