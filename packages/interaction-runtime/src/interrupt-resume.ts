import { createHash } from "node:crypto";

import {
  parseAgUiResumeEntry,
  type ResumeEntry,
  type RunAgentInput,
} from "../../ag-ui-api-contract/src/index.js";
import {
  InteractionEventFactory,
  safePublicText,
  type PublicJsonValue,
  type SdarInteractionEvent,
} from "../../interaction-contract/src/index.js";
import {
  hashJson,
  type InteractionPersistenceRepository,
  type InterruptBinding,
  type InterruptInternalPhase,
  type InterruptReason,
  type JsonValue,
} from "../../persistence/src/index.js";
import {
  followUpActionValues,
  type NormalizedSendResult,
  type NormalizedTask,
  type SdarA2aClient,
  type SdarFollowUpAction,
} from "../../sdar-a2a-adapter/src/index.js";
import { A2aInteractionMapper } from "./a2a-mapper.js";

export type InterruptResumeRepository = Pick<
  InteractionPersistenceRepository,
  | "createInterrupt"
  | "findInterrupt"
  | "findOpenInterruptForTask"
  | "findAuthorizedTask"
  | "claimInterruptResolution"
  | "completeInterruptResolution"
  | "cancelInterrupt"
>;

const DEFAULT_INTERRUPT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_RESUME_PAYLOAD_CHARACTERS = 65_536;

const phaseContracts: Readonly<
  Record<
    InterruptInternalPhase,
    {
      readonly reason: InterruptReason;
      readonly actions: readonly SdarFollowUpAction[];
    }
  >
> = {
  awaiting_plan_confirmation: {
    reason: "sdar.plan_confirmation",
    actions: ["confirm_plan", "reject_plan", "revise_plan", "patch_goal"],
  },
  awaiting_user_input: {
    reason: "sdar.input_required",
    actions: ["provide_input"],
  },
  paused: {
    reason: "sdar.paused",
    actions: ["resume", "cancel_goal"],
  },
};

export type InterruptResumeResult =
  | {
      readonly kind: "resolved";
      readonly interrupt: InterruptBinding;
      readonly result: NormalizedSendResult;
    }
  | {
      readonly kind: "replay" | "cancelled";
      readonly interrupt: InterruptBinding;
    };

export class InterruptResumeError extends Error {
  constructor(
    readonly code:
      | "interrupt_not_found"
      | "interrupt_conflict"
      | "interrupt_in_progress"
      | "interrupt_expired"
      | "invalid_resume"
      | "unauthorized_task",
    message: string,
  ) {
    super(message);
    this.name = "InterruptResumeError";
  }
}

export class InterruptResumeService {
  private readonly now: () => Date;
  private readonly interruptTtlMs: number;

  constructor(
    private readonly options: {
      readonly repository: InterruptResumeRepository;
      readonly getClient: () => Promise<SdarA2aClient>;
      readonly now?: () => Date;
      readonly interruptTtlMs?: number;
    },
  ) {
    this.now = options.now ?? (() => new Date());
    this.interruptTtlMs = options.interruptTtlMs ?? DEFAULT_INTERRUPT_TTL_MS;
  }

  async persistInputRequired(input: {
    readonly event: SdarInteractionEvent;
    readonly principalId: string;
  }): Promise<InterruptBinding> {
    const { event } = input;
    if (event.eventType !== "input.required") {
      throw new InterruptResumeError(
        "invalid_resume",
        "Only input.required can create an AG-UI interrupt binding.",
      );
    }
    const taskId = requiredIdentity(event.taskId, "Task");
    const contextId = requiredIdentity(event.contextId, "Context");
    const internalPhase = parseInternalPhase(event.payload.internalPhase);
    const contract = phaseContracts[internalPhase];
    const inputRequestId = optionalString(event.payload.inputRequestId, 1_024);
    if (
      internalPhase === "awaiting_user_input" &&
      inputRequestId === undefined
    ) {
      throw new InterruptResumeError(
        "invalid_resume",
        "awaiting_user_input requires the exact published inputRequestId.",
      );
    }
    const responseSchema = optionalPublicJson(event.payload.responseSchema);
    const taskBinding = await this.options.repository.findAuthorizedTask({
      principalId: input.principalId,
      threadId: event.threadId,
      sdarTaskId: taskId,
    });
    if (taskBinding === undefined || taskBinding.sdarContextId !== contextId) {
      throw new InterruptResumeError(
        "unauthorized_task",
        "The INPUT_REQUIRED Task binding is not authorized.",
      );
    }
    const existing = await this.options.repository.findOpenInterruptForTask({
      principalId: input.principalId,
      threadId: event.threadId,
      taskId,
    });
    if (existing !== undefined) {
      if (
        existing.runId !== event.runId ||
        existing.contextId !== contextId ||
        existing.internalPhase !== internalPhase ||
        existing.inputRequestId !== inputRequestId ||
        existing.responseSchemaHash !== schemaHash(responseSchema)
      ) {
        throw new InterruptResumeError(
          "interrupt_conflict",
          "An incompatible open interrupt already exists for this Task.",
        );
      }
      return existing;
    }
    const expiresAt = new Date(
      this.now().getTime() + this.interruptTtlMs,
    ).toISOString();
    return this.options.repository.createInterrupt({
      interruptId: interruptIdFor(event.runId),
      runId: event.runId,
      principalId: input.principalId,
      threadId: event.threadId,
      taskId,
      contextId,
      internalPhase,
      reason: contract.reason,
      ...(inputRequestId === undefined ? {} : { inputRequestId }),
      ...(responseSchema === undefined ? {} : { responseSchema }),
      ...(schemaHash(responseSchema) === undefined
        ? {}
        : { responseSchemaHash: schemaHash(responseSchema) }),
      expiresAt,
    });
  }

  async resolveRunInput(input: {
    readonly runInput: RunAgentInput;
    readonly principalId: string;
    readonly threadId: string;
    readonly signal?: AbortSignal;
  }): Promise<InterruptResumeResult> {
    const entries = input.runInput.resume ?? [];
    if (entries.length !== 1) {
      throw new InterruptResumeError(
        "invalid_resume",
        "This single-SDAR profile requires one complete ResumeEntry.",
      );
    }
    return this.resolve({
      entry: parseAgUiResumeEntry(entries[0]),
      principalId: input.principalId,
      threadId: input.threadId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  }

  async resolve(input: {
    readonly entry: unknown;
    readonly principalId: string;
    readonly threadId: string;
    readonly signal?: AbortSignal;
  }): Promise<InterruptResumeResult> {
    const entry = parseAgUiResumeEntry(input.entry);
    const interrupt = await this.options.repository.findInterrupt({
      interruptId: entry.interruptId,
      principalId: input.principalId,
      threadId: input.threadId,
    });
    if (interrupt === undefined) {
      throw new InterruptResumeError(
        "interrupt_not_found",
        "The interrupt is not open for this principal and thread.",
      );
    }
    const binding = await this.options.repository.findAuthorizedTask({
      principalId: input.principalId,
      threadId: input.threadId,
      sdarTaskId: interrupt.taskId,
    });
    if (
      binding === undefined ||
      binding.sdarContextId !== interrupt.contextId
    ) {
      throw new InterruptResumeError(
        "unauthorized_task",
        "The interrupt Task binding is not authorized.",
      );
    }

    if (entry.status === "cancelled") {
      const resolutionHash = hashJson({
        interruptId: entry.interruptId,
        status: entry.status,
      });
      const claim = await this.options.repository.cancelInterrupt({
        interruptId: interrupt.interruptId,
        principalId: input.principalId,
        threadId: input.threadId,
        taskId: interrupt.taskId,
        contextId: interrupt.contextId,
        resolutionHash,
      });
      if (claim.outcome === "acquired") {
        return { kind: "cancelled", interrupt: claim.interrupt };
      }
      if (claim.outcome === "replay") {
        return { kind: "replay", interrupt: claim.interrupt };
      }
      throw claimError(claim.outcome);
    }

    const payload = parseResolutionPayload(entry, interrupt);
    const client = await this.options.getClient();
    const currentTask = await client.getTask(interrupt.taskId, {
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    assertCurrentInterruptTask(currentTask, interrupt);
    const resolutionHash = hashJson({
      interruptId: entry.interruptId,
      status: entry.status,
      payload: toPublicJson(payload) as JsonValue,
    });
    const claim = await this.options.repository.claimInterruptResolution({
      interruptId: interrupt.interruptId,
      principalId: input.principalId,
      threadId: input.threadId,
      taskId: interrupt.taskId,
      contextId: interrupt.contextId,
      resolutionHash,
    });
    if (claim.outcome === "replay") {
      return { kind: "replay", interrupt: claim.interrupt };
    }
    if (claim.outcome !== "acquired") throw claimError(claim.outcome);

    const result = await client.sendFollowUp(
      {
        messageId: stableResumeMessageId(interrupt.interruptId, resolutionHash),
        taskId: interrupt.taskId,
        contextId: interrupt.contextId,
        action: payload.action,
        text: payload.text,
        ...(interrupt.inputRequestId === undefined
          ? {}
          : { inputRequestId: interrupt.inputRequestId }),
        ...(payload.data === undefined ? {} : { data: payload.data }),
      },
      input.signal === undefined ? undefined : { signal: input.signal },
    );
    assertResultIdentity(result, interrupt);
    const resolved = await this.options.repository.completeInterruptResolution({
      interruptId: interrupt.interruptId,
      principalId: input.principalId,
      resolutionHash,
    });
    return { kind: "resolved", interrupt: resolved, result };
  }
}

export async function* resumeRunToInteractionEvents(input: {
  readonly service: InterruptResumeService;
  readonly runInput: RunAgentInput;
  readonly principalId: string;
  readonly threadId: string;
  readonly signal?: AbortSignal;
}): AsyncGenerator<SdarInteractionEvent> {
  const factory = new InteractionEventFactory({
    runId: input.runInput.runId,
    threadId: input.threadId,
  });
  const started = factory.create("run.started", {
    boundary: "bounded_resume",
  });
  if (started !== undefined) yield started;
  try {
    const resolution = await input.service.resolveRunInput({
      runInput: input.runInput,
      principalId: input.principalId,
      threadId: input.threadId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (resolution.kind === "resolved") {
      const mapper = new A2aInteractionMapper(factory);
      for (const event of mapper.mapStreamEvent(resolution.result)) yield event;
    } else {
      const text = factory.publicText(
        resolution.kind === "cancelled"
          ? "The AG-UI interrupt was cancelled locally. The SDAR Task was not cancelled."
          : "This interrupt resolution was already applied; no duplicate Follow-up was sent.",
      );
      if (text !== undefined) yield text;
    }
    const finished = factory.create("run.finished", {
      reason: "resume_observation_complete",
      taskTerminal: false,
    });
    if (finished !== undefined) yield finished;
  } catch (error) {
    const failed = factory.create("run.error", {
      message:
        error instanceof InterruptResumeError
          ? (safePublicText(error.message, 512) ??
            "The Resume request failed safely.")
          : "The Resume request failed safely.",
      code:
        error instanceof InterruptResumeError
          ? error.code
          : "interrupt_resume_error",
    });
    if (failed !== undefined) yield failed;
  }
}

export async function* persistInterruptsBeforeRunFinish(
  events: AsyncIterable<SdarInteractionEvent>,
  input: {
    readonly service: InterruptResumeService;
    readonly principalId: string;
  },
): AsyncGenerator<SdarInteractionEvent> {
  for await (const event of events) {
    if (event.eventType === "input.required") {
      const interrupt = await input.service.persistInputRequired({
        event,
        principalId: input.principalId,
      });
      yield {
        ...event,
        payload: {
          ...event.payload,
          expiresAt: interrupt.expiresAt,
          ...(interrupt.responseSchema === undefined
            ? {}
            : { responseSchema: interrupt.responseSchema }),
        },
      };
      continue;
    }
    yield event;
  }
}

export function interruptIdFor(runId: string): string {
  return `${runId}:input-required`;
}

export function interruptReasonForPhase(
  phase: InterruptInternalPhase,
): InterruptReason {
  return phaseContracts[phase].reason;
}

interface ResolutionPayload {
  readonly action: SdarFollowUpAction;
  readonly text: string;
  readonly data?: JsonValue;
  readonly inputRequestId?: string;
}

function parseResolutionPayload(
  entry: ResumeEntry,
  interrupt: InterruptBinding,
): ResolutionPayload {
  const raw = entry.payload;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InterruptResumeError(
      "invalid_resume",
      "Resolved ResumeEntry payload must be an object.",
    );
  }
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some(
      (key) => !["action", "text", "data", "inputRequestId"].includes(key),
    )
  ) {
    throw new InterruptResumeError(
      "invalid_resume",
      "ResumeEntry payload contains an unsupported field.",
    );
  }
  const action = parseAction(record.action);
  if (!phaseContracts[interrupt.internalPhase].actions.includes(action)) {
    throw new InterruptResumeError(
      "invalid_resume",
      "The requested action is not allowed for this interrupt phase.",
    );
  }
  const inputRequestId = optionalString(record.inputRequestId, 1_024);
  if (interrupt.inputRequestId !== inputRequestId) {
    throw new InterruptResumeError(
      "invalid_resume",
      "ResumeEntry inputRequestId does not match the published interrupt.",
    );
  }
  const text = optionalBoundedText(record.text);
  const data = optionalJson(record.data);
  if (action !== "provide_input" && data !== undefined) {
    throw new InterruptResumeError(
      "invalid_resume",
      "Structured data is allowed only for provide_input.",
    );
  }
  if (
    ["provide_input", "revise_plan", "patch_goal"].includes(action) &&
    text === undefined &&
    data === undefined
  ) {
    throw new InterruptResumeError(
      "invalid_resume",
      `${action} requires published text or structured data.`,
    );
  }
  const normalized: ResolutionPayload = {
    action,
    text: text ?? `AG-UI explicitly resolved the interrupt with ${action}.`,
    ...(data === undefined ? {} : { data }),
    ...(inputRequestId === undefined ? {} : { inputRequestId }),
  };
  if (interrupt.responseSchema !== undefined) {
    assertPublicSchema(interrupt.responseSchema, toPublicJson(raw));
  }
  return normalized;
}

function parseAction(value: unknown): SdarFollowUpAction {
  if (
    typeof value !== "string" ||
    !followUpActionValues.includes(value as SdarFollowUpAction)
  ) {
    throw new InterruptResumeError(
      "invalid_resume",
      "ResumeEntry action is missing or unsupported.",
    );
  }
  return value as SdarFollowUpAction;
}

function parseInternalPhase(
  value: PublicJsonValue | undefined,
): InterruptInternalPhase {
  if (
    value === "awaiting_plan_confirmation" ||
    value === "awaiting_user_input" ||
    value === "paused"
  ) {
    return value;
  }
  throw new InterruptResumeError(
    "invalid_resume",
    "INPUT_REQUIRED has no supported published internalPhase.",
  );
}

function claimError(
  outcome: "in_progress" | "conflict" | "expired" | "cancelled" | "not_found",
): InterruptResumeError {
  if (outcome === "in_progress") {
    return new InterruptResumeError(
      "interrupt_in_progress",
      "This interrupt resolution is already in progress.",
    );
  }
  if (outcome === "expired") {
    return new InterruptResumeError(
      "interrupt_expired",
      "This interrupt has expired.",
    );
  }
  if (outcome === "not_found") {
    return new InterruptResumeError(
      "interrupt_not_found",
      "The interrupt is not authorized.",
    );
  }
  return new InterruptResumeError(
    "interrupt_conflict",
    outcome === "cancelled"
      ? "This interrupt was already cancelled."
      : "This interrupt was resolved with different content.",
  );
}

function assertCurrentInterruptTask(
  task: NormalizedTask,
  interrupt: InterruptBinding,
): void {
  if (
    task.taskId !== interrupt.taskId ||
    task.contextId !== interrupt.contextId
  ) {
    throw new InterruptResumeError(
      "unauthorized_task",
      "SDAR returned a mismatched Task identity during Resume validation.",
    );
  }
  if (
    task.state !== "INPUT_REQUIRED" ||
    task.internalPhase !== interrupt.internalPhase ||
    task.inputRequestId !== interrupt.inputRequestId
  ) {
    throw new InterruptResumeError(
      "interrupt_conflict",
      "The durable interrupt no longer matches the current SDAR Task phase.",
    );
  }
}

function assertResultIdentity(
  result: NormalizedSendResult,
  interrupt: InterruptBinding,
): void {
  if (result.kind === "task") {
    if (
      result.task.taskId !== interrupt.taskId ||
      result.task.contextId !== interrupt.contextId
    ) {
      throw new Error("SDAR Follow-up returned a mismatched Task identity");
    }
    return;
  }
  if (
    (result.message.taskId !== undefined &&
      result.message.taskId !== interrupt.taskId) ||
    (result.message.contextId !== undefined &&
      result.message.contextId !== interrupt.contextId)
  ) {
    throw new Error("SDAR Follow-up Message changed Task identity");
  }
}

function stableResumeMessageId(
  interruptId: string,
  resolutionHash: string,
): string {
  return `resume-${createHash("sha256")
    .update(`${interruptId}:${resolutionHash}`, "utf8")
    .digest("hex")
    .slice(0, 48)}`;
}

function schemaHash(value: JsonValue | undefined): string | undefined {
  return value === undefined ? undefined : hashJson(value);
}

function requiredIdentity(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0 || value.length > 256) {
    throw new InterruptResumeError(
      "invalid_resume",
      `${label} identity is missing or invalid.`,
    );
  }
  return value;
}

function optionalString(value: unknown, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    throw new InterruptResumeError(
      "invalid_resume",
      "ResumeEntry string field is invalid.",
    );
  }
  return value;
}

function optionalBoundedText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length > MAX_RESUME_PAYLOAD_CHARACTERS
  ) {
    throw new InterruptResumeError(
      "invalid_resume",
      "ResumeEntry text is invalid or oversized.",
    );
  }
  const normalized = [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        (codePoint >= 32 || [9, 10, 13].includes(codePoint)) &&
        codePoint !== 127
      );
    })
    .join("")
    .trim();
  return normalized.length === 0 ? undefined : normalized;
}

function optionalJson(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  const converted = toPublicJson(value) as JsonValue;
  if (JSON.stringify(converted).length > MAX_RESUME_PAYLOAD_CHARACTERS) {
    throw new InterruptResumeError(
      "invalid_resume",
      "ResumeEntry structured data is oversized.",
    );
  }
  return converted;
}

function optionalPublicJson(
  value: PublicJsonValue | undefined,
): JsonValue | undefined {
  return value === undefined ? undefined : (value as JsonValue);
}

function toPublicJson(value: unknown): PublicJsonValue {
  try {
    const rendered = JSON.stringify(value);
    if (rendered === undefined) throw new Error("not JSON");
    return JSON.parse(rendered) as PublicJsonValue;
  } catch {
    throw new InterruptResumeError(
      "invalid_resume",
      "ResumeEntry payload must be bounded JSON.",
    );
  }
}

function assertPublicSchema(schema: JsonValue, value: PublicJsonValue): void {
  if (schema === null || Array.isArray(schema) || typeof schema !== "object") {
    throw new InterruptResumeError(
      "invalid_resume",
      "Published response schema is invalid.",
    );
  }
  validateSchemaNode(schema, value, "$resume");
}

function validateSchemaNode(
  schema: Readonly<Record<string, JsonValue>>,
  value: PublicJsonValue,
  path: string,
): void {
  const allowedKeywords = new Set([
    "$schema",
    "$id",
    "title",
    "description",
    "type",
    "enum",
    "required",
    "properties",
    "additionalProperties",
    "items",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
  ]);
  if (Object.keys(schema).some((key) => !allowedKeywords.has(key))) {
    throw new InterruptResumeError(
      "invalid_resume",
      "Published response schema uses an unsupported keyword.",
    );
  }
  const enumValues = schema.enum;
  if (
    Array.isArray(enumValues) &&
    !enumValues.some(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(value),
    )
  ) {
    schemaFailure(path);
  }
  const type = schema.type;
  if (typeof type === "string" && !matchesType(type, value))
    schemaFailure(path);
  if (typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      schemaFailure(path);
    }
    if (
      typeof schema.maxLength === "number" &&
      value.length > schema.maxLength
    ) {
      schemaFailure(path);
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum)
      schemaFailure(path);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      schemaFailure(path);
  }
  if (Array.isArray(value)) {
    const items = schema.items;
    if (items !== undefined) {
      const itemSchema = schemaObject(items);
      value.forEach((item, index) =>
        validateSchemaNode(itemSchema, item, `${path}[${index}]`),
      );
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties =
      schema.properties === undefined ? {} : schemaObject(schema.properties);
    const required = Array.isArray(schema.required)
      ? schema.required.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    if (required.some((key) => !(key in value))) schemaFailure(path);
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some((key) => !(key in properties))
    ) {
      schemaFailure(path);
    }
    for (const [key, item] of Object.entries(value)) {
      const child = properties[key];
      if (child !== undefined) {
        validateSchemaNode(schemaObject(child), item, `${path}.${key}`);
      }
    }
  }
}

function schemaObject(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new InterruptResumeError(
      "invalid_resume",
      "Published response schema contains an invalid object.",
    );
  }
  return value;
}

function matchesType(type: string, value: PublicJsonValue): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer")
    return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}

function schemaFailure(path: string): never {
  throw new InterruptResumeError(
    "invalid_resume",
    `ResumeEntry payload does not match the published schema at ${path}.`,
  );
}
