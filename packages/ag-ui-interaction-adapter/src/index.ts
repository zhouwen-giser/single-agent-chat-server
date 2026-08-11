import {
  AgentCapabilitiesSchema,
  EventType,
  type AgentCapabilities,
} from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";

import {
  assertSacsAgUiEvent,
  type AGUIEvent,
  type RunAgentInput,
} from "../../ag-ui-api-contract/src/index.js";
import { safePublicText } from "../../interaction-contract/src/index.js";

export * from "./event-projection.js";

const sseEncoder = new EventEncoder({ accept: "text/event-stream" });

export interface AgUiRunContext {
  readonly input: RunAgentInput;
  readonly principalId: string;
  readonly internalThreadId: string;
  readonly signal: AbortSignal;
}

export type AgUiRunHandler = (
  context: AgUiRunContext,
) => AsyncIterable<AGUIEvent>;

export interface TextAgUiAnswerContext {
  readonly userText: string;
  readonly principalId: string;
  readonly internalThreadId: string;
  readonly externalThreadId: string;
  readonly runId: string;
  readonly signal: AbortSignal;
}

export function createTextAgUiRunHandler(
  answer: (context: TextAgUiAnswerContext) => Promise<string>,
): AgUiRunHandler {
  return async function* run(context) {
    yield profileEvent({
      type: EventType.RUN_STARTED,
      threadId: context.input.threadId,
      runId: context.input.runId,
    });
    const text = safePublicText(
      await answer({
        userText: lastUserText(context.input),
        principalId: context.principalId,
        internalThreadId: context.internalThreadId,
        externalThreadId: context.input.threadId,
        runId: context.input.runId,
        signal: context.signal,
      }),
    );
    if (context.signal.aborted) return;
    const messageId = `${context.input.runId}:assistant`;
    yield profileEvent({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    });
    if (text !== undefined) {
      yield profileEvent({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: text,
      });
    }
    yield profileEvent({ type: EventType.TEXT_MESSAGE_END, messageId });
    yield profileEvent({
      type: EventType.RUN_FINISHED,
      threadId: context.input.threadId,
      runId: context.input.runId,
      outcome: { type: "success" },
    });
  };
}

export function createUnavailableAgUiRunHandler(): AgUiRunHandler {
  return async function* unavailable(context) {
    yield profileEvent({
      type: EventType.RUN_STARTED,
      threadId: context.input.threadId,
      runId: context.input.runId,
    });
    yield createSafeAgUiRunError("AG-UI interaction execution is unavailable.");
  };
}

export function createSafeAgUiRunError(
  message = "The AG-UI run failed safely.",
  code = "interaction_error",
): AGUIEvent {
  return profileEvent({
    type: EventType.RUN_ERROR,
    message: safePublicText(message, 512) ?? "The AG-UI run failed safely.",
    code,
  });
}

export function encodeProfileAgUiSse(event: AGUIEvent): string {
  return sseEncoder.encodeSSE(assertSacsAgUiEvent(event));
}

export function createSacsAgUiCapabilities(): AgentCapabilities {
  return AgentCapabilitiesSchema.parse({
    identity: {
      name: "single-agent-chat-server",
      type: "langgraph",
      description: "Single-SDAR interaction gateway",
      version: "0.2.0",
      provider: "single-agent-chat-server",
    },
    transport: {
      streaming: true,
      websocket: false,
      httpBinary: false,
      pushNotifications: false,
      resumable: false,
    },
    tools: {
      supported: false,
      clientProvided: false,
      parallelCalls: false,
      items: [],
    },
    output: {
      structuredOutput: true,
      supportedMimeTypes: ["text/plain", "application/json"],
    },
    state: {
      snapshots: true,
      deltas: true,
      memory: false,
      persistentState: true,
    },
    multiAgent: {
      supported: false,
      delegation: false,
      handoffs: false,
      subAgents: [],
    },
    reasoning: {
      supported: false,
      streaming: false,
      encrypted: false,
    },
    humanInTheLoop: {
      supported: true,
      approvals: true,
      interventions: true,
      feedback: false,
      interrupts: true,
      approveWithEdits: false,
    },
    custom: {
      sacsProfile: "sacs-ag-ui-v0.2",
      rawEvents: false,
      inferredToolCalls: false,
      runIsTask: false,
      taskResubscription: false,
      eventCursor: false,
    },
  });
}

function profileEvent(input: unknown): AGUIEvent {
  return assertSacsAgUiEvent(input);
}

function lastUserText(input: RunAgentInput): string {
  const message = [...input.messages]
    .reverse()
    .find((candidate) => candidate.role === "user");
  return typeof message?.content === "string" ? message.content : "";
}
