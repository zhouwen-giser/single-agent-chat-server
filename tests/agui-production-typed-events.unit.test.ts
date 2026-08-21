import { describe, expect, it, jest } from "@jest/globals";
import { EventSchemas, EventType } from "@ag-ui/core";

import { AgUiEventProjection } from "../packages/ag-ui-interaction-adapter/src/index.js";
import { createSdarAgUiInteractionSource } from "../apps/server/src/chat/sdar-agui-runner.js";
import type {
  SdarTaskCoordinator,
  TaskCoordinatorObserver,
} from "../packages/chat-runtime/src/index.js";
import type { SdarInteractionEvent } from "../packages/interaction-contract/src/index.js";
import type { InteractionPersistenceRepository } from "../packages/persistence/src/index.js";
import type { NormalizedTask } from "../packages/sdar-a2a-adapter/src/index.js";

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
        classify: jest.fn(async () => ({ requestKind: "new_task" })),
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

async function collect(
  events: AsyncIterable<SdarInteractionEvent>,
): Promise<SdarInteractionEvent[]> {
  const collected: SdarInteractionEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
