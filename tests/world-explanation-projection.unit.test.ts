import { EventType, type AGUIEvent } from "@ag-ui/core";
import { describe, expect, it } from "@jest/globals";

import { renderInteractionEventsForAgUi } from "../packages/ag-ui-interaction-adapter/src/index.js";
import {
  legacyChatResultToInteractionEvents,
  type WorldExplanationChatResult,
} from "../packages/interaction-runtime/src/index.js";
import { renderInteractionEventsForOpenAi } from "../packages/openai-interaction-adapter/src/index.js";
import {
  finalizeWorldExplanation,
  type WorldExplanationV1,
} from "../packages/world-explanation-contract/src/index.js";
import { hybridWorldExplanationFixture } from "./fixtures/hybrid-world-explanation.js";

describe("WorldExplanation protocol projections", () => {
  it("projects one persisted explanation to OpenAI text and ordered typed events", async () => {
    const explanation = fixtureExplanation();
    const result: WorldExplanationChatResult = {
      kind: "world_explanation",
      explanation,
    };
    const interactionEvents = await collect(
      legacyChatResultToInteractionEvents(result, {
        runId: "run-world-1",
        threadId: "thread-world-1",
      }),
    );

    expect(interactionEvents.map(({ eventType }) => eventType)).toEqual([
      "run.started",
      "message.text",
      "world.explanation",
      "world.map_projection",
      "world.source_products",
      "run.finished",
    ]);
    const openAiText = (
      await collect(
        renderInteractionEventsForOpenAi(iterable(interactionEvents)),
      )
    ).join("");
    expect(openAiText).toBe(explanation.renderedText);
    expect(interactionEvents.at(-1)?.eventType).toBe("run.finished");
  });

  it("emits all AG-UI projections with the same explanation and grounding identity", async () => {
    const explanation = fixtureExplanation();
    const interactionEvents = legacyChatResultToInteractionEvents(
      { kind: "world_explanation", explanation },
      { runId: "run-world-2", threadId: "thread-world-2" },
    );
    const projected = await collect(
      renderInteractionEventsForAgUi(interactionEvents),
    );
    const custom = projected.filter(
      (event): event is AGUIEvent & { name: string; value: unknown } =>
        event.type === EventType.CUSTOM &&
        "name" in event &&
        typeof event.name === "string" &&
        "value" in event,
    );

    expect(custom.map(({ name }) => name)).toEqual([
      "sacs.world-explanation.v1",
      "sacs.map-projection.v1",
      "sacs.world-source-products.v1",
    ]);
    for (const event of custom) {
      expect(event.value).toEqual(
        expect.objectContaining({
          explanationId: explanation.explanationId,
          explanationHash: explanation.explanationHash,
          groundingId: explanation.grounding.groundingId,
          groundingResultHash: explanation.grounding.resultHash,
        }),
      );
    }
    expect(JSON.stringify(custom)).not.toContain("assetUri");
    expect(projected.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("publishes an explicit null map projection without inventing geometry", async () => {
    const base = fixtureExplanation();
    const {
      mapProjection: ignored,
      explanationHash: ignoredHash,
      ...draft
    } = base;
    void ignored;
    void ignoredHash;
    const explanation = finalizeWorldExplanation(draft);
    const events = await collect(
      legacyChatResultToInteractionEvents(
        { kind: "world_explanation", explanation },
        { runId: "run-world-3", threadId: "thread-world-3" },
      ),
    );
    const map = events.find(
      ({ eventType }) => eventType === "world.map_projection",
    );

    expect(map?.payload.mapProjection).toBeNull();
    expect(JSON.stringify(map?.payload)).not.toContain("coordinates");
  });

  it("projects one validated hybrid object identically to OpenAI and AG-UI", async () => {
    const result = hybridWorldExplanationFixture(fixtureExplanation());
    const interactionEvents = await collect(
      legacyChatResultToInteractionEvents(result, {
        runId: "run-world-hybrid-1",
        threadId: "thread-world-hybrid-1",
      }),
    );
    const worldEvent = interactionEvents.find(
      ({ eventType }) => eventType === "world.explanation",
    );
    const mapEvent = interactionEvents.find(
      ({ eventType }) => eventType === "world.map_projection",
    );
    const sourceEvent = interactionEvents.find(
      ({ eventType }) => eventType === "world.source_products",
    );
    const openAiText = (
      await collect(
        renderInteractionEventsForOpenAi(iterable(interactionEvents)),
      )
    ).join("");
    const agUi = await collect(
      renderInteractionEventsForAgUi(iterable(interactionEvents)),
    );
    const agUiWorld = agUi.find(
      (event): event is AGUIEvent & { name: string; value: unknown } =>
        event.type === EventType.CUSTOM &&
        "name" in event &&
        event.name === "sacs.world-explanation.v1" &&
        "value" in event,
    );

    expect(openAiText).toBe(result.renderedText);
    expect(worldEvent?.payload).toEqual(
      expect.objectContaining({
        explanation: result.explanation,
        authorityPresentation: result.authorityPresentation,
        authorityFusion: result.authorityFusion,
      }),
    );
    expect(agUiWorld?.value).toEqual(worldEvent?.payload);
    const findingEvidenceIds = new Set(
      result.explanation.findings.flatMap(
        ({ evidenceItemIds }) => evidenceItemIds ?? [],
      ),
    );
    expect(
      result.authorityFusion?.checks.flatMap(
        ({ evidenceItemIds }) => evidenceItemIds,
      ),
    ).toEqual(expect.not.arrayContaining([...findingEvidenceIds]));
    for (const event of [worldEvent, mapEvent, sourceEvent]) {
      expect(event?.payload).toEqual(
        expect.objectContaining({
          explanationId: result.explanation.explanationId,
          explanationHash: result.explanation.explanationHash,
          groundingId: result.explanation.grounding.groundingId,
          groundingResultHash: result.explanation.grounding.resultHash,
        }),
      );
    }
    expect(mapEvent?.payload).not.toHaveProperty("authorityFusion");
    expect(sourceEvent?.payload).not.toHaveProperty("authorityPresentation");
  });

  it("fails closed when hybrid authority optional fields are only partially present", async () => {
    const complete = hybridWorldExplanationFixture(fixtureExplanation());
    const { authorityFusion: ignored, ...partial } = complete;
    void ignored;
    const interactionEvents = await collect(
      legacyChatResultToInteractionEvents(partial, {
        runId: "run-world-hybrid-partial",
        threadId: "thread-world-hybrid-partial",
      }),
    );

    expect(interactionEvents.map(({ eventType }) => eventType)).toEqual([
      "run.started",
      "run.error",
    ]);
    expect(interactionEvents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "message.text" }),
        expect.objectContaining({ eventType: "world.explanation" }),
      ]),
    );
  });
});

function fixtureExplanation(): WorldExplanationV1 {
  return finalizeWorldExplanation({
    schemaVersion: "sacs-world-explanation/1.0",
    explanationId: "world-explanation-projection-1",
    locale: "en",
    grounding: {
      groundingId: "grounding-projection-1",
      resultHash: sha("1"),
      status: "COMPLETED",
    },
    explanationStatus: "COMPLETE",
    questionKind: "FEATURES_NEARBY",
    renderedText: "According to the current data, one object was found.",
    findings: [
      {
        findingId: "finding-projection-1",
        findingKind: "SPATIAL_FEATURE_COLLECTION",
        semanticConcept: "VEHICLE",
        headline: "According to the current data, one object was found.",
        details: [],
        returnedCount: 1,
        truncated: false,
        featureSummaries: [
          {
            featureId: "feature-projection-1",
            displayName: "Vehicle 2",
            referenceKey: referenceKey(),
          },
        ],
        evidenceItemIds: ["evidence-projection-1"],
        sourceProductIds: ["source-projection-1"],
      },
    ],
    references: [
      {
        productId: "reference-projection-1",
        displayName: "Vehicle 2",
        referenceKey: referenceKey(),
        sourceWorldVersion: 7,
      },
    ],
    sourceProducts: [
      {
        sourceProductId: "source-projection-1",
        authority: "GDPS_CURRENT_PRODUCT",
        productId: "gdps-current-projection-1",
        productType: "VEHICLE_CATALOG",
        productProfile: "CURRENT",
        contentHash: sha("2"),
        descriptorId: "VEHICLE_CATALOG/CURRENT",
        descriptorHash: sha("3"),
        qualitySummary: { valueAccuracyDegree: 1.5 },
      },
    ],
    gaps: [],
    mapProjection: {
      schemaVersion: "sacs-map-projection/1.0",
      features: [
        {
          projectionId: "projection-feature-1",
          findingId: "finding-projection-1",
          featureId: "feature-projection-1",
          semanticRole: "VEHICLE",
          label: "Vehicle 2",
          referenceKey: referenceKey(),
        },
      ],
      truncated: false,
    },
    provenance: {
      evidenceItemIds: ["evidence-projection-1"],
      receiptIds: ["receipt-projection-1"],
      operationKeys: ["feature.query@1.0"],
      consumerLockHash: sha("4"),
      findingProfileHash: sha("5"),
      rendererPolicyHash: sha("6"),
    },
    createdAt: "2026-08-29T00:00:00.000Z",
  });
}

function referenceKey() {
  return {
    namespace: "gowm" as const,
    kind: "WORLD_OBJECT",
    id: "wrf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    version: "7",
  };
}

function sha(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

async function* iterable<T>(values: readonly T[]): AsyncGenerator<T> {
  yield* values;
}
