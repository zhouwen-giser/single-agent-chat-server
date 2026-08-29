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
