import { randomUUID } from "node:crypto";

export const interactionEventTypes = [
  "run.started",
  "task.bound",
  "task.snapshot",
  "task.status_changed",
  "message.text",
  "artifact.text",
  "artifact.data",
  "artifact.reference",
  "input.required",
  "capability.gap",
  "allowed_actions.changed",
  "observation.ended",
  "run.finished",
  "run.error",
] as const;

export type SdarInteractionEventType = (typeof interactionEventTypes)[number];

export type PublicJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PublicJsonValue[]
  | { readonly [key: string]: PublicJsonValue };

export interface SdarTaskScope {
  readonly taskId: string;
  readonly contextId: string;
}

export interface SdarInteractionEvent {
  readonly eventId: string;
  readonly eventType: SdarInteractionEventType;
  readonly occurredAt: string;
  readonly runId: string;
  readonly threadId: string;
  readonly sequence: number;
  readonly taskId?: string;
  readonly contextId?: string;
  readonly payload: Readonly<Record<string, PublicJsonValue>>;
}

export interface InteractionEventFactoryOptions {
  readonly runId: string;
  readonly threadId: string;
  readonly now?: () => Date;
  readonly nextId?: () => string;
  readonly maxTextCharacters?: number;
  readonly initialSequence?: number;
}

const taskRequiredEventTypes = new Set<SdarInteractionEventType>([
  "task.bound",
  "task.snapshot",
  "task.status_changed",
  "artifact.text",
  "artifact.data",
  "artifact.reference",
  "input.required",
  "capability.gap",
  "allowed_actions.changed",
]);

export class InteractionEventFactory {
  private sequence: number;
  private readonly dedupeKeys = new Set<string>();
  private readonly now: () => Date;
  private readonly nextId: () => string;
  private readonly maxTextCharacters: number;

  constructor(private readonly options: InteractionEventFactoryOptions) {
    if (options.runId.length === 0 || options.threadId.length === 0) {
      throw new Error("runId and threadId are required");
    }
    this.now = options.now ?? (() => new Date());
    this.nextId = options.nextId ?? randomUUID;
    this.maxTextCharacters = options.maxTextCharacters ?? 16_000;
    this.sequence = options.initialSequence ?? 0;
    if (!Number.isInteger(this.sequence) || this.sequence < 0) {
      throw new Error("initialSequence must be a non-negative integer");
    }
  }

  create(
    eventType: SdarInteractionEventType,
    payload: Readonly<Record<string, PublicJsonValue>>,
    options: {
      readonly task?: SdarTaskScope;
      readonly dedupeKey?: string;
    } = {},
  ): SdarInteractionEvent | undefined {
    if (taskRequiredEventTypes.has(eventType) && options.task === undefined) {
      throw new Error(`${eventType} requires an authorized Task scope`);
    }
    if (options.dedupeKey !== undefined) {
      if (this.dedupeKeys.has(options.dedupeKey)) return undefined;
      this.dedupeKeys.add(options.dedupeKey);
    }
    const sequence = this.sequence++;
    return {
      eventId: `${this.options.runId}:${sequence}:${this.nextId()}`,
      eventType,
      occurredAt: this.now().toISOString(),
      runId: this.options.runId,
      threadId: this.options.threadId,
      sequence,
      ...(options.task === undefined ? {} : options.task),
      payload,
    };
  }

  publicText(
    text: string,
    options: {
      readonly task?: SdarTaskScope;
      readonly dedupeKey?: string;
    } = {},
  ): SdarInteractionEvent | undefined {
    const safe = safePublicText(text, this.maxTextCharacters);
    if (safe === undefined) return undefined;
    return this.create("message.text", { text: safe }, options);
  }
}

export function safePublicText(
  value: unknown,
  maximumCharacters = 16_000,
): string | undefined {
  if (typeof value !== "string") return undefined;
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
    .replace(
      /(?:authorization|api[_-]?key|password|secret)\s*[:=]\s*\S+/giu,
      "[REDACTED]",
    )
    .trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length <= maximumCharacters) return normalized;
  return `${normalized.slice(0, maximumCharacters)}\n\n[truncated]`;
}

export function isSdarInteractionEvent(
  value: unknown,
): value is SdarInteractionEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<SdarInteractionEvent>;
  return (
    typeof candidate.eventId === "string" &&
    interactionEventTypes.includes(
      candidate.eventType as SdarInteractionEventType,
    ) &&
    typeof candidate.occurredAt === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.threadId === "string" &&
    Number.isSafeInteger(candidate.sequence) &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null
  );
}
