import type { StructuredChatModel } from "../../../../src/agent/model.js";

import type { SecureTelemetry } from "./telemetry.js";

export function instrumentChatModel(
  model: StructuredChatModel,
  telemetry: SecureTelemetry,
): StructuredChatModel {
  return {
    classify: (input) =>
      measure(telemetry, "classify", () => model.classify(input)),
    answer: (input) => measure(telemetry, "answer", () => model.answer(input)),
  };
}

async function measure<T>(
  telemetry: SecureTelemetry,
  operation: "classify" | "answer",
  invoke: () => Promise<T>,
): Promise<T> {
  const timed = telemetry.beginLlm(operation);
  try {
    const result = await invoke();
    timed.end("ok");
    return result;
  } catch (error) {
    timed.end("error");
    throw error;
  }
}
