import {
  InteractionEventFactory,
  safePublicText,
  type PublicJsonValue,
  type SdarInteractionEvent,
  type SdarTaskScope,
} from "../../interaction-contract/src/index.js";
import type {
  JsonValue,
  NormalizedArtifact,
  NormalizedMessage,
  NormalizedPart,
  NormalizedStreamEvent,
  NormalizedTask,
  NormalizedTaskState,
  SdarFollowUpAction,
} from "../../sdar-a2a-adapter/src/index.js";

const terminalStates = new Set<NormalizedTaskState>([
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "REJECTED",
]);

interface PublicStatus {
  readonly state: NormalizedTaskState;
  readonly internalPhase?: string;
  readonly inputRequestId?: string;
  readonly phaseMessage?: string;
  readonly errorCode?: string;
  readonly capabilityGap?: JsonValue;
  readonly nextAction?: string;
  readonly updatedAt?: string;
}

export class A2aInteractionMapper {
  private taskScope: SdarTaskScope | undefined;
  private hasSnapshot = false;
  private readonly artifactParts = new Set<string>();

  constructor(private readonly factory: InteractionEventFactory) {}

  mapStreamEvent(
    event: NormalizedStreamEvent,
  ): readonly SdarInteractionEvent[] {
    if (event.kind === "message") return this.mapMessage(event.message);
    if (event.kind === "artifact") {
      const scope = this.ensureTask(event.taskId, event.contextId);
      const events = this.ensureSnapshot(scope, { state: "WORKING" });
      return [...events, ...this.mapArtifact(event.artifact, scope)];
    }
    if (event.kind === "task") return this.mapTask(event.task);

    const scope = this.ensureTask(event.taskId, event.contextId);
    const status: PublicStatus = {
      state: event.state,
      ...(event.internalPhase === undefined
        ? {}
        : { internalPhase: event.internalPhase }),
      ...(event.inputRequestId === undefined
        ? {}
        : { inputRequestId: event.inputRequestId }),
      ...(event.phaseMessage === undefined
        ? {}
        : { phaseMessage: event.phaseMessage }),
      ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
      ...(event.capabilityGap === undefined
        ? {}
        : { capabilityGap: event.capabilityGap }),
      ...(event.nextAction === undefined
        ? {}
        : { nextAction: event.nextAction }),
      ...(event.timestamp === undefined ? {} : { updatedAt: event.timestamp }),
    };
    const events = this.hasSnapshot
      ? this.mapStatusChanged(scope, status)
      : this.ensureSnapshot(scope, status);
    return [
      ...events,
      ...this.mapMessage(event.message, scope),
      ...this.mapStatusSignals(scope, status),
    ];
  }

  mapTask(task: NormalizedTask): readonly SdarInteractionEvent[] {
    const scope = this.ensureTask(task.taskId, task.contextId);
    const status: PublicStatus = {
      state: task.state,
      ...(task.internalPhase === undefined
        ? {}
        : { internalPhase: task.internalPhase }),
      ...(task.inputRequestId === undefined
        ? {}
        : { inputRequestId: task.inputRequestId }),
      ...(task.phaseMessage === undefined
        ? {}
        : { phaseMessage: task.phaseMessage }),
      ...(task.errorCode === undefined ? {} : { errorCode: task.errorCode }),
      ...(task.capabilityGap === undefined
        ? {}
        : { capabilityGap: task.capabilityGap }),
      ...(task.nextAction === undefined ? {} : { nextAction: task.nextAction }),
      ...(task.statusTimestamp === undefined
        ? {}
        : { updatedAt: task.statusTimestamp }),
    };
    const events = this.hasSnapshot
      ? this.mapStatusChanged(scope, status)
      : this.ensureSnapshot(scope, status);
    return [
      ...events,
      ...this.mapMessage(task.statusMessage, scope),
      ...this.mapStatusSignals(scope, status),
      ...task.artifacts.flatMap((artifact) =>
        this.mapArtifact(artifact, scope),
      ),
    ];
  }

  observationEnded(input: {
    readonly state: NormalizedTaskState;
    readonly taskContinues: boolean;
  }): SdarInteractionEvent | undefined {
    return this.factory.create("observation.ended", {
      ...(this.taskScope === undefined
        ? {}
        : { taskId: this.taskScope.taskId }),
      state: input.state,
      taskContinues: input.taskContinues,
      text: input.taskContinues
        ? "This bounded observation ended while the SDAR Task continues."
        : "This bounded observation ended after the SDAR Task reached a boundary.",
    });
  }

  private ensureTask(taskId: string, contextId: string): SdarTaskScope {
    if (this.taskScope !== undefined) {
      if (
        this.taskScope.taskId !== taskId ||
        this.taskScope.contextId !== contextId
      ) {
        throw new Error("A2A interaction changed authorized Task identity");
      }
      return this.taskScope;
    }
    this.taskScope = { taskId, contextId };
    return this.taskScope;
  }

  private ensureSnapshot(
    scope: SdarTaskScope,
    status: PublicStatus,
  ): readonly SdarInteractionEvent[] {
    if (this.hasSnapshot) return [];
    this.hasSnapshot = true;
    return compact([
      this.factory.create(
        "task.bound",
        { taskId: scope.taskId, contextId: scope.contextId },
        { task: scope, dedupeKey: `task-bound:${scope.taskId}` },
      ),
      this.factory.create("task.snapshot", publicTaskPayload(status), {
        task: scope,
        dedupeKey: `task-snapshot:${scope.taskId}`,
      }),
      this.allowedActionsEvent(scope, status),
    ]);
  }

  private mapStatusChanged(
    scope: SdarTaskScope,
    status: PublicStatus,
  ): readonly SdarInteractionEvent[] {
    return compact([
      this.factory.create("task.status_changed", publicTaskPayload(status), {
        task: scope,
        dedupeKey: `task-status:${JSON.stringify(publicTaskPayload(status))}`,
      }),
      this.allowedActionsEvent(scope, status),
    ]);
  }

  private mapStatusSignals(
    scope: SdarTaskScope,
    status: PublicStatus,
  ): readonly SdarInteractionEvent[] {
    const events: Array<SdarInteractionEvent | undefined> = [];
    if (status.state === "INPUT_REQUIRED") {
      events.push(
        this.factory.create(
          "input.required",
          {
            state: status.state,
            ...(safePublicText(status.internalPhase, 128) === undefined
              ? {}
              : { internalPhase: safePublicText(status.internalPhase, 128) }),
            ...(safePublicText(status.inputRequestId, 256) === undefined
              ? {}
              : { inputRequestId: safePublicText(status.inputRequestId, 256) }),
            ...(safePublicText(status.phaseMessage, 4_000) === undefined
              ? {}
              : { text: safePublicText(status.phaseMessage, 4_000) }),
            allowedActions: allowedActions(status),
          },
          {
            task: scope,
            dedupeKey: `input:${status.inputRequestId ?? status.internalPhase ?? "unknown"}`,
          },
        ),
      );
    }
    if (isCapabilityGap(status)) {
      events.push(
        this.factory.create(
          "capability.gap",
          {
            ...(safeErrorCode(status.errorCode) === undefined
              ? {}
              : { errorCode: safeErrorCode(status.errorCode) }),
            ...(safePublicJson(status.capabilityGap) === undefined
              ? {}
              : { capabilityGap: safePublicJson(status.capabilityGap) }),
            ...(safePublicText(status.nextAction, 512) === undefined
              ? {}
              : { nextAction: safePublicText(status.nextAction, 512) }),
            text: "SDAR reported a Capability Gap, not a chat-server protocol failure.",
          },
          {
            task: scope,
            dedupeKey: `capability-gap:${JSON.stringify(safePublicJson(status.capabilityGap))}`,
          },
        ),
      );
    }
    return compact(events);
  }

  private allowedActionsEvent(
    scope: SdarTaskScope,
    status: PublicStatus,
  ): SdarInteractionEvent | undefined {
    const actions = allowedActions(status);
    return this.factory.create(
      "allowed_actions.changed",
      { actions },
      {
        task: scope,
        dedupeKey: `allowed-actions:${actions.join(",")}`,
      },
    );
  }

  private mapMessage(
    message: NormalizedMessage | undefined,
    scope = this.taskScope,
  ): readonly SdarInteractionEvent[] {
    if (message === undefined || message.role !== "AGENT") return [];
    if (
      scope !== undefined &&
      ((message.taskId !== undefined && message.taskId !== scope.taskId) ||
        (message.contextId !== undefined &&
          message.contextId !== scope.contextId))
    ) {
      throw new Error("A2A Message identity does not match authorized Task");
    }
    return compact(
      message.parts.map((part, index) =>
        part.kind === "text"
          ? this.factory.publicText(part.text ?? "", {
              ...(scope === undefined ? {} : { task: scope }),
              dedupeKey: `message:${message.messageId}:${index}`,
            })
          : undefined,
      ),
    );
  }

  private mapArtifact(
    artifact: NormalizedArtifact,
    scope: SdarTaskScope,
  ): readonly SdarInteractionEvent[] {
    return compact(
      artifact.parts.map((part, index) => {
        const key = `${artifact.artifactId}:${index}:${JSON.stringify(part)}`;
        if (this.artifactParts.has(key)) return undefined;
        this.artifactParts.add(key);
        return this.mapArtifactPart(artifact, part, index, scope);
      }),
    );
  }

  private mapArtifactPart(
    artifact: NormalizedArtifact,
    part: NormalizedPart,
    index: number,
    scope: SdarTaskScope,
  ): SdarInteractionEvent | undefined {
    const common = {
      artifactId: artifact.artifactId,
      mediaType: part.mediaType,
    };
    if (part.kind === "text") {
      const text = safePublicText(part.text, 16_000);
      return text === undefined
        ? undefined
        : this.factory.create(
            "artifact.text",
            { ...common, text },
            {
              task: scope,
              dedupeKey: `artifact:${artifact.artifactId}:${index}`,
            },
          );
    }
    if (part.kind === "data") {
      const data = safePublicJson(part.data);
      return data === undefined
        ? undefined
        : this.factory.create(
            "artifact.data",
            { ...common, data },
            {
              task: scope,
              dedupeKey: `artifact:${artifact.artifactId}:${index}`,
            },
          );
    }
    if (part.kind === "url") {
      const url = safePublicUrl(part.url);
      return url === undefined
        ? undefined
        : this.factory.create(
            "artifact.reference",
            { ...common, url },
            {
              task: scope,
              dedupeKey: `artifact:${artifact.artifactId}:${index}`,
            },
          );
    }
    return undefined;
  }
}

function publicTaskPayload(
  status: PublicStatus,
): Readonly<Record<string, PublicJsonValue>> {
  return {
    state: status.state,
    terminal: terminalStates.has(status.state),
    text: statusText(status),
    ...(safePublicText(status.internalPhase, 128) === undefined
      ? {}
      : { internalPhase: safePublicText(status.internalPhase, 128) }),
    ...(safePublicText(status.phaseMessage, 4_000) === undefined
      ? {}
      : { phaseMessage: safePublicText(status.phaseMessage, 4_000) }),
    ...(safeErrorCode(status.errorCode) === undefined
      ? {}
      : { errorCode: safeErrorCode(status.errorCode) }),
    ...(safeIsoDate(status.updatedAt) === undefined
      ? {}
      : { updatedAt: safeIsoDate(status.updatedAt) }),
  };
}

function statusText(status: PublicStatus): string {
  const phase = safePublicText(status.phaseMessage, 4_000);
  return `**SDAR status: ${status.state}**${phase === undefined ? "" : `\n\n${phase}`}`;
}

function allowedActions(status: PublicStatus): readonly SdarFollowUpAction[] {
  if (terminalStates.has(status.state)) return [];
  if (status.state === "INPUT_REQUIRED") {
    if (status.internalPhase === "awaiting_plan_confirmation") {
      return ["confirm_plan", "reject_plan", "revise_plan", "patch_goal"];
    }
    if (status.internalPhase === "awaiting_user_input")
      return ["provide_input"];
    if (status.internalPhase === "paused") return ["resume", "cancel_goal"];
    return [];
  }
  return ["patch_goal", "cancel_goal", "pause"];
}

function isCapabilityGap(status: PublicStatus): boolean {
  return (
    status.internalPhase === "capability_gap" ||
    status.errorCode === "CAPABILITY_GAP" ||
    status.capabilityGap !== undefined
  );
}

function safeErrorCode(value: string | undefined): string | undefined {
  return value !== undefined && /^[A-Z0-9_.-]{1,128}$/u.test(value)
    ? value
    : undefined;
}

function safeIsoDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

function safePublicJson(
  value: JsonValue | undefined,
  maximumCharacters = 32_000,
): PublicJsonValue | undefined {
  if (value === undefined) return undefined;
  const sanitized = sanitizeJson(value);
  return JSON.stringify(sanitized).length <= maximumCharacters
    ? sanitized
    : { truncated: true };
}

function sanitizeJson(value: JsonValue): PublicJsonValue {
  if (Array.isArray(value)) return value.slice(0, 128).map(sanitizeJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 128)
        .map(([key, item]) => [
          key,
          /authorization|api[_-]?key|password|secret|token/iu.test(key)
            ? "[REDACTED]"
            : sanitizeJson(item),
        ]),
    );
  }
  return value;
}

function safePublicUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function compact<T>(values: readonly (T | undefined)[]): T[] {
  return values.filter((value): value is T => value !== undefined);
}
