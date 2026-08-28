import { describe, expect, it, jest } from "@jest/globals";

import type { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import {
  ConversationApplicationService,
  type ConversationApplicationServiceOptions,
} from "../apps/server/src/chat/conversation-application-service.js";
import type { StructuredChatModel } from "../src/agent/model.js";

describe("SACS v0.4 world grounding application routing", () => {
  it("routes WORLD_ANSWER through the grounding runtime and never SDAR", async () => {
    const answerWorld = jest.fn(async () => "published safe world answer");
    const submitOperational = jest.fn(async () => "unused");
    const submit = jest.fn();
    const application = createApplication(
      {
        decideTurn: async () => worldPlan(),
        answer: async () => {
          throw new Error("general answer must not run");
        },
      },
      { answerWorld, submitOperational },
      submit,
    );

    await expect(application.execute(turn())).resolves.toBe(
      "published safe world answer",
    );
    expect(answerWorld).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "openai",
        principalId: "principal-1",
        threadId: "thread-1",
        externalRequestId: "message-1",
        turnPlan: expect.objectContaining({ turnRoute: "WORLD_ANSWER" }),
      }),
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("returns the exact extension blocker for grounded SDAR work", async () => {
    const answerWorld = jest.fn(async () => "unused");
    const submitOperational = jest.fn(
      async () => "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
    );
    const submit = jest.fn();
    const application = createApplication(
      {
        decideTurn: async () => operationalPlan(),
        answer: async () => "unused",
      },
      { answerWorld, submitOperational },
      submit,
    );

    await expect(application.execute(turn())).resolves.toBe(
      "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
    );
    expect(submitOperational).toHaveBeenCalledTimes(1);
    expect(answerWorld).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("fails closed when a world runtime is not constructed", async () => {
    const application = createApplication(
      {
        decideTurn: async () => worldPlan(),
        answer: async () => "unused",
      },
      undefined,
      jest.fn(),
    );
    await expect(application.execute(turn())).resolves.toBe(
      "WORLD_GROUNDING_RUNTIME_UNAVAILABLE",
    );
  });
});

function createApplication(
  model: StructuredChatModel,
  worldGrounding: ConversationApplicationServiceOptions["worldGrounding"],
  submit: jest.Mock,
): ConversationApplicationService {
  const coordinator = {
    submit,
  } as unknown as SdarTaskCoordinator;
  return new ConversationApplicationService({
    repository: {
      listActiveTasksForChat: async () => [],
      findAuthorizedTask: async () => undefined,
      touchTaskReference: async () => undefined,
    },
    coordinator,
    model,
    ...(worldGrounding === undefined ? {} : { worldGrounding }),
  });
}

function turn() {
  return {
    protocol: "openai" as const,
    userText: "What is known about Road 7?",
    clientMessages: [],
    userId: "principal-1",
    chatId: "chat-1",
    threadId: "thread-1",
    userMessageId: "message-1",
    utilityRequest: false,
  };
}

function worldPlan() {
  return {
    schemaVersion: "0.4",
    turnRoute: "WORLD_ANSWER",
    groundingRequirement: "ANSWER_WORLD_QUERY",
    answerMode: "GROUNDED",
    worldFocusUsage: emptyWorldFocus(),
  };
}

function operationalPlan() {
  return {
    schemaVersion: "0.4",
    turnRoute: "SDAR_TASK",
    groundingRequirement: "RESOLVE_REFERENCES",
    answerMode: "GROUNDED",
    taskDirective: { action: "CREATE" },
    worldFocusUsage: emptyWorldFocus(),
  };
}

function emptyWorldFocus() {
  return {
    knownWorldReferences: false,
    priorGrounding: false,
    mapSelections: false,
    externalCorrelationHints: false,
    externalPredicates: false,
  };
}
