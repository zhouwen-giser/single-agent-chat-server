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

export const AG_UI_ROUTE = "/ag-ui";
export const AG_UI_CAPABILITIES_ROUTE = "/ag-ui/capabilities";
export const AG_UI_REQUEST_CONTENT_TYPE = "application/json";
export const AG_UI_SSE_CONTENT_TYPE = new EventEncoder({
  accept: "text/event-stream",
}).getContentType();

export const SACS_AG_UI_PROFILE = Object.freeze({
  version: "sacs-ag-ui-v0.2",
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

const allowedEventTypes = new Set<EventType>([
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

export function parseAgUiRunInput(input: unknown): RunAgentInput {
  return RunAgentInputSchema.parse(input);
}

export function parseAgUiInterrupt(input: unknown): Interrupt {
  return InterruptSchema.parse(input);
}

export function parseAgUiResumeEntry(input: unknown): ResumeEntry {
  return ResumeEntrySchema.parse(input);
}

export function assertSacsAgUiEvent(input: unknown): AGUIEvent {
  const event = EventSchemas.parse(input);
  if (!allowedEventTypes.has(event.type)) {
    throw new Error(
      `AG-UI event type is outside the SACS profile: ${event.type}`,
    );
  }
  return event;
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

export type { AGUIEvent, Interrupt, ResumeEntry, RunAgentInput };
