import {
  ConversationModelError,
  type ConversationModel,
  type ConversationModelInput,
  type ConversationSummaryInput,
  type PublishedResultInput,
} from "../../../../packages/conversation-model/src/index.js";

import type { SecureTelemetry } from "./telemetry.js";

export function instrumentChatModel(
  model: ConversationModel,
  telemetry: SecureTelemetry,
): ConversationModel {
  const explainPublishedResult = model.explainPublishedResult?.bind(model);
  return {
    decideTurn: (input: ConversationModelInput) =>
      measure(telemetry, "decide_turn", () => model.decideTurn(input)),
    answerGeneral: (input: ConversationModelInput) =>
      measure(telemetry, "answer_general", () => model.answerGeneral(input)),
    summarize: (input: ConversationSummaryInput) =>
      measure(telemetry, "summarize", () => model.summarize(input)),
    ...(explainPublishedResult === undefined
      ? {}
      : {
          explainPublishedResult: (input: PublishedResultInput) =>
            measure(telemetry, "explain_result", () =>
              explainPublishedResult(input),
            ),
        }),
  };
}

async function measure<T>(
  telemetry: SecureTelemetry,
  operation: "decide_turn" | "answer_general" | "summarize" | "explain_result",
  invoke: () => Promise<T>,
): Promise<T> {
  const timed = telemetry.beginLlm(operation);
  try {
    const result = await invoke();
    timed.end("ok");
    telemetry.recordConversationModelRequest(operation, "ok");
    return result;
  } catch (error) {
    timed.end("error");
    telemetry.recordConversationModelRequest(operation, modelOutcome(error));
    throw error;
  }
}

function modelOutcome(
  error: unknown,
): "timeout" | "unavailable" | "invalid_response" | "invalid_output" | "error" {
  if (!(error instanceof ConversationModelError)) return "error";
  switch (error.code) {
    case "CONVERSATION_MODEL_TIMEOUT":
      return "timeout";
    case "CONVERSATION_MODEL_UNAVAILABLE":
      return "unavailable";
    case "CONVERSATION_MODEL_RESPONSE_INVALID":
      return "invalid_response";
    case "CONVERSATION_MODEL_OUTPUT_INVALID":
      return "invalid_output";
  }
}
