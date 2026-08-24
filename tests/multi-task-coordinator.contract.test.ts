import { describe, expect, it, jest } from "@jest/globals";

import {
  SdarTaskCoordinator,
  type ExistingTaskTurnContext,
  type FollowUpTurnContext,
  type TaskCoordinatorRepository,
} from "../packages/chat-runtime/src/index.js";
import type { TaskBinding } from "../packages/persistence/src/index.js";
import type {
  NormalizedTask,
  SdarA2aClient,
} from "../packages/sdar-a2a-adapter/src/index.js";

describe("P07 explicit multi-Task Coordinator contract", () => {
  it("cancels only the authorized full taskId without implicit active selection", async () => {
    const repository = repositoryFixture(binding("WORKING"));
    const cancelTask = jest.fn(async (taskId: string) =>
      task(taskId, "CANCELED"),
    );
    const coordinator = new SdarTaskCoordinator({
      repository,
      getClient: async () => client({ cancelTask }),
    });
    const input: ExistingTaskTurnContext = {
      ...turn(),
      taskId: "task-b",
    };

    await collect(coordinator.cancel(input));

    expect(repository.findAuthorizedTask).toHaveBeenCalledWith({
      openWebUiChatId: "chat-a",
      userId: "user-a",
      sdarTaskId: "task-b",
    });
    expect(repository.listActiveTasksForChat).not.toHaveBeenCalled();
    expect(repository.claimTaskInteractionSlot).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: "binding-b" }),
    );
    expect(cancelTask).toHaveBeenCalledWith("task-b", expect.any(Object));
  });

  it("sends Follow-up with the authorized Task and Context identity", async () => {
    const repository = repositoryFixture(
      binding("INPUT_REQUIRED", {
        internalPhase: "awaiting_plan_confirmation",
      }),
    );
    const sendFollowUp = jest.fn(async () => ({
      kind: "message" as const,
      message: {
        messageId: "message-result",
        role: "AGENT" as const,
        parts: [
          { kind: "text" as const, mediaType: "text/plain", text: "accepted" },
        ],
      },
    }));
    const coordinator = new SdarTaskCoordinator({
      repository,
      getClient: async () => client({ sendFollowUp }),
    });
    const input: FollowUpTurnContext = {
      ...turn(),
      taskId: "task-b",
      action: "confirm_plan",
    };

    await collect(coordinator.followUp(input));

    expect(sendFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-b",
        contextId: "context-b",
        action: "confirm_plan",
      }),
      expect.any(Object),
    );
    expect(repository.listActiveTasksForChat).not.toHaveBeenCalled();
  });
});

function repositoryFixture(current: TaskBinding) {
  return {
    claimRequest: jest.fn(async () => ({ outcome: "acquired" as const })),
    completeRequest: jest.fn(async () => undefined),
    abandonRequestClaim: jest.fn(async () => undefined),
    claimTaskSubmissionSlot: jest.fn(async () => true),
    claimTaskInteractionSlot: jest.fn(async () => true),
    releaseTaskSubmissionSlot: jest.fn(async () => undefined),
    releaseTaskInteractionSlot: jest.fn(async () => undefined),
    listActiveTasksForChat: jest.fn(async () => [current]),
    setFocusedTask: jest.fn(async () => undefined),
    findAuthorizedTask: jest.fn(async () => current),
    createTaskBinding: jest.fn(async () => current),
    updateTaskBinding: jest.fn(async () => ({
      ...current,
      status: "CANCELED",
      terminalAt: "2026-08-21T00:01:00.000Z",
      version: current.version + 1,
    })),
    recordEvent: jest.fn(async () => true),
  } satisfies TaskCoordinatorRepository;
}

function client(
  overrides: Partial<Pick<SdarA2aClient, "cancelTask" | "sendFollowUp">>,
): SdarA2aClient {
  return {
    protocolBinding: "HTTP+JSON",
    protocolVersion: "1.0",
    endpoint: "http://sdar.test/a2a",
    submitTaskStream: async function* () {
      yield await Promise.reject(new Error("not used"));
    },
    getTask: async () => task("task-b", "WORKING"),
    cancelTask: async (taskId) => task(taskId, "CANCELED"),
    sendFollowUp: async () => ({
      kind: "task",
      task: task("task-b", "WORKING"),
    }),
    ...overrides,
  };
}

function binding(
  status: string,
  pendingInput?: Record<string, string>,
): TaskBinding {
  return {
    bindingId: "binding-b",
    threadId: "thread-a",
    sdarTaskId: "task-b",
    sdarContextId: "context-b",
    status,
    ...(pendingInput === undefined ? {} : { pendingInput }),
    version: 0,
  };
}

function task(taskId: string, state: NormalizedTask["state"]): NormalizedTask {
  return {
    taskId,
    contextId: "context-b",
    state,
    artifacts: [],
  };
}

function turn() {
  return {
    userText: "operate B",
    userId: "user-a",
    chatId: "chat-a",
    userMessageId: "message-a",
  } as const;
}

async function collect(source: AsyncIterable<string>): Promise<string[]> {
  const values: string[] = [];
  for await (const value of source) values.push(value);
  return values;
}
