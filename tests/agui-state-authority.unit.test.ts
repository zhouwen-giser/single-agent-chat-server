import { describe, expect, it, jest } from "@jest/globals";

import { createSdarAgUiInteractionSource } from "../apps/server/src/chat/sdar-agui-runner.js";
import type { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import type { SdarInteractionEvent } from "../packages/interaction-contract/src/index.js";
import type { InteractionPersistenceRepository } from "../packages/persistence/src/index.js";

describe("AG-UI client state is not authority", () => {
  it("ignores injected Task, utility, and routing state", async () => {
    const listActiveTasksForChat = jest.fn(async () => []);
    const decideTurn = jest.fn(async () => ({ kind: "general_chat" }));
    const answer = jest.fn(async () => "server-owned safe response");
    const submit = jest.fn();
    const listTaskStatuses = jest.fn();
    const followUp = jest.fn();
    const cancel = jest.fn();
    const source = createSdarAgUiInteractionSource({
      repository: {
        listActiveTasksForChat,
      } as unknown as InteractionPersistenceRepository,
      coordinator: {
        submit,
        listTaskStatuses,
        followUp,
        cancel,
      } as unknown as SdarTaskCoordinator,
      model: { decideTurn, answer },
    });

    const events = await collect(
      source({
        input: {
          threadId: "external-thread",
          runId: "state-injection-run",
          state: {
            taskId: "attacker-task",
            contextId: "attacker-context",
            hasActiveTask: true,
          },
          messages: [{ id: "user-1", role: "user", content: "hello" }],
          tools: [],
          context: [{ description: "utility", value: "create_task" }],
          forwardedProps: {
            utilityRequest: true,
            route: "another-agent",
            taskId: "attacker-task",
          },
        },
        principalId: "principal-1",
        threadId: "server-owned-thread",
        signal: new AbortController().signal,
      }),
    );

    expect(listActiveTasksForChat).toHaveBeenCalledWith({
      principalId: "principal-1",
      threadId: "server-owned-thread",
      limit: 32,
    });
    expect(decideTurn).toHaveBeenCalledWith(
      expect.objectContaining({ currentUserText: "hello" }),
    );
    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({ currentUserText: "hello" }),
    );
    expect(submit).not.toHaveBeenCalled();
    expect(listTaskStatuses).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(
      events.find((event) => event.eventType === "message.text")?.payload.text,
    ).toBe("server-owned safe response");
  });

  it("passes the locally resolved full taskId through the shared Coordinator contract", async () => {
    const binding = {
      bindingId: "binding-b",
      threadId: "server-owned-thread",
      sdarTaskId: "task-bravo",
      sdarContextId: "context-bravo",
      shortId: "bravo02",
      status: "WORKING",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      version: 0,
    } as const;
    const followUp = jest.fn<
      (
        input: unknown,
        signal?: AbortSignal,
        observer?: unknown,
      ) => AsyncGenerator<string>
    >(() => fragments("continued"));
    const source = createSdarAgUiInteractionSource({
      repository: {
        listActiveTasksForChat: jest.fn(async () => [binding]),
        findAuthorizedTask: jest.fn(async () => binding),
        touchTaskReference: jest.fn(async () => undefined),
      } as unknown as InteractionPersistenceRepository,
      coordinator: { followUp } as unknown as SdarTaskCoordinator,
      model: {
        decideTurn: async () => ({
          kind: "task_follow_up",
          selector: { shortId: "bravo02" },
          action: "pause",
          text: "pause B",
        }),
        answer: async () => "unused",
      },
    });

    await collect(
      source({
        input: {
          threadId: "external-thread",
          runId: "explicit-task-run",
          state: {},
          messages: [{ id: "user-2", role: "user", content: "pause B" }],
          tools: [],
          context: [],
          forwardedProps: {},
        },
        principalId: "principal-1",
        threadId: "server-owned-thread",
        signal: new AbortController().signal,
      }),
    );

    expect(followUp).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-bravo", action: "pause" }),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(followUp.mock.calls[0]?.[0]).not.toHaveProperty("targetTaskId");
  });
});

async function* fragments(text: string): AsyncGenerator<string> {
  yield text;
}

async function collect(
  events: AsyncIterable<SdarInteractionEvent>,
): Promise<SdarInteractionEvent[]> {
  const collected: SdarInteractionEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
