import {
  InteractionEventFactory,
  safePublicStatusText,
  type PublicJsonValue,
  type SdarInteractionEvent,
} from "../../interaction-contract/src/index.js";
import {
  verifyWorldExplanationHash,
  type WorldExplanationV1,
} from "../../world-explanation-contract/src/index.js";
import {
  parseAuthorityFusionResultV2,
  type AuthorityFusionResultV2,
} from "../../authority-fusion/src/index.js";
import {
  authoritySeparatedPresentationSchema,
  type AuthoritySeparatedPresentation,
} from "../../geospatial-explanation-policy/src/index.js";

export interface WorldExplanationChatResult {
  readonly kind: "world_explanation";
  readonly explanation: WorldExplanationV1;
  readonly renderedText?: string;
  readonly authorityPresentation?: AuthoritySeparatedPresentation;
  readonly authorityFusion?: AuthorityFusionResultV2;
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
        result,
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
  options: Pick<
    WorldExplanationChatResult,
    "renderedText" | "authorityPresentation" | "authorityFusion"
  > = {},
): readonly SdarInteractionEvent[] {
  const explanation = verifyWorldExplanationHash(value);
  const hybrid = validateHybridProjection(explanation, options);
  const identity = {
    explanationId: explanation.explanationId,
    explanationHash: explanation.explanationHash,
    groundingId: explanation.grounding.groundingId,
    groundingResultHash: explanation.grounding.resultHash,
  };
  return [
    factory.publicText(hybrid?.renderedText ?? explanation.renderedText, {
      dedupeKey: `world-explanation-text:${explanation.explanationHash}`,
    }),
    factory.create(
      "world.explanation",
      asPublicRecord({
        ...identity,
        explanation,
        ...(hybrid === undefined
          ? {}
          : {
              authorityPresentation: hybrid.authorityPresentation,
              authorityFusion: hybrid.authorityFusion,
            }),
      }),
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

function validateHybridProjection(
  explanation: WorldExplanationV1,
  options: Pick<
    WorldExplanationChatResult,
    "renderedText" | "authorityPresentation" | "authorityFusion"
  >,
):
  | {
      readonly renderedText: string;
      readonly authorityPresentation: AuthoritySeparatedPresentation;
      readonly authorityFusion: AuthorityFusionResultV2;
    }
  | undefined {
  const hasPresentation = options.authorityPresentation !== undefined;
  const hasFusion = options.authorityFusion !== undefined;
  if (!hasPresentation && !hasFusion) {
    if (options.renderedText !== undefined) {
      throw new Error("renderedText override requires hybrid authority data");
    }
    return undefined;
  }
  if (!hasPresentation || !hasFusion || options.renderedText === undefined) {
    throw new Error("hybrid authority projection is incomplete");
  }
  const parsedPresentation = authoritySeparatedPresentationSchema.parse(
    options.authorityPresentation,
  );
  const parsedAuthorityFusion = parseAuthorityFusionResultV2(
    options.authorityFusion,
  );
  const { internalPhase: ignoredInternalPhase, ...publicTask } =
    parsedAuthorityFusion.task;
  void ignoredInternalPhase;
  const safeInternalPhase = safePublicStatusText(
    parsedAuthorityFusion.task.internalPhase,
    128,
  );
  const authorityFusion = parseAuthorityFusionResultV2({
    ...parsedAuthorityFusion,
    task: {
      ...publicTask,
      ...(safeInternalPhase === undefined
        ? {}
        : { internalPhase: safeInternalPhase }),
    },
  });
  const worldSection = parsedPresentation.sections[1];
  if (
    worldSection.content !== explanation.renderedText ||
    authorityFusion.reality.groundingId !== explanation.grounding.groundingId ||
    authorityFusion.reality.resultHash !== explanation.grounding.resultHash
  ) {
    throw new Error("hybrid authority projection identity mismatch");
  }
  if (
    options.renderedText !== renderAuthorityPresentation(parsedPresentation)
  ) {
    throw new Error("hybrid authority rendered text mismatch");
  }
  const safeTaskContent = safePublicStatusText(
    parsedPresentation.sections[0].content,
    16_000,
  );
  const authorityPresentation = authoritySeparatedPresentationSchema.parse({
    ...parsedPresentation,
    sections: [
      {
        ...parsedPresentation.sections[0],
        content:
          safeTaskContent ??
          "SDAR published Task/Plan status text is unavailable.",
      },
      parsedPresentation.sections[1],
      parsedPresentation.sections[2],
    ],
  });
  return {
    renderedText: renderAuthorityPresentation(authorityPresentation),
    authorityPresentation,
    authorityFusion,
  };
}

function renderAuthorityPresentation(
  value: AuthoritySeparatedPresentation,
): string {
  return value.sections
    .map(
      ({ section, authority, content }) =>
        "[" + section + " | " + authority + "]\n" + content,
    )
    .join("\n\n");
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
