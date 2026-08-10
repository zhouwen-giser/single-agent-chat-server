import {
  InteractionEventFactory,
  type SdarInteractionEvent,
} from "../../interaction-contract/src/index.js";

export type LegacyChatResult = string | AsyncIterable<string>;

export async function* legacyChatResultToInteractionEvents(
  result: LegacyChatResult,
  input: { readonly runId: string; readonly threadId: string },
): AsyncGenerator<SdarInteractionEvent> {
  const factory = new InteractionEventFactory(input);
  const started = factory.create("run.started", {
    boundary: "bounded_interaction",
  });
  if (started !== undefined) yield started;

  try {
    let index = 0;
    for await (const fragment of toLegacyFragments(result)) {
      const event = factory.publicText(fragment, {
        dedupeKey: `legacy:${index++}`,
      });
      if (event !== undefined) yield event;
    }
    const finished = factory.create("run.finished", {
      reason: "observation_complete",
      taskTerminal: false,
    });
    if (finished !== undefined) yield finished;
  } catch {
    const failed = factory.create("run.error", {
      message:
        "The SDAR operation failed safely. No internal protocol details were exposed.",
    });
    if (failed !== undefined) yield failed;
  }
}

async function* toLegacyFragments(
  result: LegacyChatResult,
): AsyncGenerator<string> {
  if (typeof result === "string") {
    yield result;
    return;
  }
  yield* result;
}
