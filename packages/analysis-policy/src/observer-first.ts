import { z } from "zod";

import { hashCanonicalJson } from "../../world-explanation-contract/src/index.js";

export const OBSERVER_FIRST_POLICY_VERSION =
  "sacs-observer-policy-matrix/1.0" as const;
export const OBSERVER_FIRST_POLICY_HASH = hashCanonicalJson({
  schemaVersion: OBSERVER_FIRST_POLICY_VERSION,
  defaultAutonomyMode: "OBSERVER",
  interruptPolicy: "EXCEPTION_ONLY",
  precedence: [
    "USER_INTERRUPT",
    "HIGH_RISK",
    "PERMISSION",
    "BUDGET",
    "REFERENCE_AMBIGUITY",
    "PRODUCT_AMBIGUITY",
    "TERMINAL_GAP",
    "USER_SUGGEST",
    "READ_ONLY_LONG",
    "READ_ONLY_CLEAR",
  ],
});

export const observerPolicyInputSchema = z
  .object({
    analysisId: z.string().min(1).max(256),
    revisionId: z.string().min(1).max(256),
    nodeId: z.string().min(1).max(256),
    riskLevel: z
      .enum(["READ_ONLY", "REVERSIBLE", "CONTROLLED", "IRREVERSIBLE"])
      .default("READ_ONLY"),
    ambiguity: z
      .enum([
        "NONE",
        "AFFECTS_OUTCOME_UNRESOLVED",
        "PRODUCT_SELECTION_UNRESOLVED",
      ])
      .default("NONE"),
    longRunning: z.boolean().default(false),
    userRequest: z
      .enum(["NONE", "SUGGEST_CHANGE", "INTERRUPT_AND_CHANGE"])
      .default("NONE"),
    permissionRequired: z.boolean().default(false),
    budgetRequiresApproval: z.boolean().default(false),
    terminalGap: z
      .enum(["NONE", "DATA_GAP", "COVERAGE_GAP", "CAPABILITY_GAP"])
      .default("NONE"),
    occurredAt: z.iso.datetime(),
  })
  .strict();

export type ObserverPolicyInput = z.infer<typeof observerPolicyInputSchema>;
export type ObserverPolicyDecision = {
  readonly schemaVersion: "sacs-observer-policy-decision/1.0";
  readonly analysisId: string;
  readonly revisionId: string;
  readonly nodeId: string;
  readonly observerPolicyHash: string;
  readonly inputSummaryHash: string;
  readonly decision:
    "AUTO_CONTINUE" | "NOTIFY_ONLY" | "QUEUE_REVISION" | "INTERRUPT_REQUIRED";
  readonly reasonCode: string;
  readonly interruptType?:
    "AMBIGUITY" | "PERMISSION" | "HIGH_RISK" | "BUDGET" | "USER_REQUESTED";
  readonly occurredAt: string;
};

export function decideObserverPolicy(
  rawInput: ObserverPolicyInput,
): ObserverPolicyDecision {
  const input = observerPolicyInputSchema.parse(rawInput);
  const base = {
    schemaVersion: "sacs-observer-policy-decision/1.0" as const,
    analysisId: input.analysisId,
    revisionId: input.revisionId,
    nodeId: input.nodeId,
    observerPolicyHash: OBSERVER_FIRST_POLICY_HASH,
    inputSummaryHash: hashCanonicalJson(input),
    occurredAt: input.occurredAt,
  };

  if (input.userRequest === "INTERRUPT_AND_CHANGE") {
    return {
      ...base,
      decision: "INTERRUPT_REQUIRED",
      reasonCode: "USER_INTERRUPT",
      interruptType: "USER_REQUESTED",
    };
  }
  if (input.riskLevel === "CONTROLLED" || input.riskLevel === "IRREVERSIBLE") {
    return {
      ...base,
      decision: "INTERRUPT_REQUIRED",
      reasonCode: "HIGH_RISK",
      interruptType: "HIGH_RISK",
    };
  }
  if (input.permissionRequired) {
    return {
      ...base,
      decision: "INTERRUPT_REQUIRED",
      reasonCode: "PERMISSION",
      interruptType: "PERMISSION",
    };
  }
  if (input.budgetRequiresApproval) {
    return {
      ...base,
      decision: "INTERRUPT_REQUIRED",
      reasonCode: "BUDGET",
      interruptType: "BUDGET",
    };
  }
  if (
    input.ambiguity === "AFFECTS_OUTCOME_UNRESOLVED" ||
    input.ambiguity === "PRODUCT_SELECTION_UNRESOLVED"
  ) {
    return {
      ...base,
      decision: "INTERRUPT_REQUIRED",
      reasonCode:
        input.ambiguity === "AFFECTS_OUTCOME_UNRESOLVED"
          ? "REFERENCE_AMBIGUITY"
          : "PRODUCT_AMBIGUITY",
      interruptType: "AMBIGUITY",
    };
  }
  if (input.terminalGap !== "NONE") {
    return {
      ...base,
      decision: "AUTO_CONTINUE",
      reasonCode: input.terminalGap,
    };
  }
  if (input.userRequest === "SUGGEST_CHANGE") {
    return {
      ...base,
      decision: "QUEUE_REVISION",
      reasonCode: "USER_SUGGEST",
    };
  }
  if (input.longRunning) {
    return {
      ...base,
      decision: "NOTIFY_ONLY",
      reasonCode: "READ_ONLY_LONG",
    };
  }
  return {
    ...base,
    decision: "AUTO_CONTINUE",
    reasonCode: "READ_ONLY_CLEAR",
  };
}
