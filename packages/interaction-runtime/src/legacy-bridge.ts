import {
  InteractionEventFactory,
  type PublicJsonValue,
  type SdarInteractionEvent,
} from "../../interaction-contract/src/index.js";
import {
  verifyWorldExplanationHash,
  type WorldExplanationV1,
} from "../../world-explanation-contract/src/index.js";

export interface WorldExplanationChatResult {
  readonly kind: "world_explanation";
  readonly explanation: WorldExplanationV1;
}

export type LegacyChatResult =
  string | AsyncIterable<string> | WorldExplanationChatResult;

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
    if (isWorldExplanationChatResult(result)) {
      for (const event of worldExplanationInteractionEvents(
        factory,
        result.explanation,
      )) {
        yield event;
      }
      const finished = factory.create("run.finished", {
        reason: "world_explanation_complete",
        taskTerminal: false,
      });
      if (finished !== undefined) yield finished;
      return;
    }
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

export function isWorldExplanationChatResult(
  value: LegacyChatResult,
): value is WorldExplanationChatResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "world_explanation" &&
    "explanation" in value
  );
}

export function worldExplanationInteractionEvents(
  factory: InteractionEventFactory,
  value: WorldExplanationV1,
): readonly SdarInteractionEvent[] {
  const explanation = verifyWorldExplanationHash(value);
  const identity = {
    explanationId: explanation.explanationId,
    explanationHash: explanation.explanationHash,
    groundingId: explanation.grounding.groundingId,
    groundingResultHash: explanation.grounding.resultHash,
  };
  return [
    factory.publicText(explanation.renderedText, {
      dedupeKey: `world-explanation-text:${explanation.explanationHash}`,
    }),
    factory.create(
      "world.explanation",
      asPublicRecord({ ...identity, explanation }),
      { dedupeKey: `world-explanation:${explanation.explanationHash}` },
    ),
    factory.create(
      "world.map_projection",
      asPublicRecord({
        ...identity,
        mapProjection: explanation.mapProjection ?? null,
      }),
      { dedupeKey: `world-map:${explanation.explanationHash}` },
    ),
    factory.create(
      "world.source_products",
      asPublicRecord({
        ...identity,
        sourceProducts: explanation.sourceProducts,
      }),
      { dedupeKey: `world-sources:${explanation.explanationHash}` },
    ),
  ].filter((event): event is SdarInteractionEvent => event !== undefined);
}

async function* toLegacyFragments(
  result: LegacyChatResult,
): AsyncGenerator<string> {
  if (typeof result === "string") {
    yield result;
    return;
  }
  if (isWorldExplanationChatResult(result)) return;
  yield* result;
}

function asPublicRecord(
  value: unknown,
): Readonly<Record<string, PublicJsonValue>> {
  return JSON.parse(JSON.stringify(value)) as Record<string, PublicJsonValue>;
}
