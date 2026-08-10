import type { SdarInteractionEvent } from "../../interaction-contract/src/index.js";

export async function* renderInteractionEventsForOpenAi(
  events: AsyncIterable<SdarInteractionEvent>,
): AsyncGenerator<string> {
  for await (const event of events) {
    const fragment = renderInteractionEventForOpenAi(event);
    if (fragment !== undefined && fragment.length > 0) yield fragment;
  }
}

export function renderInteractionEventForOpenAi(
  event: SdarInteractionEvent,
): string | undefined {
  if (
    [
      "message.text",
      "artifact.text",
      "task.status_changed",
      "input.required",
      "capability.gap",
      "observation.ended",
    ].includes(event.eventType)
  ) {
    return typeof event.payload.text === "string"
      ? event.payload.text
      : undefined;
  }
  if (event.eventType === "artifact.data") {
    return event.payload.data === undefined
      ? undefined
      : `\`\`\`json\n${JSON.stringify(event.payload.data)}\n\`\`\``;
  }
  if (event.eventType === "artifact.reference") {
    const label =
      typeof event.payload.label === "string"
        ? event.payload.label
        : "Published artifact reference";
    const uri =
      typeof event.payload.uri === "string" ? event.payload.uri : undefined;
    return uri === undefined ? label : `${label}: ${uri}`;
  }
  if (event.eventType === "run.error") {
    return "The SDAR operation failed safely. No internal protocol details were exposed.";
  }
  return undefined;
}
