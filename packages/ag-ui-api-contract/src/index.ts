import {
  EventSchemas,
  EventType,
  InterruptSchema,
  ResumeEntrySchema,
  RunAgentInputSchema,
  type AGUIEvent,
  type Interrupt,
  type ResumeEntry,
  type RunAgentInput,
} from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import { z } from "zod";

export const AG_UI_ROUTE = "/ag-ui";
export const AG_UI_CAPABILITIES_ROUTE = "/ag-ui/capabilities";
export const AG_UI_REQUEST_CONTENT_TYPE = "application/json";
export const AG_UI_PROFILE_HEADER = "x-sacs-ag-ui-profile";
export const AG_UI_SSE_CONTENT_TYPE = new EventEncoder({
  accept: "text/event-stream",
}).getContentType();

export const SACS_AG_UI_V02_PROFILE_ID = "sacs-ag-ui-v0.2" as const;
export const SACS_AG_UI_V03_PROFILE_ID = "sacs-ag-ui-v0.3" as const;
export type SacsAgUiProfileId =
  typeof SACS_AG_UI_V02_PROFILE_ID | typeof SACS_AG_UI_V03_PROFILE_ID;

export const SACS_AG_UI_PROFILE = Object.freeze({
  version: SACS_AG_UI_V02_PROFILE_ID,
  transport: "HTTP_POST_SSE",
  runIsTask: false,
  rawEvents: false,
  inferredToolCalls: false,
  stateDelta: "RFC6902",
  authentication: Object.freeze({
    serviceCredential: "Authorization: Bearer",
    principalCredential: "X-OpenWebUI-User-Jwt",
  }),
});

export const SACS_AG_UI_V03_PROFILE = Object.freeze({
  version: SACS_AG_UI_V03_PROFILE_ID,
  backwardCompatibleProfile: SACS_AG_UI_V02_PROFILE_ID,
  transport: "HTTP_POST_SSE",
  eventFamilies: Object.freeze([
    "RUN",
    "STEP",
    "TOOL_CALL",
    "TEXT_MESSAGE",
    "STATE",
    "ACTIVITY",
  ]),
  stateDelta: "RFC6902_REVISION_GUARDED",
  toolResultPolicy: "BOUNDED_SUMMARY_AND_IDS_ONLY",
  resumable: false,
});

const allowedV02EventTypes = new Set<EventType>([
  EventType.RUN_STARTED,
  EventType.RUN_FINISHED,
  EventType.RUN_ERROR,
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_END,
  EventType.TEXT_MESSAGE_CHUNK,
  EventType.STATE_SNAPSHOT,
  EventType.STATE_DELTA,
  EventType.ACTIVITY_SNAPSHOT,
  EventType.ACTIVITY_DELTA,
  EventType.CUSTOM,
]);

const allowedV03EventTypes = new Set<EventType>([
  EventType.RUN_STARTED,
  EventType.RUN_FINISHED,
  EventType.RUN_ERROR,
  EventType.STEP_STARTED,
  EventType.STEP_FINISHED,
  EventType.TOOL_CALL_START,
  EventType.TOOL_CALL_ARGS,
  EventType.TOOL_CALL_END,
  EventType.TOOL_CALL_RESULT,
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_END,
  EventType.TEXT_MESSAGE_CHUNK,
  EventType.STATE_SNAPSHOT,
  EventType.STATE_DELTA,
  EventType.ACTIVITY_SNAPSHOT,
  EventType.ACTIVITY_DELTA,
]);

const publicIdentifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export const sacsAgUiToolResultContentSchema = z.strictObject({
  schemaVersion: z.literal("sacs-ag-ui-tool-result/1.0"),
  status: z.enum(["COMPLETED", "PARTIAL", "NO_DATA", "FAILED"]),
  summary: z.string().min(1).max(2_000),
  analysisId: publicIdentifier,
  revisionId: publicIdentifier,
  runId: publicIdentifier,
  nodeId: publicIdentifier,
  findingIds: z.array(publicIdentifier).max(64),
  layerIds: z.array(publicIdentifier).max(64),
  evidenceItemIds: z.array(publicIdentifier).max(128),
});

export type SacsAgUiToolResultContent = z.infer<
  typeof sacsAgUiToolResultContentSchema
>;

export class SacsAgUiProfileNegotiationError extends Error {
  constructor(readonly requestedProfile: string) {
    super("AG_UI_PROFILE_NOT_SUPPORTED");
  }
}

export function negotiateSacsAgUiProfile(
  requestedProfile: string | undefined,
): SacsAgUiProfileId {
  const normalized = requestedProfile?.trim();
  if (normalized === undefined || normalized === "") {
    return SACS_AG_UI_V02_PROFILE_ID;
  }
  if (
    normalized === SACS_AG_UI_V02_PROFILE_ID ||
    normalized === SACS_AG_UI_V03_PROFILE_ID
  ) {
    return normalized;
  }
  throw new SacsAgUiProfileNegotiationError(normalized);
}

export function parseAgUiRunInput(input: unknown): RunAgentInput {
  return RunAgentInputSchema.parse(input);
}

export function parseAgUiInterrupt(input: unknown): Interrupt {
  return InterruptSchema.parse(input);
}

export function parseAgUiResumeEntry(input: unknown): ResumeEntry {
  return ResumeEntrySchema.parse(input);
}

export function assertSacsAgUiEvent(
  input: unknown,
  profile: SacsAgUiProfileId = SACS_AG_UI_V02_PROFILE_ID,
): AGUIEvent {
  const event = EventSchemas.parse(input);
  const allowed =
    profile === SACS_AG_UI_V03_PROFILE_ID
      ? allowedV03EventTypes
      : allowedV02EventTypes;
  if (!allowed.has(event.type)) {
    throw new Error(
      profile === SACS_AG_UI_V02_PROFILE_ID
        ? `AG-UI event type is outside the SACS profile: ${event.type}`
        : `AG-UI event type is outside ${profile}: ${event.type}`,
    );
  }
  if (profile === SACS_AG_UI_V03_PROFILE_ID) assertV03EventSafety(event);
  return event;
}

export function parseSacsAgUiToolResultContent(
  content: string,
): SacsAgUiToolResultContent {
  if (Buffer.byteLength(content, "utf8") > 8_192) {
    throw new Error("AG_UI_TOOL_RESULT_TOO_LARGE");
  }
  try {
    return sacsAgUiToolResultContentSchema.parse(JSON.parse(content));
  } catch {
    throw new Error("AG_UI_TOOL_RESULT_INVALID");
  }
}

export function acceptsAgUiSse(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === "") return true;
  return accept
    .split(",")
    .map((part) => part.split(";", 1)[0]?.trim().toLowerCase())
    .some(
      (mediaType) => mediaType === "*/*" || mediaType === "text/event-stream",
    );
}

export function acceptsAgUiJson(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" || mediaType?.endsWith("+json") === true
  );
}

function assertV03EventSafety(event: AGUIEvent): void {
  const value = event as unknown as Readonly<Record<string, unknown>>;
  if (value["rawEvent"] !== undefined) {
    throw new Error("AG-UI v0.3 rawEvent is forbidden");
  }
  if (event.type === EventType.TOOL_CALL_RESULT) {
    parseSacsAgUiToolResultContent(event.content);
    const allowedKeys = new Set([
      "type",
      "timestamp",
      "messageId",
      "toolCallId",
      "content",
      "role",
    ]);
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
      throw new Error("AG-UI v0.3 tool result contains undeclared fields");
    }
  }
  if (event.type === EventType.STATE_SNAPSHOT) {
    assertStateRevisionSnapshot(event.snapshot);
  }
  if (event.type === EventType.STATE_DELTA) {
    const first = event.delta[0] as unknown;
    if (
      !isRecord(first) ||
      first["op"] !== "test" ||
      first["path"] !== "/meta/stateRevision" ||
      !Number.isSafeInteger(first["value"]) ||
      (first["value"] as number) < 0
    ) {
      throw new Error("AG_UI_STATE_DELTA_REVISION_GUARD_REQUIRED");
    }
  }
  if (event.type === EventType.ACTIVITY_SNAPSHOT) {
    const content = event.content;
    if (
      !isRecord(content) ||
      !isRecord(content["meta"]) ||
      !Number.isSafeInteger(content["meta"]["activityRevision"]) ||
      (content["meta"]["activityRevision"] as number) < 0
    ) {
      throw new Error("AG_UI_ACTIVITY_SNAPSHOT_REVISION_REQUIRED");
    }
  }
  if (event.type === EventType.ACTIVITY_DELTA) {
    const first = event.patch[0] as unknown;
    if (
      !isRecord(first) ||
      first["op"] !== "test" ||
      first["path"] !== "/meta/activityRevision" ||
      !Number.isSafeInteger(first["value"]) ||
      (first["value"] as number) < 0
    ) {
      throw new Error("AG_UI_ACTIVITY_DELTA_REVISION_GUARD_REQUIRED");
    }
  }
}

function assertStateRevisionSnapshot(snapshot: unknown): void {
  if (
    !isRecord(snapshot) ||
    !isRecord(snapshot["meta"]) ||
    !Number.isSafeInteger(snapshot["meta"]["stateRevision"]) ||
    (snapshot["meta"]["stateRevision"] as number) < 0
  ) {
    throw new Error("AG_UI_STATE_SNAPSHOT_REVISION_REQUIRED");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type { AGUIEvent, Interrupt, ResumeEntry, RunAgentInput };
