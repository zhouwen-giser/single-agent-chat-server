import { EventType, type AGUIEvent } from "@ag-ui/core";

import {
  assertSacsAgUiEvent,
  parseSacsAgUiToolResultContent,
  SACS_AG_UI_V03_PROFILE_ID,
  type SacsAgUiToolResultContent,
} from "../../ag-ui-api-contract/src/index.js";
import {
  parseAndVerifyAgUiSharedStateV03,
  type AgUiSharedStateV03,
} from "../../analysis-contract/src/index.js";
import type {
  AnalysisCancelCommand,
  AnalysisInterventionResolutionCommand,
  AnalysisProposalCommand,
} from "../../analysis-control-runtime/src/index.js";
import { canonicalJson } from "../../world-explanation-contract/src/index.js";

export type AnalysisClientEffect =
  "REQUEST_FULL_STATE_SNAPSHOT" | "REQUEST_FULL_ACTIVITY_SNAPSHOT";

export interface AnalysisClientToolCall {
  readonly toolCallId: string;
  readonly toolCallName: string;
  readonly argsText: string;
  readonly status: "STARTED" | "ARGS" | "ENDED" | "RESULT";
  readonly result?: SacsAgUiToolResultContent;
}

export interface AnalysisClientActivity {
  readonly activityType: string;
  readonly activityRevision: number;
  readonly content: Readonly<Record<string, unknown>>;
}

export interface AnalysisReferenceClientState {
  readonly connected: boolean;
  readonly runStatus: "IDLE" | "RUNNING" | "INTERRUPTED" | "FINISHED" | "ERROR";
  readonly threadId?: string;
  readonly runId?: string;
  readonly parentRunId?: string;
  readonly pendingInterrupts: readonly unknown[];
  readonly currentRunHasStateSnapshot: boolean;
  readonly currentRunHasActivitySnapshot: boolean;
  readonly sharedState?: AgUiSharedStateV03;
  readonly stateRevision?: number;
  readonly needsFullStateSnapshot: boolean;
  readonly needsFullActivitySnapshot: boolean;
  readonly activitiesByMessageId: Readonly<
    Record<string, AnalysisClientActivity>
  >;
  readonly stepsByName: Readonly<Record<string, "RUNNING" | "FINISHED">>;
  readonly toolCallsById: Readonly<Record<string, AnalysisClientToolCall>>;
  readonly textByMessageId: Readonly<Record<string, string>>;
}

export interface AnalysisClientReduction {
  readonly state: AnalysisReferenceClientState;
  readonly effects: readonly AnalysisClientEffect[];
}

export function createAnalysisReferenceClientState(): AnalysisReferenceClientState {
  return {
    connected: true,
    runStatus: "IDLE",
    pendingInterrupts: [],
    currentRunHasStateSnapshot: false,
    currentRunHasActivitySnapshot: false,
    needsFullStateSnapshot: false,
    needsFullActivitySnapshot: false,
    activitiesByMessageId: {},
    stepsByName: {},
    toolCallsById: {},
    textByMessageId: {},
  };
}

export function reduceAnalysisClientEvent(
  current: AnalysisReferenceClientState,
  input: unknown,
): AnalysisClientReduction {
  const event = assertSacsAgUiEvent(input, SACS_AG_UI_V03_PROFILE_ID);
  switch (event.type) {
    case EventType.RUN_STARTED:
      assertRunStartLineage(current, event);
      return noEffect({
        ...current,
        runStatus: "RUNNING",
        threadId: event.threadId,
        runId: event.runId,
        ...(event.parentRunId === undefined
          ? { parentRunId: undefined }
          : { parentRunId: event.parentRunId }),
        pendingInterrupts: [],
        currentRunHasStateSnapshot: false,
        currentRunHasActivitySnapshot: false,
        stepsByName: {},
        toolCallsById: {},
        textByMessageId: {},
      });
    case EventType.RUN_FINISHED:
      if (
        current.threadId !== event.threadId ||
        current.runId !== event.runId
      ) {
        return noEffect(current);
      }
      if (
        event.outcome?.type === "interrupt" &&
        (!current.currentRunHasStateSnapshot ||
          !current.currentRunHasActivitySnapshot)
      ) {
        throw new Error("AG_UI_INTERRUPT_SNAPSHOTS_REQUIRED");
      }
      return event.outcome?.type === "interrupt"
        ? noEffect({
            ...current,
            runStatus: "INTERRUPTED",
            pendingInterrupts: structuredClone(event.outcome.interrupts),
          })
        : noEffect({
            ...current,
            runStatus: "FINISHED",
            pendingInterrupts: [],
          });
    case EventType.RUN_ERROR:
      return noEffect({ ...current, runStatus: "ERROR" });
    case EventType.STEP_STARTED:
      return noEffect({
        ...current,
        stepsByName: {
          ...current.stepsByName,
          [event.stepName]: "RUNNING",
        },
      });
    case EventType.STEP_FINISHED:
      return noEffect({
        ...current,
        stepsByName: {
          ...current.stepsByName,
          [event.stepName]: "FINISHED",
        },
      });
    case EventType.TOOL_CALL_START:
      return noEffect({
        ...current,
        toolCallsById: {
          ...current.toolCallsById,
          [event.toolCallId]: {
            toolCallId: event.toolCallId,
            toolCallName: event.toolCallName,
            argsText: "",
            status: "STARTED",
          },
        },
      });
    case EventType.TOOL_CALL_ARGS:
      return reduceToolArgs(current, event.toolCallId, event.delta);
    case EventType.TOOL_CALL_END:
      return updateToolCall(current, event.toolCallId, (toolCall) => ({
        ...toolCall,
        status: "ENDED",
      }));
    case EventType.TOOL_CALL_RESULT:
      return reduceToolResult(current, event.toolCallId, event.content);
    case EventType.STATE_SNAPSHOT:
      return reduceStateSnapshot(current, event.snapshot);
    case EventType.STATE_DELTA:
      return reduceStateDelta(current, event.delta);
    case EventType.ACTIVITY_SNAPSHOT:
      return reduceActivitySnapshot(current, event);
    case EventType.ACTIVITY_DELTA:
      return reduceActivityDelta(current, event);
    case EventType.TEXT_MESSAGE_START:
      return noEffect({
        ...current,
        textByMessageId: {
          ...current.textByMessageId,
          [event.messageId]: "",
        },
      });
    case EventType.TEXT_MESSAGE_CONTENT:
      return appendText(current, event.messageId, event.delta);
    case EventType.TEXT_MESSAGE_CHUNK:
      return event.messageId === undefined || event.delta === undefined
        ? noEffect(current)
        : appendTextChunk(current, event.messageId, event.delta);
    case EventType.TEXT_MESSAGE_END:
      return noEffect(current);
    default:
      return noEffect(current);
  }
}

export class AgUiV03HeadlessDecoder {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";

  push(chunk: string | Uint8Array): readonly AGUIEvent[] {
    this.buffer +=
      typeof chunk === "string"
        ? chunk
        : this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  finish(): readonly AGUIEvent[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  reset(): void {
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    this.buffer = "";
  }

  private drain(final: boolean): AGUIEvent[] {
    const normalized = this.buffer.replace(/\r\n/gu, "\n");
    const records = normalized.split("\n\n");
    this.buffer = final ? "" : (records.pop() ?? "");
    if (final && records.at(-1) !== "") records.push(this.buffer);
    return records.flatMap((record) => decodeSseRecord(record));
  }
}

export interface MapEngineAdapter {
  replaceScene(scene: Readonly<Record<string, unknown>>): void | Promise<void>;
  setInspectionFocus(focus: unknown): void | Promise<void>;
  disconnect(): void | Promise<void>;
}

export class HeadlessMapEngineAdapter implements MapEngineAdapter {
  readonly scenes: Readonly<Record<string, unknown>>[] = [];
  readonly inspectionFocuses: unknown[] = [];
  disconnected = false;

  replaceScene(scene: Readonly<Record<string, unknown>>): void {
    this.scenes.push(structuredClone(scene));
  }

  setInspectionFocus(focus: unknown): void {
    this.inspectionFocuses.push(structuredClone(focus));
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

export class HeadlessAnalysisReferenceClient {
  private readonly decoder = new AgUiV03HeadlessDecoder();
  private current = createAnalysisReferenceClientState();

  constructor(private readonly mapEngine: MapEngineAdapter) {}

  get state(): AnalysisReferenceClientState {
    return this.current;
  }

  async acceptSseChunk(
    chunk: string | Uint8Array,
  ): Promise<readonly AnalysisClientEffect[]> {
    return this.acceptEvents(this.decoder.push(chunk));
  }

  async finishStream(): Promise<readonly AnalysisClientEffect[]> {
    return this.acceptEvents(this.decoder.finish());
  }

  async disconnect(): Promise<void> {
    this.current = { ...this.current, connected: false };
    await this.mapEngine.disconnect();
  }

  reconnect(): readonly AnalysisClientEffect[] {
    this.decoder.reset();
    this.current = {
      ...this.current,
      connected: true,
      needsFullStateSnapshot: true,
      needsFullActivitySnapshot: true,
    };
    return ["REQUEST_FULL_STATE_SNAPSHOT", "REQUEST_FULL_ACTIVITY_SNAPSHOT"];
  }

  async setInspectionFocus(focus: unknown): Promise<void> {
    await this.mapEngine.setInspectionFocus(focus);
  }

  private async acceptEvents(
    events: readonly AGUIEvent[],
  ): Promise<readonly AnalysisClientEffect[]> {
    const effects: AnalysisClientEffect[] = [];
    for (const event of events) {
      const reduction = reduceAnalysisClientEvent(this.current, event);
      this.current = reduction.state;
      effects.push(...reduction.effects);
      if (
        event.type === EventType.STATE_SNAPSHOT ||
        event.type === EventType.STATE_DELTA
      ) {
        const scene = this.current.sharedState?.map;
        if (scene !== undefined) {
          try {
            await this.mapEngine.replaceScene(scene);
          } catch {
            // Rendering is a local observer concern and cannot stop the
            // authoritative event reduction stream.
          }
        }
      }
    }
    return effects;
  }
}

export interface AnalysisControlTransport {
  send(request: {
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: unknown;
  }): Promise<{ readonly status: number; readonly body: unknown }>;
}

export class AnalysisControlClientError extends Error {
  constructor(
    readonly status: number,
    readonly responseCode: string,
  ) {
    super(responseCode);
  }
}

export class AnalysisControlClient {
  constructor(private readonly transport: AnalysisControlTransport) {}

  getAnalysis(analysisId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/analyses/${safePathId(analysisId)}`);
  }

  getSnapshot(analysisId: string): Promise<unknown> {
    return this.request(
      "GET",
      `/api/v1/analyses/${safePathId(analysisId)}/snapshot`,
    );
  }

  submitProposal(
    analysisId: string,
    proposal: AnalysisProposalCommand,
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/v1/analyses/${safePathId(analysisId)}/proposals`,
      proposal,
    );
  }

  cancelAnalysis(
    analysisId: string,
    request: AnalysisCancelCommand,
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/v1/analyses/${safePathId(analysisId)}/cancel`,
      request,
    );
  }

  resolveIntervention(
    analysisId: string,
    interventionId: string,
    response: AnalysisInterventionResolutionCommand,
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/v1/analyses/${safePathId(analysisId)}/interventions/${safePathId(
        interventionId,
      )}:resolve`,
      response,
    );
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?:
      | AnalysisProposalCommand
      | AnalysisCancelCommand
      | AnalysisInterventionResolutionCommand,
  ): Promise<unknown> {
    if (
      body !== undefined &&
      (body.idempotencyKey.length === 0 || body.idempotencyKey.length > 256)
    ) {
      throw new Error("ANALYSIS_IDEMPOTENCY_KEY_INVALID");
    }
    const response = await this.transport.send({
      method,
      path,
      headers: {},
      ...(body === undefined ? {} : { body }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new AnalysisControlClientError(
        response.status,
        safeResponseCode(response.body),
      );
    }
    return response.body;
  }
}

function reduceStateSnapshot(
  current: AnalysisReferenceClientState,
  snapshot: unknown,
): AnalysisClientReduction {
  const state = parseAndVerifyAgUiSharedStateV03(snapshot);
  return noEffect({
    ...current,
    sharedState: structuredClone(state),
    stateRevision: state.meta.stateRevision,
    needsFullStateSnapshot: false,
    currentRunHasStateSnapshot: true,
  });
}

function reduceStateDelta(
  current: AnalysisReferenceClientState,
  delta: unknown[],
): AnalysisClientReduction {
  const first = delta[0];
  const expected =
    isRecord(first) &&
    first["op"] === "test" &&
    first["path"] === "/meta/stateRevision"
      ? first["value"]
      : undefined;
  if (
    current.sharedState === undefined ||
    current.stateRevision === undefined ||
    current.needsFullStateSnapshot ||
    expected !== current.stateRevision
  ) {
    return requireStateSnapshot(current);
  }
  try {
    const next = parseAndVerifyAgUiSharedStateV03(
      applyJsonPatch(current.sharedState, delta),
    );
    const nextRevision = next.meta.stateRevision;
    if (nextRevision !== current.stateRevision + 1) {
      return requireStateSnapshot(current);
    }
    return noEffect({
      ...current,
      sharedState: next,
      stateRevision: nextRevision,
      needsFullStateSnapshot: false,
    });
  } catch {
    return requireStateSnapshot(current);
  }
}

function reduceActivitySnapshot(
  current: AnalysisReferenceClientState,
  event: Extract<AGUIEvent, { type: EventType.ACTIVITY_SNAPSHOT }>,
): AnalysisClientReduction {
  if (!isRecord(event.content) || !isRecord(event.content["meta"])) {
    throw new Error("AG_UI_ACTIVITY_SNAPSHOT_INVALID");
  }
  const revision = event.content["meta"]["activityRevision"];
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
    throw new Error("AG_UI_ACTIVITY_SNAPSHOT_REVISION_INVALID");
  }
  return noEffect({
    ...current,
    needsFullActivitySnapshot: false,
    currentRunHasActivitySnapshot: true,
    activitiesByMessageId: {
      ...current.activitiesByMessageId,
      [event.messageId]: {
        activityType: event.activityType,
        activityRevision: revision as number,
        content: structuredClone(event.content),
      },
    },
  });
}

function reduceActivityDelta(
  current: AnalysisReferenceClientState,
  event: Extract<AGUIEvent, { type: EventType.ACTIVITY_DELTA }>,
): AnalysisClientReduction {
  const activity = current.activitiesByMessageId[event.messageId];
  const first = event.patch[0];
  const expected =
    isRecord(first) &&
    first["op"] === "test" &&
    first["path"] === "/meta/activityRevision"
      ? first["value"]
      : undefined;
  if (
    current.needsFullActivitySnapshot ||
    activity === undefined ||
    activity.activityType !== event.activityType ||
    expected !== activity.activityRevision
  ) {
    return requireActivitySnapshot(current);
  }
  try {
    const content = applyJsonPatch(activity.content, event.patch);
    if (!isRecord(content) || !isRecord(content["meta"])) {
      throw new Error("ACTIVITY_PATCH_ROOT_INVALID");
    }
    const nextRevision = content["meta"]["activityRevision"];
    if (nextRevision !== activity.activityRevision + 1) {
      throw new Error("ACTIVITY_REVISION_NOT_NEXT");
    }
    return noEffect({
      ...current,
      needsFullActivitySnapshot: false,
      activitiesByMessageId: {
        ...current.activitiesByMessageId,
        [event.messageId]: {
          ...activity,
          activityRevision: nextRevision,
          content,
        },
      },
    });
  } catch {
    return requireActivitySnapshot(current);
  }
}

function reduceToolResult(
  current: AnalysisReferenceClientState,
  toolCallId: string,
  content: string,
): AnalysisClientReduction {
  const result = parseSacsAgUiToolResultContent(content);
  if (current.runId === undefined || result.runId !== current.runId) {
    throw new Error("AG_UI_TOOL_RESULT_RUN_MISMATCH");
  }
  const shared = current.sharedState;
  if (
    shared !== undefined &&
    (result.analysisId !== shared.analysis.session.analysisId ||
      result.revisionId !== shared.analysis.activeRevisionId)
  ) {
    throw new Error("AG_UI_TOOL_RESULT_ANALYSIS_MISMATCH");
  }
  return updateToolCall(current, toolCallId, (toolCall) => ({
    ...toolCall,
    status: "RESULT",
    result,
  }));
}

function reduceToolArgs(
  current: AnalysisReferenceClientState,
  toolCallId: string,
  delta: string,
): AnalysisClientReduction {
  return updateToolCall(current, toolCallId, (toolCall) => {
    const argsText = toolCall.argsText + delta;
    if (Buffer.byteLength(argsText, "utf8") > 262_144) {
      throw new Error("AG_UI_TOOL_ARGS_TOO_LARGE");
    }
    return { ...toolCall, argsText, status: "ARGS" };
  });
}

function updateToolCall(
  current: AnalysisReferenceClientState,
  toolCallId: string,
  update: (toolCall: AnalysisClientToolCall) => AnalysisClientToolCall,
): AnalysisClientReduction {
  const toolCall = current.toolCallsById[toolCallId];
  if (toolCall === undefined) {
    throw new Error("AG_UI_TOOL_CALL_DEPENDENCY_MISSING");
  }
  return noEffect({
    ...current,
    toolCallsById: {
      ...current.toolCallsById,
      [toolCallId]: update(toolCall),
    },
  });
}

function appendText(
  current: AnalysisReferenceClientState,
  messageId: string,
  delta: string,
): AnalysisClientReduction {
  const existing = current.textByMessageId[messageId];
  if (existing === undefined) {
    throw new Error("AG_UI_TEXT_MESSAGE_DEPENDENCY_MISSING");
  }
  const text = existing + delta;
  if (Buffer.byteLength(text, "utf8") > 65_536) {
    throw new Error("AG_UI_TEXT_MESSAGE_TOO_LARGE");
  }
  return noEffect({
    ...current,
    textByMessageId: { ...current.textByMessageId, [messageId]: text },
  });
}

function appendTextChunk(
  current: AnalysisReferenceClientState,
  messageId: string,
  delta: string,
): AnalysisClientReduction {
  const initialized =
    current.textByMessageId[messageId] === undefined
      ? {
          ...current,
          textByMessageId: { ...current.textByMessageId, [messageId]: "" },
        }
      : current;
  return appendText(initialized, messageId, delta);
}

function decodeSseRecord(record: string): AGUIEvent[] {
  const data = record
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (data === "") return [];
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error("AG_UI_SSE_JSON_INVALID");
  }
  return [assertSacsAgUiEvent(value, SACS_AG_UI_V03_PROFILE_ID)];
}

function applyJsonPatch(
  document: unknown,
  operations: readonly unknown[],
): unknown {
  const current = structuredClone(document);
  for (const operationValue of operations) {
    if (!isRecord(operationValue)) throw new Error("JSON_PATCH_INVALID");
    const op = operationValue["op"];
    const path = operationValue["path"];
    if (
      typeof op !== "string" ||
      typeof path !== "string" ||
      !["add", "remove", "replace", "test"].includes(op)
    ) {
      throw new Error("JSON_PATCH_INVALID");
    }
    const segments = jsonPointerSegments(path);
    if (segments.length === 0) throw new Error("JSON_PATCH_ROOT_FORBIDDEN");
    const parent = resolveParent(current, segments);
    const key = segments.at(-1) as string;
    if (op === "test") {
      if (!sameJson(readChild(parent, key), operationValue["value"])) {
        throw new Error("JSON_PATCH_TEST_FAILED");
      }
      continue;
    }
    if (op === "remove") {
      removeChild(parent, key);
      continue;
    }
    if (!("value" in operationValue))
      throw new Error("JSON_PATCH_VALUE_MISSING");
    writeChild(
      parent,
      key,
      structuredClone(operationValue["value"]),
      op === "add",
    );
  }
  return current;
}

function jsonPointerSegments(path: string): string[] {
  if (!path.startsWith("/") || path.includes("__proto__")) {
    throw new Error("JSON_POINTER_INVALID");
  }
  return path
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"))
    .map((segment) => {
      if (segment === "prototype" || segment === "constructor") {
        throw new Error("JSON_POINTER_FORBIDDEN");
      }
      return segment;
    });
}

function resolveParent(root: unknown, segments: readonly string[]): unknown {
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = readChild(current, segment);
  }
  return current;
}

function readChild(parent: unknown, key: string): unknown {
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, false);
    return parent[index];
  }
  if (!isRecord(parent) || !Object.hasOwn(parent, key)) {
    throw new Error("JSON_PATCH_PATH_MISSING");
  }
  return parent[key];
}

function writeChild(
  parent: unknown,
  key: string,
  value: unknown,
  add: boolean,
): void {
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, add);
    if (add) parent.splice(index, 0, value);
    else {
      if (index >= parent.length) throw new Error("JSON_PATCH_PATH_MISSING");
      parent[index] = value;
    }
    return;
  }
  if (!isRecord(parent)) throw new Error("JSON_PATCH_PARENT_INVALID");
  if (!add && !Object.hasOwn(parent, key)) {
    throw new Error("JSON_PATCH_PATH_MISSING");
  }
  parent[key] = value;
}

function removeChild(parent: unknown, key: string): void {
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, false);
    if (index >= parent.length) throw new Error("JSON_PATCH_PATH_MISSING");
    parent.splice(index, 1);
    return;
  }
  if (!isRecord(parent) || !Object.hasOwn(parent, key)) {
    throw new Error("JSON_PATCH_PATH_MISSING");
  }
  delete parent[key];
}

function arrayIndex(key: string, length: number, allowEnd: boolean): number {
  if (allowEnd && key === "-") return length;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key))
    throw new Error("JSON_PATCH_INDEX_INVALID");
  const index = Number(key);
  if (
    !Number.isSafeInteger(index) ||
    index > length ||
    (!allowEnd && index === length)
  ) {
    throw new Error("JSON_PATCH_INDEX_INVALID");
  }
  return index;
}

function safePathId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw new Error("ANALYSIS_PATH_ID_INVALID");
  }
  return encodeURIComponent(value);
}

function safeResponseCode(value: unknown): string {
  if (isRecord(value) && isRecord(value["error"])) {
    const code = value["error"]["code"];
    if (typeof code === "string" && /^[A-Z0-9_]{1,128}$/u.test(code)) {
      return code;
    }
  }
  return "ANALYSIS_CONTROL_REQUEST_FAILED";
}

function requireStateSnapshot(
  current: AnalysisReferenceClientState,
): AnalysisClientReduction {
  return {
    state: { ...current, needsFullStateSnapshot: true },
    effects: ["REQUEST_FULL_STATE_SNAPSHOT"],
  };
}

function requireActivitySnapshot(
  current: AnalysisReferenceClientState,
): AnalysisClientReduction {
  return {
    state: { ...current, needsFullActivitySnapshot: true },
    effects: ["REQUEST_FULL_ACTIVITY_SNAPSHOT"],
  };
}

function noEffect(
  state: AnalysisReferenceClientState,
): AnalysisClientReduction {
  return { state, effects: [] };
}

function assertRunStartLineage(
  current: AnalysisReferenceClientState,
  event: Extract<AGUIEvent, { type: EventType.RUN_STARTED }>,
): void {
  if (current.runStatus !== "INTERRUPTED") return;
  if (
    event.threadId !== current.threadId ||
    event.runId === current.runId ||
    event.parentRunId !== current.runId
  ) {
    throw new Error("AG_UI_INTERRUPT_RESUME_LINEAGE_INVALID");
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
