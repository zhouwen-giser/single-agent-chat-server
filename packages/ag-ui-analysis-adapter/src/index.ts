import { EventType, type AGUIEvent, type Interrupt } from "@ag-ui/core";

import {
  assertSacsAgUiEvent,
  parseAgUiInterrupt,
  sacsAgUiToolResultContentSchema,
  SACS_AG_UI_V03_PROFILE_ID,
  type SacsAgUiToolResultContent,
} from "../../ag-ui-api-contract/src/index.js";
import type { AgUiRunHandler } from "../../ag-ui-interaction-adapter/src/index.js";
import type { AuthorizedWsgsAnalysisConsumer } from "../../wsgs-analysis-consumer/src/index.js";
import {
  agUiSharedStateV03Schema,
  calculateAgUiStateSnapshotHash,
  parseAndVerifyAgUiSharedStateV03,
  type AgUiSharedStateV03,
  type ToolInteractionDescriptor,
} from "../../analysis-contract/src/index.js";
import { safePublicText } from "../../interaction-contract/src/index.js";
import { canonicalJson } from "../../world-explanation-contract/src/index.js";

export interface AnalysisRunEventIdentity {
  readonly threadId: string;
  readonly runId: string;
  readonly parentRunId?: string;
}

export interface AnalysisStepEventInput {
  readonly stepName: string;
}

export interface AnalysisToolResultInput extends Omit<
  SacsAgUiToolResultContent,
  "schemaVersion" | "summary"
> {
  readonly toolCallId: string;
  readonly messageId: string;
  readonly summary: string;
}

export interface JsonPatchOperation {
  readonly op: "add" | "remove" | "replace" | "test";
  readonly path: string;
  readonly value?: unknown;
}

const analysisV03HandlerBrand: unique symbol = Symbol(
  "sacs.ag-ui.analysis-v0.3-handler",
);

export type AnalysisAgUiV03RunHandler = AgUiRunHandler & {
  readonly [analysisV03HandlerBrand]: true;
};

export interface AnalysisAgUiV03Readiness {
  readonly consumer: AuthorizedWsgsAnalysisConsumer;
  readonly analysisControlReady: true;
}

/**
 * Explicitly registers a handler as the analysis v0.3 profile boundary.
 * The wrapper rejects profile confusion and revalidates every emitted event
 * against the installed official AG-UI contract.
 */
export function createAnalysisAgUiV03RunHandler(
  handler: AgUiRunHandler,
  readiness: AnalysisAgUiV03Readiness,
): AnalysisAgUiV03RunHandler {
  if (
    readiness.analysisControlReady !== true ||
    readiness.consumer.status !== "READY" ||
    readiness.consumer.marker !== "SACS_WSGS_ANALYSIS_CONSUMER_READY" ||
    readiness.consumer.profile !== "sacs-wsgs-analysis-presentation/1.0" ||
    readiness.consumer.lock.status !== "READY" ||
    readiness.consumer.lock.provenance !== "AUTHORITATIVE_WSGS_HANDOFF"
  ) {
    throw new Error("AG_UI_ANALYSIS_RUNTIME_NOT_READY");
  }
  const wrapped: AgUiRunHandler = async function* analysisV03(context) {
    if (context.profile !== SACS_AG_UI_V03_PROFILE_ID) {
      throw new Error("AG_UI_ANALYSIS_PROFILE_MISMATCH");
    }
    for await (const event of handler(context)) {
      const validated = assertSacsAgUiEvent(event, SACS_AG_UI_V03_PROFILE_ID);
      if (validated.type === EventType.STATE_SNAPSHOT) {
        parseAndVerifyAgUiSharedStateV03(validated.snapshot);
      }
      yield validated;
    }
  };
  Object.defineProperty(wrapped, analysisV03HandlerBrand, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return wrapped as AnalysisAgUiV03RunHandler;
}

export function isAnalysisAgUiV03RunHandler(
  value: unknown,
): value is AnalysisAgUiV03RunHandler {
  return (
    typeof value === "function" &&
    (value as Partial<AnalysisAgUiV03RunHandler>)[analysisV03HandlerBrand] ===
      true
  );
}

export function projectAnalysisRunStarted(
  input: AnalysisRunEventIdentity,
): AGUIEvent {
  return v03Event({
    type: EventType.RUN_STARTED,
    threadId: input.threadId,
    runId: input.runId,
    ...(input.parentRunId === undefined
      ? {}
      : { parentRunId: input.parentRunId }),
  });
}

export function projectAnalysisRunFinished(
  input: AnalysisRunEventIdentity,
): AGUIEvent {
  return v03Event({
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
    outcome: { type: "success" },
  });
}

export function projectAnalysisRunInterrupted(input: {
  readonly identity: AnalysisRunEventIdentity;
  readonly stateRevision: number;
  readonly state: Readonly<Record<string, unknown>>;
  readonly activityMessageId: string;
  readonly activityRevision: number;
  readonly activityType?: string;
  readonly activity: Readonly<Record<string, unknown>>;
  readonly interrupts: readonly Interrupt[];
}): readonly AGUIEvent[] {
  if (input.interrupts.length < 1 || input.interrupts.length > 16) {
    throw new Error("AG_UI_INTERRUPT_COUNT_INVALID");
  }
  const interrupts = input.interrupts.map((interrupt) =>
    parseAgUiInterrupt(interrupt),
  );
  return [
    projectAnalysisStateSnapshot({
      stateRevision: input.stateRevision,
      state: input.state,
    }),
    projectAnalysisActivitySnapshot({
      messageId: input.activityMessageId,
      activityRevision: input.activityRevision,
      ...(input.activityType === undefined
        ? {}
        : { activityType: input.activityType }),
      content: input.activity,
    }),
    v03Event({
      type: EventType.RUN_FINISHED,
      threadId: input.identity.threadId,
      runId: input.identity.runId,
      outcome: { type: "interrupt", interrupts },
    }),
  ];
}

export function projectAnalysisStepStarted(
  input: AnalysisStepEventInput,
): AGUIEvent {
  return v03Event({
    type: EventType.STEP_STARTED,
    stepName: boundedName(input.stepName, "ANALYSIS_STEP_NAME_INVALID"),
  });
}

export function projectAnalysisStepFinished(
  input: AnalysisStepEventInput,
): AGUIEvent {
  return v03Event({
    type: EventType.STEP_FINISHED,
    stepName: boundedName(input.stepName, "ANALYSIS_STEP_NAME_INVALID"),
  });
}

export function projectAnalysisToolCallLifecycle(input: {
  readonly descriptor: ToolInteractionDescriptor;
  readonly parentMessageId?: string;
}): readonly AGUIEvent[] {
  assertPublicToolArgs(input.descriptor.publicArgs);
  const args = canonicalJson(input.descriptor.publicArgs);
  if (Buffer.byteLength(args, "utf8") > 262_144) {
    throw new Error("AG_UI_PUBLIC_TOOL_ARGS_TOO_LARGE");
  }
  return [
    v03Event({
      type: EventType.TOOL_CALL_START,
      toolCallId: input.descriptor.toolCallId,
      toolCallName: input.descriptor.operationKey,
      ...(input.parentMessageId === undefined
        ? {}
        : { parentMessageId: input.parentMessageId }),
    }),
    v03Event({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: input.descriptor.toolCallId,
      delta: args,
    }),
    v03Event({
      type: EventType.TOOL_CALL_END,
      toolCallId: input.descriptor.toolCallId,
    }),
  ];
}

export function projectAnalysisToolCallResult(
  input: AnalysisToolResultInput,
): AGUIEvent {
  const summary = safePublicText(input.summary, 2_000);
  if (summary === undefined || summary.length === 0) {
    throw new Error("AG_UI_TOOL_RESULT_SUMMARY_INVALID");
  }
  const content = sacsAgUiToolResultContentSchema.parse({
    schemaVersion: "sacs-ag-ui-tool-result/1.0",
    status: input.status,
    summary,
    analysisId: input.analysisId,
    revisionId: input.revisionId,
    runId: input.runId,
    nodeId: input.nodeId,
    findingIds: input.findingIds,
    layerIds: input.layerIds,
    evidenceItemIds: input.evidenceItemIds,
  });
  return v03Event({
    type: EventType.TOOL_CALL_RESULT,
    messageId: input.messageId,
    toolCallId: input.toolCallId,
    role: "tool",
    content: canonicalJson(content),
  });
}

export function projectAnalysisActivitySnapshot(input: {
  readonly messageId: string;
  readonly activityRevision: number;
  readonly activityType?: string;
  readonly content: Readonly<Record<string, unknown>>;
}): AGUIEvent {
  assertRevision(input.activityRevision);
  const { meta: ignoredMeta, ...content } = input.content;
  void ignoredMeta;
  return v03Event({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: input.messageId,
    activityType: input.activityType ?? "analysis.dag",
    content: { ...content, meta: { activityRevision: input.activityRevision } },
    replace: true,
  });
}

export function projectAnalysisActivityDelta(input: {
  readonly messageId: string;
  readonly expectedActivityRevision: number;
  readonly nextActivityRevision: number;
  readonly activityType?: string;
  readonly patch: readonly JsonPatchOperation[];
}): AGUIEvent {
  assertRevision(input.expectedActivityRevision);
  assertRevision(input.nextActivityRevision);
  if (input.nextActivityRevision !== input.expectedActivityRevision + 1) {
    throw new Error("AG_UI_ACTIVITY_REVISION_MUST_ADVANCE_ONCE");
  }
  const patch = validatePatch(input.patch, true, 62, "activityRevision");
  return v03Event({
    type: EventType.ACTIVITY_DELTA,
    messageId: input.messageId,
    activityType: input.activityType ?? "analysis.dag",
    patch: [
      {
        op: "test",
        path: "/meta/activityRevision",
        value: input.expectedActivityRevision,
      },
      ...patch,
      {
        op: "replace",
        path: "/meta/activityRevision",
        value: input.nextActivityRevision,
      },
    ],
  });
}

export function projectAnalysisStateSnapshot(input: {
  readonly stateRevision: number;
  readonly state: Readonly<Record<string, unknown>>;
}): AGUIEvent {
  assertRevision(input.stateRevision);
  const { meta: ignoredMeta, ...state } = input.state;
  void ignoredMeta;
  const snapshot = agUiSharedStateV03Schema.parse({
    ...state,
    meta: {
      stateRevision: input.stateRevision,
      snapshotHash: calculateAgUiStateSnapshotHash(state, input.stateRevision),
    },
  });
  return v03Event({
    type: EventType.STATE_SNAPSHOT,
    snapshot,
  });
}

export function projectAnalysisStateDelta(input: {
  readonly expectedStateRevision: number;
  readonly nextStateRevision: number;
  readonly nextSnapshotHash: AgUiSharedStateV03["meta"]["snapshotHash"];
  readonly operations: readonly JsonPatchOperation[];
}): AGUIEvent {
  assertRevision(input.expectedStateRevision);
  assertRevision(input.nextStateRevision);
  if (input.nextStateRevision !== input.expectedStateRevision + 1) {
    throw new Error("AG_UI_STATE_REVISION_MUST_ADVANCE_ONCE");
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.nextSnapshotHash)) {
    throw new Error("AG_UI_STATE_SNAPSHOT_HASH_INVALID");
  }
  const operations = validatePatch(
    input.operations,
    true,
    61,
    "stateRevision|snapshotHash",
  );
  return v03Event({
    type: EventType.STATE_DELTA,
    delta: [
      {
        op: "test",
        path: "/meta/stateRevision",
        value: input.expectedStateRevision,
      },
      ...operations,
      {
        op: "replace",
        path: "/meta/snapshotHash",
        value: input.nextSnapshotHash,
      },
      {
        op: "replace",
        path: "/meta/stateRevision",
        value: input.nextStateRevision,
      },
    ],
  });
}

export function projectAnalysisText(input: {
  readonly messageId: string;
  readonly text: string;
}): readonly AGUIEvent[] {
  const text = safePublicText(input.text, 65_536);
  if (text === undefined) throw new Error("AG_UI_ANALYSIS_TEXT_INVALID");
  if (Buffer.byteLength(text, "utf8") > 65_536) {
    throw new Error("AG_UI_ANALYSIS_TEXT_TOO_LARGE");
  }
  return [
    v03Event({
      type: EventType.TEXT_MESSAGE_START,
      messageId: input.messageId,
      role: "assistant",
    }),
    v03Event({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: input.messageId,
      delta: text,
    }),
    v03Event({
      type: EventType.TEXT_MESSAGE_END,
      messageId: input.messageId,
    }),
  ];
}

function v03Event(input: unknown): AGUIEvent {
  return assertSacsAgUiEvent(input, SACS_AG_UI_V03_PROFILE_ID);
}

function validatePatch(
  input: readonly JsonPatchOperation[],
  forbidStateRevision: boolean,
  maximumOperations = 64,
  reservedMetaPattern = "stateRevision",
): JsonPatchOperation[] {
  if (input.length === 0 || input.length > maximumOperations) {
    throw new Error("AG_UI_PATCH_COUNT_INVALID");
  }
  return input.map((operation) => {
    if (
      !operation.path.startsWith("/") ||
      operation.path === "/" ||
      operation.path.includes("__proto__") ||
      operation.path.includes("/prototype") ||
      operation.path.includes("/constructor")
    ) {
      throw new Error("AG_UI_PATCH_PATH_INVALID");
    }
    if (
      forbidStateRevision &&
      new RegExp(`^/meta/(?:${reservedMetaPattern})(?:/|$)`, "u").test(
        operation.path,
      )
    ) {
      throw new Error("AG_UI_STATE_REVISION_PATCH_RESERVED");
    }
    return { ...operation };
  });
}

function assertPublicToolArgs(value: unknown, path = ""): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertPublicToolArgs(item, `${path}/${index}`),
    );
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (
      /^(?:authorization|credential|dataScope|endpoint|executionArgs|executionArgsHash|principalId|provider|providerId|secret|sourceFingerprint|token|assetUri)$/iu.test(
        key,
      )
    ) {
      throw new Error(
        `AG_UI_PUBLIC_ARGS_AUTHORITY_FIELD_FORBIDDEN:${path}/${key}`,
      );
    }
    assertPublicToolArgs(item, `${path}/${key}`);
  }
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("AG_UI_STATE_REVISION_INVALID");
  }
}

function boundedName(value: string, code: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) throw new Error(code);
  return normalized;
}
