import { createHash } from "node:crypto";

import { z } from "zod";

import {
  parseConversationWorldFocus,
  type ConversationWorldFocus,
} from "../../conversation-world-focus/src/index.js";
import type {
  JsonValue,
  NormalizedTask,
} from "../../sdar-a2a-adapter/src/index.js";
import {
  externalCorrelationHintSchema,
  externalPredicateCapsuleSchema,
  type ExternalCorrelationHint,
  type ExternalPredicateCapsule,
  type WsgsGroundingResult,
} from "../../wsgs-http-adapter/src/index.js";

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const taskStateSchema = z.enum([
  "SUBMITTED",
  "WORKING",
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "INPUT_REQUIRED",
  "REJECTED",
]);

const fusionEvaluationSchema = z.enum([
  "SATISFIED",
  "VIOLATED",
  "UNKNOWN",
  "NOT_COMPARABLE",
]);

const fusionCheckSchema = z.strictObject({
  checkId: identifier,
  type: z.enum([
    "TASK_CORRELATION",
    "ACTIVITY_STATE",
    "OUTCOME_VERIFICATION",
    "PLAN_PREDICATE",
  ]),
  required: z.boolean(),
  expected: z.string().max(2_000).optional(),
  observed: z.string().max(2_000).optional(),
  evaluation: fusionEvaluationSchema,
  reasonCode: z.string().max(128).optional(),
  evidenceItemIds: z.array(identifier).max(128),
});

export const authorityFusionResultV2Schema = z.strictObject({
  schemaVersion: z.literal("2.0"),
  task: z.strictObject({
    authority: z.literal("SDAR"),
    taskId: identifier,
    state: z.string().min(1).max(128),
    internalPhase: z.string().max(128).optional(),
    observedAt: z.iso.datetime(),
  }),
  reality: z.strictObject({
    authority: z.literal("GOWM"),
    groundingId: identifier,
    resultHash: sha256,
    worldVersion: z.number().int().nonnegative().optional(),
    observedAt: z.iso.datetime(),
  }),
  checks: z.array(fusionCheckSchema).max(128),
  overall: z.enum(["CONSISTENT", "INCONSISTENT", "UNKNOWN", "NOT_COMPARABLE"]),
  unknowns: z.array(z.string().max(2_000)).max(128),
});

const predicateEvaluationPayloadSchema = z
  .object({
    predicateId: z.string().min(1),
    status: z.enum([
      "SUPPORTED",
      "NOT_SUPPORTED",
      "PARTIALLY_SUPPORTED",
      "INDETERMINATE",
      "NO_DATA",
      "CONFLICTING",
    ]),
    evaluatedAtWorldVersion: z.number().int().nonnegative(),
  })
  .passthrough();

const correlationFindingPayloadSchema = z
  .object({
    externalAuthority: z.string().min(1),
    externalValue: z.string().min(1),
    relation: z.enum([
      "REPORTS_EXECUTION_OF",
      "REALIZES",
      "PARTIALLY_REALIZES",
      "POSSIBLY_CORRESPONDS_TO",
      "NO_MATCH_FOUND",
      "CONFLICTING_MATCHES",
    ]),
    worldVersion: z.number().int().nonnegative(),
  })
  .passthrough();

export const sdarTaskObservationV2Schema = z.strictObject({
  schemaVersion: z.literal("2.0"),
  taskId: identifier,
  taskState: taskStateSchema,
  internalPhase: z.string().max(128).optional(),
  phaseMessage: z.string().max(8_000).optional(),
  observedAt: z.iso.datetime(),
  correlation: z.strictObject({
    system: z.literal("SDAR"),
    externalTaskId: identifier,
    contextId: identifier.optional(),
  }),
  publishedStructuredPlan: z.json().optional(),
});

export const planRealityRequirementsSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  taskId: identifier,
  taskSnapshotHash: sha256,
  correlationHints: z.array(externalCorrelationHintSchema).max(32),
  predicates: z.array(externalPredicateCapsuleSchema).max(32),
  comparability: z.enum([
    "COMPARABLE",
    "PARTIALLY_COMPARABLE",
    "NOT_COMPARABLE",
  ]),
  reasonCodes: z.array(z.string().min(1).max(128)).max(32).optional(),
});

const publishedStructuredPlanSchema = z
  .object({
    predicates: z.array(externalPredicateCapsuleSchema).max(32),
  })
  .passthrough();

export type SdarTaskObservationV2 = z.infer<typeof sdarTaskObservationV2Schema>;
export type PlanRealityRequirements = z.infer<
  typeof planRealityRequirementsSchema
>;
export type AuthorityFusionResultV2 = z.infer<
  typeof authorityFusionResultV2Schema
>;
export type AuthorityFusionCheck = z.infer<typeof fusionCheckSchema>;

export class SdarTaskObservationAssembler {
  private readonly now: () => Date;

  constructor(options: { readonly now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  assemble(task: NormalizedTask): SdarTaskObservationV2 {
    return parseSdarTaskObservationV2({
      schemaVersion: "2.0",
      taskId: task.taskId,
      taskState: task.state,
      ...(task.internalPhase === undefined
        ? {}
        : { internalPhase: task.internalPhase }),
      ...(task.phaseMessage === undefined
        ? {}
        : { phaseMessage: task.phaseMessage }),
      observedAt: task.statusTimestamp ?? this.now().toISOString(),
      correlation: {
        system: "SDAR",
        externalTaskId: task.taskId,
        contextId: task.contextId,
      },
      ...(task.publishedStructuredPlan === undefined
        ? {}
        : { publishedStructuredPlan: task.publishedStructuredPlan }),
    });
  }
}

export class PlanRealityRequirementCompiler {
  compile(
    taskValue: SdarTaskObservationV2,
    focusValue: ConversationWorldFocus,
  ): PlanRealityRequirements {
    const task = parseSdarTaskObservationV2(taskValue);
    parseConversationWorldFocus(focusValue);
    const compiled = compilePublishedPredicates(task.publishedStructuredPlan);
    return parsePlanRealityRequirements({
      schemaVersion: "1.0",
      taskId: task.taskId,
      taskSnapshotHash: hashTaskSnapshot(task),
      correlationHints: correlationHints(task),
      predicates: compiled.predicates,
      comparability:
        compiled.predicates.length === 0 ? "NOT_COMPARABLE" : "COMPARABLE",
      ...(compiled.reasonCode === undefined
        ? {}
        : { reasonCodes: [compiled.reasonCode] }),
    });
  }
}

export function parseSdarTaskObservationV2(
  value: unknown,
): SdarTaskObservationV2 {
  return sdarTaskObservationV2Schema.parse(value);
}

export function parsePlanRealityRequirements(
  value: unknown,
): PlanRealityRequirements {
  return planRealityRequirementsSchema.parse(value);
}

export function parseAuthorityFusionResultV2(
  value: unknown,
): AuthorityFusionResultV2 {
  return authorityFusionResultV2Schema.parse(value);
}

export function hashPlanRealityRequirements(
  value: PlanRealityRequirements,
): string {
  return "sha256:" + hashJsonValue(parsePlanRealityRequirements(value));
}

export class AuthorityFusionEvaluator {
  private readonly now: () => Date;

  constructor(options: { readonly now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  evaluate(input: {
    readonly task: SdarTaskObservationV2;
    readonly requirements: PlanRealityRequirements;
    readonly grounding: WsgsGroundingResult;
  }): AuthorityFusionResultV2 {
    const task = parseSdarTaskObservationV2(input.task);
    const requirements = parsePlanRealityRequirements(input.requirements);
    const grounding = input.grounding;
    if (requirements.taskId !== task.taskId) {
      throw new Error("Fusion task and requirement identities do not match");
    }

    const checks = this.evaluateChecks(task, requirements, grounding);
    const worldVersions = grounding.evidenceItems.flatMap((item) => {
      const predicate = predicateEvaluationPayloadSchema.safeParse(
        item.safePayload,
      );
      if (predicate.success) return [predicate.data.evaluatedAtWorldVersion];
      const correlation = correlationFindingPayloadSchema.safeParse(
        item.safePayload,
      );
      return correlation.success ? [correlation.data.worldVersion] : [];
    });
    const unknowns = [
      ...new Set(
        checks
          .filter(
            (check) =>
              check.evaluation === "UNKNOWN" ||
              check.evaluation === "NOT_COMPARABLE",
          )
          .map((check) => check.reasonCode ?? "UNSPECIFIED_FUSION_UNKNOWN"),
      ),
    ];

    return parseAuthorityFusionResultV2({
      schemaVersion: "2.0",
      task: {
        authority: "SDAR",
        taskId: task.taskId,
        state: task.taskState,
        ...(task.internalPhase === undefined
          ? {}
          : { internalPhase: task.internalPhase }),
        observedAt: task.observedAt,
      },
      reality: {
        authority: "GOWM",
        groundingId: grounding.groundingId,
        resultHash: grounding.resultHash,
        ...(worldVersions.length === 0
          ? {}
          : { worldVersion: Math.max(...worldVersions) }),
        observedAt: this.now().toISOString(),
      },
      checks,
      overall: calculateOverall(checks),
      unknowns,
    });
  }

  private evaluateChecks(
    task: SdarTaskObservationV2,
    requirements: PlanRealityRequirements,
    grounding: WsgsGroundingResult,
  ): readonly AuthorityFusionCheck[] {
    if (requirements.comparability === "NOT_COMPARABLE") {
      return [
        fusionCheckSchema.parse({
          checkId: deterministicIdentifier("plan-comparability", task.taskId),
          type: "PLAN_PREDICATE",
          required: true,
          evaluation: "NOT_COMPARABLE",
          reasonCode:
            requirements.reasonCodes?.[0] ?? "NO_STRUCTURED_REQUIREMENTS",
          evidenceItemIds: [],
        }),
      ];
    }

    return [
      ...requirements.correlationHints.map((hint) =>
        evaluateCorrelation(task, hint, grounding),
      ),
      ...requirements.predicates.map((predicate) =>
        evaluatePredicate(task, predicate, grounding),
      ),
    ];
  }
}

export class AuthorityFusionRenderer {
  render(value: AuthorityFusionResultV2): string {
    const result = parseAuthorityFusionResultV2(value);
    const counts = new Map<string, number>();
    for (const check of result.checks) {
      counts.set(check.evaluation, (counts.get(check.evaluation) ?? 0) + 1);
    }
    const summary = result.checks
      .map((check) => `${check.checkId}:${check.evaluation}`)
      .join(", ");
    return (
      `Authority fusion ${result.overall}. ` +
      `Checks satisfied=${counts.get("SATISFIED") ?? 0}, ` +
      `violated=${counts.get("VIOLATED") ?? 0}, ` +
      `unknown=${counts.get("UNKNOWN") ?? 0}, ` +
      `not-comparable=${counts.get("NOT_COMPARABLE") ?? 0}. ` +
      summary
    ).slice(0, 4_000);
  }
}

export function calculateOverall(
  checks: readonly AuthorityFusionCheck[],
): AuthorityFusionResultV2["overall"] {
  const required = checks.filter((check) => check.required);
  if (required.some((check) => check.evaluation === "VIOLATED")) {
    return "INCONSISTENT";
  }
  if (
    required.length === 0 ||
    required.every((check) => check.evaluation === "NOT_COMPARABLE")
  ) {
    return "NOT_COMPARABLE";
  }
  if (required.every((check) => check.evaluation === "SATISFIED")) {
    return "CONSISTENT";
  }
  return "UNKNOWN";
}

function evaluateCorrelation(
  task: SdarTaskObservationV2,
  hint: ExternalCorrelationHint,
  grounding: WsgsGroundingResult,
): AuthorityFusionCheck {
  const matching: Array<{
    readonly item: WsgsGroundingResult["evidenceItems"][number];
    readonly payload?: z.infer<typeof correlationFindingPayloadSchema>;
    readonly noData?: true;
  }> = [];
  for (const item of grounding.evidenceItems) {
    if (
      item.productKind !== "CORRELATION_FINDING" ||
      item.payloadSchemaUri !== "urn:gowm:v0.4:correlation-finding"
    ) {
      continue;
    }
    if (item.upstreamStatus === "NO_DATA") {
      matching.push({ item, noData: true });
      continue;
    }
    const payload = correlationFindingPayloadSchema.safeParse(item.safePayload);
    if (
      payload.success &&
      payload.data.externalAuthority === hint.externalAuthority &&
      payload.data.externalValue === hint.value
    ) {
      matching.push({ item, payload: payload.data });
    }
  }
  const required = hint.kind === "EXTERNAL_TASK";
  const base = {
    checkId: deterministicIdentifier("task-correlation", hint.hintId),
    type: "TASK_CORRELATION" as const,
    required,
    expected: hint.kind + ":" + hint.value,
    evidenceItemIds: matching.map(({ item }) => item.evidenceProductId),
  };
  const positive = matching.find(
    (match) =>
      match.payload !== undefined &&
      ["REPORTS_EXECUTION_OF", "REALIZES"].includes(match.payload.relation),
  );
  if (positive?.payload !== undefined) {
    return fusionCheckSchema.parse({
      ...base,
      observed: positive.payload.relation,
      evaluation: "SATISFIED",
    });
  }
  const negative = matching.find(
    (match) => match.payload?.relation === "NO_MATCH_FOUND",
  );
  if (negative?.payload !== undefined) {
    const terminal = task.taskState === "COMPLETED";
    return fusionCheckSchema.parse({
      ...base,
      observed: negative.payload.relation,
      evaluation: terminal ? "VIOLATED" : "UNKNOWN",
      ...(!terminal ? { reasonCode: lifecycleReasonCode(task.taskState) } : {}),
    });
  }
  return fusionCheckSchema.parse({
    ...base,
    evaluation: "UNKNOWN",
    reasonCode:
      matching.length === 0
        ? "CORRELATION_FINDING_UNAVAILABLE"
        : "CORRELATION_FINDING_INDETERMINATE",
  });
}

function evaluatePredicate(
  task: SdarTaskObservationV2,
  predicate: ExternalPredicateCapsule,
  grounding: WsgsGroundingResult,
): AuthorityFusionCheck {
  const predicateId = readStringField(predicate.value, "predicateId");
  const base = {
    checkId: deterministicIdentifier(
      "plan-predicate",
      predicateId ?? hashJsonValue(predicate),
    ),
    type: "PLAN_PREDICATE" as const,
    required: true,
    expected: predicateId ?? predicate.schemaUri,
  };
  if (predicateId === undefined) {
    return fusionCheckSchema.parse({
      ...base,
      evaluation: "NOT_COMPARABLE",
      reasonCode: "PREDICATE_ID_UNAVAILABLE",
      evidenceItemIds: [],
    });
  }
  const matching = grounding.evidenceItems.flatMap((item) => {
    if (
      item.productKind !== "PREDICATE_EVALUATION" ||
      item.payloadSchemaUri !== "urn:gowm:v0.4:predicate-evaluation"
    ) {
      return [];
    }
    if (item.upstreamStatus === "NO_DATA") {
      return [{ item, status: "NO_DATA" as const }];
    }
    const payload = predicateEvaluationPayloadSchema.safeParse(
      item.safePayload,
    );
    return payload.success && payload.data.predicateId === predicateId
      ? [{ item, status: payload.data.status }]
      : [];
  });
  const evidenceItemIds = matching.map(({ item }) => item.evidenceProductId);
  const supported = matching.find((match) => match.status === "SUPPORTED");
  if (supported !== undefined) {
    return fusionCheckSchema.parse({
      ...base,
      observed: "SUPPORTED",
      evaluation: "SATISFIED",
      evidenceItemIds,
    });
  }
  const notSupported = matching.find(
    (match) => match.status === "NOT_SUPPORTED",
  );
  if (notSupported !== undefined) {
    const mayViolate = task.taskState === "COMPLETED";
    return fusionCheckSchema.parse({
      ...base,
      observed: "NOT_SUPPORTED",
      evaluation: mayViolate ? "VIOLATED" : "UNKNOWN",
      ...(!mayViolate
        ? { reasonCode: lifecycleReasonCode(task.taskState) }
        : {}),
      evidenceItemIds,
    });
  }
  return fusionCheckSchema.parse({
    ...base,
    ...(matching[0] === undefined ? {} : { observed: matching[0].status }),
    evaluation: "UNKNOWN",
    reasonCode:
      matching.length === 0
        ? "PREDICATE_EVALUATION_UNAVAILABLE"
        : "PREDICATE_EVALUATION_INDETERMINATE",
    evidenceItemIds,
  });
}

function lifecycleReasonCode(
  state: SdarTaskObservationV2["taskState"],
): string {
  if (state === "WORKING")
    return "TASK_NOT_TERMINAL_DO_NOT_PREMATURELY_VIOLATE";
  if (state === "FAILED") return "FAILED_TASK_CAUSE_NOT_INFERRED";
  if (state === "CANCELED") return "CANCELED_TASK_OBSERVATION_ONLY";
  return "TASK_STATE_NOT_ELIGIBLE_FOR_OUTCOME_VIOLATION";
}

function readStringField(value: JsonValue, field: string): string | undefined {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const fieldValue = value[field];
  return typeof fieldValue === "string" && fieldValue.length > 0
    ? fieldValue
    : undefined;
}

function correlationHints(
  task: SdarTaskObservationV2,
): readonly ExternalCorrelationHint[] {
  const values: Array<{
    readonly kind: "EXTERNAL_TASK" | "OPERATION_CORRELATION";
    readonly value: string;
  }> = [
    { kind: "EXTERNAL_TASK", value: task.correlation.externalTaskId },
    ...(task.correlation.contextId === undefined
      ? []
      : [
          {
            kind: "OPERATION_CORRELATION" as const,
            value: task.correlation.contextId,
          },
        ]),
  ];
  return values.map(({ kind, value }) =>
    externalCorrelationHintSchema.parse({
      hintId: deterministicIdentifier("sdar-correlation", kind + ":" + value),
      externalAuthority: "SDAR",
      kind,
      value,
      relationHint: "RELATED_TO",
      declarationConfidence: 1,
    }),
  );
}

function compilePublishedPredicates(value: JsonValue | undefined): {
  readonly predicates: readonly ExternalPredicateCapsule[];
  readonly reasonCode?: string;
} {
  if (value === undefined) {
    return {
      predicates: [],
      reasonCode: "PUBLISHED_STRUCTURED_PLAN_ABSENT",
    };
  }
  const parsed = publishedStructuredPlanSchema.safeParse(value);
  if (!parsed.success) {
    return {
      predicates: [],
      reasonCode: "PUBLISHED_STRUCTURED_PLAN_INVALID",
    };
  }
  if (parsed.data.predicates.length === 0) {
    return {
      predicates: [],
      reasonCode: "PUBLISHED_STRUCTURED_PREDICATES_ABSENT",
    };
  }
  return { predicates: parsed.data.predicates };
}

function hashTaskSnapshot(task: SdarTaskObservationV2): string {
  return (
    "sha256:" +
    hashJsonValue({
      schemaVersion: task.schemaVersion,
      taskId: task.taskId,
      taskState: task.taskState,
      ...(task.internalPhase === undefined
        ? {}
        : { internalPhase: task.internalPhase }),
      ...(task.phaseMessage === undefined
        ? {}
        : { phaseMessage: task.phaseMessage }),
      correlation: task.correlation,
      ...(task.publishedStructuredPlan === undefined
        ? {}
        : { publishedStructuredPlan: task.publishedStructuredPlan }),
    })
  );
}

function deterministicIdentifier(prefix: string, value: string): string {
  return prefix + "-" + hashJsonValue(value).slice(0, 32);
}

function hashJsonValue(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map(
        (key) => JSON.stringify(key) + ":" + canonicalJson(value[key] ?? null),
      )
      .join(",") +
    "}"
  );
}
