import { describe, expect, it, jest } from "@jest/globals";

import { createSdarAgUiInteractionSource } from "../apps/server/src/chat/sdar-agui-runner.js";
import type { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import type { SdarInteractionEvent } from "../packages/interaction-contract/src/index.js";
import type { InteractionPersistenceRepository } from "../packages/persistence/src/index.js";

describe("AG-UI client state is not authority", () => {
  it("ignores injected Task, utility, and routing state", async () => {
    const listActiveTasksForChat = jest.fn(async () => []);
    const classify = jest.fn(async () => ({ requestKind: "general_chat" }));
    const answer = jest.fn(async () => "server-owned safe response");
    const submit = jest.fn();
    const status = jest.fn();
    const followUp = jest.fn();
    const cancel = jest.fn();
    const source = createSdarAgUiInteractionSource({
      repository: {
        listActiveTasksForChat,
      } as unknown as InteractionPersistenceRepository,
      coordinator: {
        submit,
        status,
        followUp,
        cancel,
      } as unknown as SdarTaskCoordinator,
      model: { classify, answer },
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
      limit: 2,
    });
    expect(classify).toHaveBeenCalledWith({
      userText: "hello",
      hasActiveTask: false,
    });
    expect(answer).toHaveBeenCalledWith({ userText: "hello" });
    expect(submit).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(
      events.find((event) => event.eventType === "message.text")?.payload.text,
    ).toBe("server-owned safe response");
  });
});

async function collect(
  events: AsyncIterable<SdarInteractionEvent>,
): Promise<SdarInteractionEvent[]> {
  const collected: SdarInteractionEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
