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

const MAX_PARTS = 64;
const MAX_ARTIFACTS = 32;
const MAX_TEXT_CHARS = 64 * 1024;
const MAX_JSON_CHARS = 256 * 1024;
const MAX_TASK_CHARS = 1024 * 1024;
const rfc3339Timestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

const metadataString = (
  metadata: Record<string, unknown> | undefined,
  key: string,
  maximum = 4_000,
): string | undefined => {
  const value = metadata?.[key];
  if (value === undefined) return undefined;
  return requiredString(value, `Task metadata.${key}`, maximum);
};

export function normalizePart(part: Part): NormalizedPart {
  const base = {
    mediaType: requiredString(part.mediaType, "A2A Part mediaType", 256),
  };
  if (part.content?.$case === "text") {
    return {
      ...base,
      kind: "text",
      text: requiredString(
        part.content.value,
        "A2A text Part",
        MAX_TEXT_CHARS,
        true,
      ),
    };
  }
  if (part.content?.$case === "data") {
    const data = normalizeJsonValue(part.content.value, "A2A data Part");
    assertSerializedSize(data, "A2A data Part", MAX_JSON_CHARS);
    return { ...base, kind: "data", data };
  }
  if (part.content?.$case === "url") {
    const url = requiredString(part.content.value, "A2A URL Part", 2_048);
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("A2A URL Part must use http or https");
    }
    return { ...base, kind: "url", url };
  }
  throw new Error("A2A Part used an unsupported raw or missing content type");
}

export function normalizeMessage(message: Message): NormalizedMessage {
  const role =
    message.role === Role.ROLE_USER
      ? "USER"
      : message.role === Role.ROLE_AGENT
        ? "AGENT"
        : undefined;
  if (role === undefined) throw new Error("A2A Message used an invalid role");
  const parts = boundedArray(message.parts, "A2A Message parts", MAX_PARTS).map(
    normalizePart,
  );
  const normalized: NormalizedMessage = {
    messageId: requiredString(message.messageId, "A2A Message ID", 256),
    ...(message.taskId.length === 0
      ? {}
      : { taskId: requiredString(message.taskId, "A2A Message Task ID", 256) }),
    ...(message.contextId.length === 0
      ? {}
      : {
          contextId: requiredString(
            message.contextId,
            "A2A Message context ID",
            256,
          ),
        }),
    role,
    parts,
  };
  assertSerializedSize(normalized, "A2A Message", MAX_JSON_CHARS);
  return normalized;
}

export function normalizeArtifact(artifact: Artifact): NormalizedArtifact {
  const normalized: NormalizedArtifact = {
    artifactId: requiredString(artifact.artifactId, "A2A Artifact ID", 256),
    ...(artifact.name.length === 0
      ? {}
      : { name: requiredString(artifact.name, "A2A Artifact name", 256) }),
    ...(artifact.description.length === 0
      ? {}
      : {
          description: requiredString(
            artifact.description,
            "A2A Artifact description",
            4_000,
          ),
        }),
    parts: boundedArray(artifact.parts, "A2A Artifact parts", MAX_PARTS).map(
      normalizePart,
    ),
  };
  assertSerializedSize(normalized, "A2A Artifact", MAX_JSON_CHARS);
  return normalized;
}

function inputRequestId(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  const snake = metadataString(metadata, "input_request_id", 256);
  const camel = metadataString(metadata, "inputRequestId", 256);
  if (snake !== undefined && camel !== undefined && snake !== camel) {
    throw new Error(
      "A2A Task metadata published conflicting input request IDs",
    );
  }
  return snake ?? camel;
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
} => {
  if (status === undefined) throw new Error("A2A Task omitted status");
  const state = normalizeState(status.state);
  if (state === "UNSPECIFIED") {
    throw new Error("A2A Task published an unspecified or unknown state");
  }
  const statusTimestamp =
    status.timestamp === undefined
      ? undefined
      : validTimestamp(status.timestamp, "A2A status timestamp");
  return {
    state,
    ...(status.message === undefined
      ? {}
      : { statusMessage: normalizeMessage(status.message) }),
    ...(statusTimestamp === undefined ? {} : { statusTimestamp }),
  };
};

export function normalizeTask(task: Task): NormalizedTask {
  const metadata = task.metadata as Record<string, unknown> | undefined;
  const taskId = requiredString(task.id, "A2A Task ID", 256);
  const contextId = requiredString(task.contextId, "A2A Task context ID", 256);
  const status = normalizeStatus(task.status);
  assertMessageIdentity(status.statusMessage, taskId, contextId);
  const artifacts = boundedArray(
    task.artifacts,
    "A2A Task artifacts",
    MAX_ARTIFACTS,
  ).map(normalizeArtifact);
  const normalized: NormalizedTask = {
    taskId,
    contextId,
    ...status,
    ...(metadataString(metadata, "internalPhase", 256) === undefined
      ? {}
      : { internalPhase: metadataString(metadata, "internalPhase", 256) }),
    ...(inputRequestId(metadata) === undefined
      ? {}
      : { inputRequestId: inputRequestId(metadata) }),
    ...(metadataString(metadata, "phaseMessage", 4_000) === undefined
      ? {}
      : { phaseMessage: metadataString(metadata, "phaseMessage", 4_000) }),
    ...(metadataString(metadata, "errorCode", 128) === undefined
      ? {}
      : { errorCode: metadataString(metadata, "errorCode", 128) }),
    ...(metadata?.capabilityGap === undefined
      ? {}
      : {
          capabilityGap: normalizeJsonValue(
            metadata.capabilityGap,
            "A2A capabilityGap",
          ),
        }),
    ...(metadataString(metadata, "nextAction", 512) === undefined
      ? {}
      : { nextAction: metadataString(metadata, "nextAction", 512) }),
    artifacts,
  };
  assertSerializedSize(normalized, "A2A Task", MAX_TASK_CHARS);
  return normalized;
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
    const taskId = requiredString(
      payload.value.taskId,
      "A2A Artifact update Task ID",
      256,
    );
    const contextId = requiredString(
      payload.value.contextId,
      "A2A Artifact update context ID",
      256,
    );
    return {
      kind: "artifact",
      taskId,
      contextId,
      artifact: normalizeArtifact(payload.value.artifact),
      append: payload.value.append,
      lastChunk: payload.value.lastChunk,
    };
  }
  if (payload?.$case === "statusUpdate") {
    const status = normalizeStatus(payload.value.status);
    const taskId = requiredString(
      payload.value.taskId,
      "A2A Status update Task ID",
      256,
    );
    const contextId = requiredString(
      payload.value.contextId,
      "A2A Status update context ID",
      256,
    );
    assertMessageIdentity(status.statusMessage, taskId, contextId);
    const metadata = payload.value.metadata as
      Record<string, unknown> | undefined;
    return {
      kind: "status",
      taskId,
      contextId,
      state: status.state,
      ...(status.statusMessage === undefined
        ? {}
        : { message: status.statusMessage }),
      ...(status.statusTimestamp === undefined
        ? {}
        : { timestamp: status.statusTimestamp }),
      ...(metadataString(metadata, "internalPhase", 256) === undefined
        ? {}
        : { internalPhase: metadataString(metadata, "internalPhase", 256) }),
      ...(inputRequestId(metadata) === undefined
        ? {}
        : { inputRequestId: inputRequestId(metadata) }),
      ...(metadataString(metadata, "phaseMessage", 4_000) === undefined
        ? {}
        : { phaseMessage: metadataString(metadata, "phaseMessage", 4_000) }),
      ...(metadataString(metadata, "errorCode", 128) === undefined
        ? {}
        : { errorCode: metadataString(metadata, "errorCode", 128) }),
      ...(metadataString(metadata, "nextAction", 512) === undefined
        ? {}
        : { nextAction: metadataString(metadata, "nextAction", 512) }),
      ...(metadata?.capabilityGap === undefined
        ? {}
        : {
            capabilityGap: normalizeJsonValue(
              metadata.capabilityGap,
              "A2A capabilityGap",
            ),
          }),
    };
  }
  throw new Error("A2A stream response omitted a supported payload");
}

function requiredString(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if ((!allowEmpty && normalized.length === 0) || value.length > maximum) {
    throw new Error(
      `${label} must contain ${allowEmpty ? "0" : "1"} to ${maximum} characters`,
    );
  }
  return value;
}

function boundedArray<T>(
  value: readonly T[],
  label: string,
  maximum: number,
): readonly T[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must contain at most ${maximum} entries`);
  }
  return value;
}

function validTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, label, 64);
  if (
    !rfc3339Timestamp.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    throw new Error(`${label} must be RFC 3339`);
  }
  return timestamp;
}

function assertMessageIdentity(
  message: NormalizedMessage | undefined,
  taskId: string,
  contextId: string,
): void {
  if (
    message !== undefined &&
    ((message.taskId !== undefined && message.taskId !== taskId) ||
      (message.contextId !== undefined && message.contextId !== contextId))
  ) {
    throw new Error("A2A status Message identity did not match its Task");
  }
}

function normalizeJsonValue(
  value: unknown,
  label: string,
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): JsonValue {
  budget.nodes += 1;
  if (budget.nodes > 10_000 || depth > 20) {
    throw new Error(`${label} exceeded JSON complexity limits`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(`${label} used a non-finite number`);
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_TEXT_CHARS) {
      throw new Error(`${label} contained an oversized string`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_024)
      throw new Error(`${label} contained an oversized array`);
    return value.map((item) =>
      normalizeJsonValue(item, label, depth + 1, budget),
    );
  }
  if (typeof value !== "object" || value === undefined) {
    throw new Error(`${label} was not valid JSON`);
  }
  const entries = Object.entries(value);
  if (entries.length > 1_024) {
    throw new Error(`${label} contained an oversized object`);
  }
  return Object.fromEntries(
    entries.map(([key, item]) => {
      if (key.length === 0 || key.length > 256) {
        throw new Error(`${label} contained an invalid object key`);
      }
      return [key, normalizeJsonValue(item, label, depth + 1, budget)];
    }),
  );
}

function assertSerializedSize(
  value: unknown,
  label: string,
  maximum: number,
): void {
  const rendered = JSON.stringify(value);
  if (rendered.length > maximum) {
    throw new Error(`${label} exceeded the ${maximum}-character limit`);
  }
}
