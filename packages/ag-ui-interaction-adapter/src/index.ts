import {
  AgentCapabilitiesSchema,
  EventType,
  type AgentCapabilities,
} from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";

import {
  assertSacsAgUiEvent,
  SACS_AG_UI_V02_PROFILE_ID,
  SACS_AG_UI_V03_PROFILE_ID,
  type AGUIEvent,
  type RunAgentInput,
  type SacsAgUiProfileId,
} from "../../ag-ui-api-contract/src/index.js";
import { safePublicText } from "../../interaction-contract/src/index.js";

export * from "./event-projection.js";

const sseEncoder = new EventEncoder({ accept: "text/event-stream" });

export interface AgUiRunContext {
  readonly input: RunAgentInput;
  readonly principalId: string;
  readonly internalThreadId: string;
  readonly signal: AbortSignal;
  readonly profile?: SacsAgUiProfileId;
  readonly disconnectSemantics?: "DETACH_OBSERVER";
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
    const profile = context.profile ?? SACS_AG_UI_V02_PROFILE_ID;
    yield profileEvent(
      {
        type: EventType.RUN_STARTED,
        threadId: context.input.threadId,
        runId: context.input.runId,
      },
      profile,
    );
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
    yield profileEvent(
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      },
      profile,
    );
    if (text !== undefined) {
      yield profileEvent(
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: text,
        },
        profile,
      );
    }
    yield profileEvent(
      { type: EventType.TEXT_MESSAGE_END, messageId },
      profile,
    );
    yield profileEvent(
      {
        type: EventType.RUN_FINISHED,
        threadId: context.input.threadId,
        runId: context.input.runId,
        outcome: { type: "success" },
      },
      profile,
    );
  };
}

export function createUnavailableAgUiRunHandler(): AgUiRunHandler {
  return async function* unavailable(context) {
    const profile = context.profile ?? SACS_AG_UI_V02_PROFILE_ID;
    yield profileEvent(
      {
        type: EventType.RUN_STARTED,
        threadId: context.input.threadId,
        runId: context.input.runId,
      },
      profile,
    );
    yield createSafeAgUiRunError(
      "AG-UI interaction execution is unavailable.",
      "interaction_error",
      profile,
    );
  };
}

export function createSafeAgUiRunError(
  message = "The AG-UI run failed safely.",
  code = "interaction_error",
  profile: SacsAgUiProfileId = SACS_AG_UI_V02_PROFILE_ID,
): AGUIEvent {
  return profileEvent(
    {
      type: EventType.RUN_ERROR,
      message: safePublicText(message, 512) ?? "The AG-UI run failed safely.",
      code,
    },
    profile,
  );
}

export function encodeProfileAgUiSse(
  event: AGUIEvent,
  profile: SacsAgUiProfileId = SACS_AG_UI_V02_PROFILE_ID,
): string {
  return sseEncoder.encodeSSE(assertSacsAgUiEvent(event, profile));
}

export function createSacsAgUiCapabilities(
  profile: SacsAgUiProfileId = SACS_AG_UI_V02_PROFILE_ID,
): AgentCapabilities {
  const v03 = profile === SACS_AG_UI_V03_PROFILE_ID;
  return AgentCapabilitiesSchema.parse({
    identity: {
      name: "single-agent-chat-server",
      type: "langgraph",
      description: "Single-SDAR interaction gateway",
      version: v03 ? "0.3.0" : "0.2.0",
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
      supported: v03,
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
      approveWithEdits: v03,
    },
    custom: {
      sacsProfile: profile,
      backwardCompatibleProfile: v03 ? SACS_AG_UI_V02_PROFILE_ID : undefined,
      eventFamilies: v03
        ? ["RUN", "STEP", "TOOL_CALL", "TEXT_MESSAGE", "STATE", "ACTIVITY"]
        : undefined,
      rawEvents: false,
      inferredToolCalls: false,
      runIsTask: false,
      taskResubscription: false,
      eventCursor: false,
    },
  });
}

function profileEvent(
  input: unknown,
  profile: SacsAgUiProfileId = SACS_AG_UI_V02_PROFILE_ID,
): AGUIEvent {
  return assertSacsAgUiEvent(input, profile);
}

function lastUserText(input: RunAgentInput): string {
  const message = [...input.messages]
    .reverse()
    .find((candidate) => candidate.role === "user");
  return typeof message?.content === "string" ? message.content : "";
}
