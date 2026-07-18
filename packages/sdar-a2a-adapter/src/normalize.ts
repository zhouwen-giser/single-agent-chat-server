import {
  Role,
  TaskState,
  type Artifact,
  type Message,
  type Part,
  type StreamResponse,
  type Task,
  type TaskStatus,
} from "@a2a-js/sdk";

import type {
  JsonValue,
  NormalizedArtifact,
  NormalizedMessage,
  NormalizedPart,
  NormalizedSendResult,
  NormalizedStreamEvent,
  NormalizedTask,
  NormalizedTaskState,
} from "./types.js";

const metadataString = (
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
};

export function normalizePart(part: Part): NormalizedPart {
  const base = { mediaType: part.mediaType };
  if (part.content?.$case === "text") {
    return { ...base, kind: "text", text: part.content.value };
  }
  if (part.content?.$case === "data") {
    return { ...base, kind: "data", data: part.content.value as JsonValue };
  }
  if (part.content?.$case === "url") {
    return { ...base, kind: "url", url: part.content.value };
  }
  return { ...base, kind: "raw" };
}

export function normalizeMessage(message: Message): NormalizedMessage {
  return {
    messageId: message.messageId,
    ...(message.taskId.length === 0 ? {} : { taskId: message.taskId }),
    ...(message.contextId.length === 0 ? {} : { contextId: message.contextId }),
    role:
      message.role === Role.ROLE_USER
        ? "USER"
        : message.role === Role.ROLE_AGENT
          ? "AGENT"
          : "UNSPECIFIED",
    parts: message.parts.map(normalizePart),
  };
}

export function normalizeArtifact(artifact: Artifact): NormalizedArtifact {
  return {
    artifactId: artifact.artifactId,
    ...(artifact.name.length === 0 ? {} : { name: artifact.name }),
    ...(artifact.description.length === 0
      ? {}
      : { description: artifact.description }),
    parts: artifact.parts.map(normalizePart),
  };
}

export function normalizeState(state: TaskState): NormalizedTaskState {
  const states: Record<number, NormalizedTaskState> = {
    [TaskState.TASK_STATE_UNSPECIFIED]: "UNSPECIFIED",
    [TaskState.TASK_STATE_SUBMITTED]: "SUBMITTED",
    [TaskState.TASK_STATE_WORKING]: "WORKING",
    [TaskState.TASK_STATE_COMPLETED]: "COMPLETED",
    [TaskState.TASK_STATE_FAILED]: "FAILED",
    [TaskState.TASK_STATE_CANCELED]: "CANCELED",
    [TaskState.TASK_STATE_INPUT_REQUIRED]: "INPUT_REQUIRED",
    [TaskState.TASK_STATE_REJECTED]: "REJECTED",
    [TaskState.TASK_STATE_AUTH_REQUIRED]: "AUTH_REQUIRED",
  };
  return states[state] ?? "UNSPECIFIED";
}

const normalizeStatus = (
  status: TaskStatus | undefined,
): {
  readonly state: NormalizedTaskState;
  readonly statusMessage?: NormalizedMessage;
  readonly statusTimestamp?: string;
} => ({
  state: normalizeState(status?.state ?? TaskState.TASK_STATE_UNSPECIFIED),
  ...(status?.message === undefined
    ? {}
    : { statusMessage: normalizeMessage(status.message) }),
  ...(status?.timestamp === undefined
    ? {}
    : { statusTimestamp: status.timestamp }),
});

export function normalizeTask(task: Task): NormalizedTask {
  const metadata = task.metadata as Record<string, unknown> | undefined;
  return {
    taskId: task.id,
    contextId: task.contextId,
    ...normalizeStatus(task.status),
    ...(metadataString(metadata, "internalPhase") === undefined
      ? {}
      : { internalPhase: metadataString(metadata, "internalPhase") }),
    ...(metadataString(metadata, "phaseMessage") === undefined
      ? {}
      : { phaseMessage: metadataString(metadata, "phaseMessage") }),
    ...(metadataString(metadata, "errorCode") === undefined
      ? {}
      : { errorCode: metadataString(metadata, "errorCode") }),
    ...(metadata?.capabilityGap === undefined
      ? {}
      : { capabilityGap: metadata.capabilityGap as JsonValue }),
    ...(metadataString(metadata, "nextAction") === undefined
      ? {}
      : { nextAction: metadataString(metadata, "nextAction") }),
    artifacts: task.artifacts.map(normalizeArtifact),
  };
}

export function normalizeSendResult(
  result: Message | Task,
): NormalizedSendResult {
  return "status" in result
    ? { kind: "task", task: normalizeTask(result) }
    : { kind: "message", message: normalizeMessage(result) };
}

export function normalizeStreamEvent(
  response: StreamResponse,
): NormalizedStreamEvent {
  const payload = response.payload;
  if (payload?.$case === "task") {
    return { kind: "task", task: normalizeTask(payload.value) };
  }
  if (payload?.$case === "message") {
    return { kind: "message", message: normalizeMessage(payload.value) };
  }
  if (payload?.$case === "artifactUpdate") {
    if (payload.value.artifact === undefined) {
      throw new Error("A2A artifact update omitted artifact");
    }
    return {
      kind: "artifact",
      taskId: payload.value.taskId,
      contextId: payload.value.contextId,
      artifact: normalizeArtifact(payload.value.artifact),
      append: payload.value.append,
      lastChunk: payload.value.lastChunk,
    };
  }
  if (payload?.$case === "statusUpdate") {
    const status = normalizeStatus(payload.value.status);
    const metadata = payload.value.metadata as
      Record<string, unknown> | undefined;
    return {
      kind: "status",
      taskId: payload.value.taskId,
      contextId: payload.value.contextId,
      state: status.state,
      ...(status.statusMessage === undefined
        ? {}
        : { message: status.statusMessage }),
      ...(status.statusTimestamp === undefined
        ? {}
        : { timestamp: status.statusTimestamp }),
      ...(metadataString(metadata, "internalPhase") === undefined
        ? {}
        : { internalPhase: metadataString(metadata, "internalPhase") }),
      ...(metadataString(metadata, "phaseMessage") === undefined
        ? {}
        : { phaseMessage: metadataString(metadata, "phaseMessage") }),
      ...(metadataString(metadata, "errorCode") === undefined
        ? {}
        : { errorCode: metadataString(metadata, "errorCode") }),
      ...(metadata?.capabilityGap === undefined
        ? {}
        : { capabilityGap: metadata.capabilityGap as JsonValue }),
    };
  }
  throw new Error("A2A stream response omitted a supported payload");
}
