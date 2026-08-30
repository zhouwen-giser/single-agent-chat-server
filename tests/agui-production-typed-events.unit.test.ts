import { describe, expect, it, jest } from "@jest/globals";
import { EventSchemas, EventType } from "@ag-ui/core";

import { AgUiEventProjection } from "../packages/ag-ui-interaction-adapter/src/index.js";
import { createSdarAgUiInteractionSource } from "../apps/server/src/chat/sdar-agui-runner.js";
import type {
  SdarTaskCoordinator,
  TaskCoordinatorObserver,
} from "../packages/chat-runtime/src/index.js";
import type { SdarInteractionEvent } from "../packages/interaction-contract/src/index.js";
import { legacyChatResultToInteractionEvents } from "../packages/interaction-runtime/src/index.js";
import { renderInteractionEventsForOpenAi } from "../packages/openai-interaction-adapter/src/index.js";
import type { InteractionPersistenceRepository } from "../packages/persistence/src/index.js";
import type { NormalizedTask } from "../packages/sdar-a2a-adapter/src/index.js";
import type { HybridAuthoritySeparatedResult } from "../packages/world-grounding-runtime/src/index.js";
import { assembleWorldExplanation } from "../packages/world-explanation-runtime/src/index.js";
import { hybridWorldExplanationFixture } from "./fixtures/hybrid-world-explanation.js";
import { assemblyInput } from "./world-explanation-fixtures.js";

describe("production AG-UI typed A2A path", () => {
  it("projects an accepted INPUT_REQUIRED Task as State, Activity, Custom, Text, and Interrupt events", async () => {
    const task = inputRequiredTask();
    const submit = jest.fn(async function* (
      _turn: unknown,
      _signal: AbortSignal | undefined,
      observer: TaskCoordinatorObserver | undefined,
    ) {
      const fragments = [
        "**SDAR status: INPUT_REQUIRED**",
        "Please confirm the published plan.",
      ];
      observer?.({ source: "task", value: task, fragments });
      yield* fragments;
    });
    const source = createSdarAgUiInteractionSource({
      repository: {
        listActiveTasksForChat: jest.fn(async () => []),
      } as unknown as InteractionPersistenceRepository,
      coordinator: { submit } as unknown as SdarTaskCoordinator,
      model: {
        decideTurn: jest.fn(async () => ({
          kind: "new_task",
          taskText: "execute phase 11",
        })),
        answer: jest.fn(async () => "unused"),
      },
    });

    const interactionEvents = await collect(
      source({
        input: {
          threadId: "external-thread-1",
          runId: "run-typed-1",
          state: {},
          messages: [
            { id: "message-1", role: "user", content: "execute phase 11" },
          ],
          tools: [],
          context: [],
          forwardedProps: {},
        },
        principalId: "principal-1",
        threadId: "internal-thread-1",
        signal: new AbortController().signal,
      }),
    );
    const projection = new AgUiEventProjection();
    const agUiEvents = interactionEvents.flatMap((event) =>
      projection.project(event),
    );

    agUiEvents.forEach((event) =>
      expect(() => EventSchemas.parse(event)).not.toThrow(),
    );
    expect(agUiEvents.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        EventType.RUN_STARTED,
        EventType.STATE_SNAPSHOT,
        EventType.ACTIVITY_SNAPSHOT,
        EventType.CUSTOM,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.RUN_FINISHED,
      ]),
    );
    expect(
      agUiEvents.find(({ type }) => type === EventType.RUN_FINISHED),
    ).toMatchObject({
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            reason: "sdar.plan_confirmation",
            metadata: {
              taskId: "task-p11",
              contextId: "context-p11",
              inputRequestId: "plan-p11",
              allowedActions: [
                "confirm_plan",
                "reject_plan",
                "revise_plan",
                "patch_goal",
              ],
            },
          },
        ],
      },
    });
    expect(interactionEvents.at(-1)?.eventType).toBe("input.required");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("keeps typed lookup events while publishing one sanitized hybrid text with OpenAI parity", async () => {
    const secretToken = "phase-token-must-not-leak";
    const password = "phase-password-must-not-leak";
    const providerUrl =
      "https://provider.internal/v1/status?token=provider-query-secret";
    const phaseMessage =
      `Authorization: Bearer bearer-must-not-leak token=${secretToken} ` +
      `password=${password} provider=${providerUrl}`;
    const internalPhase = `completed via ${providerUrl}`;
    const explanation = assembleWorldExplanation(assemblyInput());
    const result = hybridWorldExplanationFixture(explanation, {
      internalPhase,
      phaseMessage,
    });
    const { kind: ignoredKind, ...structured } = result;
    void ignoredKind;
    const task = completedHybridTask(internalPhase, phaseMessage);
    const statusForTask = jest.fn(async function* (
      _input: unknown,
      _signal: AbortSignal | undefined,
      observer: TaskCoordinatorObserver | undefined,
    ) {
      const fragments = [
        phaseMessage,
        `lookup artifact password=${password} ${providerUrl}`,
      ];
      observer?.({ source: "task", value: task, fragments });
      yield* fragments;
    });
    const compareHybrid = jest.fn(
      async () => structured as HybridAuthoritySeparatedResult,
    );
    const source = createSdarAgUiInteractionSource({
      repository: {
        listActiveTasksForChat: jest.fn(async () => [
          {
            bindingId: "binding-hybrid-projection-1",
            threadId: "internal-thread-hybrid",
            sdarTaskId: task.taskId,
            sdarContextId: task.contextId,
            shortId: "hybrid001",
            status: "WORKING",
            version: 1,
          },
        ]),
      } as unknown as InteractionPersistenceRepository,
      coordinator: { statusForTask } as unknown as SdarTaskCoordinator,
      model: {
        decideTurn: jest.fn(async () => hybridPlan()),
        answer: jest.fn(async () => "unused"),
      },
      worldGrounding: {
        answerWorld: jest.fn(async () => "unused"),
        compareHybrid,
        submitOperational: jest.fn(async () => "unused"),
      },
    });

    const interactionEvents = await collect(
      source({
        input: {
          threadId: "external-thread-hybrid",
          runId: "run-hybrid-security-1",
          state: {},
          messages: [
            {
              id: "message-hybrid-1",
              role: "user",
              content: "Compare the active plan with the current world.",
            },
          ],
          tools: [],
          context: [],
          forwardedProps: {},
        },
        principalId: "principal-1",
        threadId: "internal-thread-hybrid",
        signal: new AbortController().signal,
      }),
    );
    const projection = new AgUiEventProjection();
    const agUiEvents = interactionEvents.flatMap((event) =>
      projection.project(event),
    );
    const agUiText = agUiEvents
      .flatMap((event) =>
        event.type === EventType.TEXT_MESSAGE_CONTENT &&
        "delta" in event &&
        typeof event.delta === "string"
          ? [event.delta]
          : [],
      )
      .join("");
    const openAiText: string[] = [];
    for await (const fragment of renderInteractionEventsForOpenAi(
      legacyChatResultToInteractionEvents(result, {
        runId: "run-openai-hybrid-security-1",
        threadId: "internal-thread-hybrid",
      }),
    )) {
      openAiText.push(fragment);
    }
    const visibleInteractionText = interactionEvents.filter(
      ({ eventType }) =>
        eventType === "message.text" || eventType === "artifact.text",
    );
    const worldEvent = interactionEvents.find(
      ({ eventType }) => eventType === "world.explanation",
    );
    const serializedPublicEvents = JSON.stringify({
      interactionEvents,
      agUiEvents,
    });

    expect(interactionEvents.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        "run.started",
        "task.bound",
        "task.snapshot",
        "allowed_actions.changed",
        "world.explanation",
        "world.map_projection",
        "world.source_products",
        "run.finished",
      ]),
    );
    expect(visibleInteractionText).toHaveLength(1);
    expect(visibleInteractionText[0]).toMatchObject({
      eventType: "message.text",
      payload: { text: result.renderedText },
    });
    expect(agUiText).toBe(result.renderedText);
    expect(openAiText.join("")).toBe(result.renderedText);
    expect(worldEvent?.payload).toEqual(
      expect.objectContaining({
        explanation,
        authorityPresentation: result.authorityPresentation,
        authorityFusion: expect.objectContaining({
          reality: result.authorityFusion?.reality,
          checks: result.authorityFusion?.checks,
          overall: result.authorityFusion?.overall,
          unknowns: result.authorityFusion?.unknowns,
          task: expect.objectContaining({
            authority: result.authorityFusion?.task.authority,
            taskId: result.authorityFusion?.task.taskId,
            state: result.authorityFusion?.task.state,
            observedAt: result.authorityFusion?.task.observedAt,
          }),
        }),
      }),
    );
    expect(result.authorityFusion?.task.internalPhase).toBe(internalPhase);
    expect(result.renderedText).toContain("REDACTED");
    for (const forbidden of [
      secretToken,
      password,
      "bearer-must-not-leak",
      providerUrl,
      "provider.internal",
      "provider-query-secret",
    ]) {
      expect(result.renderedText).not.toContain(forbidden);
      expect(serializedPublicEvents).not.toContain(forbidden);
    }
    expect(compareHybrid).toHaveBeenCalledWith(
      expect.objectContaining({ sdarTask: task }),
    );
    expect(statusForTask).toHaveBeenCalledTimes(1);
  });
});

function inputRequiredTask(): NormalizedTask {
  return {
    taskId: "task-p11",
    contextId: "context-p11",
    state: "INPUT_REQUIRED",
    internalPhase: "awaiting_plan_confirmation",
    inputRequestId: "plan-p11",
    phaseMessage: "Please confirm the published plan.",
    statusTimestamp: "2026-08-11T00:00:00.000Z",
    statusMessage: {
      messageId: "status-p11",
      taskId: "task-p11",
      contextId: "context-p11",
      role: "AGENT",
      parts: [
        {
          kind: "text",
          mediaType: "text/plain",
          text: "Please confirm the published plan.",
        },
      ],
    },
    artifacts: [],
  };
}

function completedHybridTask(
  internalPhase: string,
  phaseMessage: string,
): NormalizedTask {
  const taskId = "task-hybrid-projection-1";
  const contextId = "context-hybrid-projection-1";
  return {
    taskId,
    contextId,
    state: "COMPLETED",
    internalPhase,
    phaseMessage,
    statusTimestamp: "2026-08-28T00:00:00.000Z",
    statusMessage: {
      messageId: "status-hybrid-projection-1",
      taskId,
      contextId,
      role: "AGENT",
      parts: [{ kind: "text", mediaType: "text/plain", text: phaseMessage }],
    },
    artifacts: [
      {
        artifactId: "artifact-hybrid-lookup-1",
        parts: [
          {
            kind: "text",
            mediaType: "text/plain",
            text: phaseMessage,
          },
        ],
      },
    ],
  };
}

function hybridPlan() {
  return {
    schemaVersion: "0.4",
    turnRoute: "HYBRID_PLAN_REALITY_COMPARE",
    groundingRequirement: "COMPARE_PLAN_REALITY",
    answerMode: "HYBRID_COMPARISON",
    taskDirective: { action: "STATUS" },
    worldFocusUsage: {
      knownWorldReferences: false,
      priorGrounding: false,
      mapSelections: false,
      externalCorrelationHints: false,
      externalPredicates: false,
    },
  };
}

async function collect(
  events: AsyncIterable<SdarInteractionEvent>,
): Promise<SdarInteractionEvent[]> {
  const collected: SdarInteractionEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
