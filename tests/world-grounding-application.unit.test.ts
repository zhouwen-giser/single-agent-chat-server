import { describe, expect, it, jest } from "@jest/globals";

import type { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import type { TaskBinding } from "../packages/persistence/src/index.js";
import {
  ConversationApplicationService,
  type ConversationApplicationServiceOptions,
} from "../apps/server/src/chat/conversation-application-service.js";
import type { StructuredChatModel } from "../src/agent/model.js";
import { assembleWorldExplanation } from "../packages/world-explanation-runtime/src/index.js";
import type { HybridAuthoritySeparatedResult } from "../packages/world-grounding-runtime/src/index.js";
import { hybridWorldExplanationFixture } from "./fixtures/hybrid-world-explanation.js";
import { assemblyInput } from "./world-explanation-fixtures.js";

describe("SACS v0.4 world grounding application routing", () => {
  it("handles a pending choice before model classification", async () => {
    const decideTurn = jest.fn(async () => worldPlan());
    const continuePendingChoice = jest.fn(
      async () => "continued origin answer",
    );
    const answerWorld = jest.fn(async () => "unused");
    const application = createApplication(
      { decideTurn, answer: async () => "unused" },
      {
        continuePendingChoice,
        answerWorld,
        compareHybrid: jest.fn(async () => "unused"),
        submitOperational: jest.fn(async () => "unused"),
      },
      jest.fn(),
    );

    await expect(
      application.execute({ ...turn(), userText: "第二个" }),
    ).resolves.toBe("continued origin answer");
    expect(continuePendingChoice).toHaveBeenCalledWith(
      expect.objectContaining({
        externalRequestId: "message-1",
        userText: "第二个",
      }),
    );
    expect(decideTurn).not.toHaveBeenCalled();
    expect(answerWorld).not.toHaveBeenCalled();
  });

  it("routes WORLD_ANSWER through the grounding runtime and never SDAR", async () => {
    const answerWorld = jest.fn(async () => "published safe world answer");
    const compareHybrid = jest.fn(async () => "unused");
    const submitOperational = jest.fn(async () => "unused");
    const submit = jest.fn();
    const application = createApplication(
      {
        decideTurn: async () => worldPlan(),
        answer: async () => {
          throw new Error("general answer must not run");
        },
      },
      { answerWorld, compareHybrid, submitOperational },
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
    const compareHybrid = jest.fn(async () => "unused");
    const submitOperational = jest.fn(
      async () => "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
    );
    const submit = jest.fn();
    const application = createApplication(
      {
        decideTurn: async () => operationalPlan(),
        answer: async () => "unused",
      },
      { answerWorld, compareHybrid, submitOperational },
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

  it("compares one authorized published SDAR plan with WSGS reality without mutating the Task", async () => {
    const compareHybrid = jest.fn(async () => "AUTHORITY_FUSION_PREVIEW_READY");
    const submit = jest.fn();
    const followUp = jest.fn();
    const cancel = jest.fn();
    const observer = jest.fn();
    const statusForTask = jest.fn(async function* (
      _input: unknown,
      _signal: AbortSignal | undefined,
      observed: (value: unknown) => void,
    ) {
      observed({
        source: "task",
        value: {
          taskId: "task-plan-1",
          contextId: "context-plan-1",
          state: "INPUT_REQUIRED",
          internalPhase: "awaiting_plan_confirmation",
          phaseMessage: "Inspect Road 7 before dispatch.",
          artifacts: [],
        },
        fragments: ["Published plan: inspect Road 7 before dispatch."],
      });
      yield "Published plan: inspect Road 7 before dispatch.";
    });
    const application = new ConversationApplicationService({
      repository: repository([binding("task-plan-1", "plan001")]),
      coordinator: {
        submit,
        followUp,
        cancel,
        statusForTask,
      } as unknown as SdarTaskCoordinator,
      model: {
        decideTurn: async () => hybridPlan(),
        answer: async () => "unused",
      },
      worldGrounding: {
        answerWorld: jest.fn(async () => "unused"),
        compareHybrid,
        submitOperational: jest.fn(async () => "unused"),
      },
    });

    await expect(
      application.execute({ ...turn(), coordinatorObserver: observer }),
    ).resolves.toBe("AUTHORITY_FUSION_PREVIEW_READY");
    expect(statusForTask).toHaveBeenCalledWith(
      { chatId: "chat-1", userId: "principal-1", taskId: "task-plan-1" },
      undefined,
      expect.any(Function),
    );
    expect(compareHybrid).toHaveBeenCalledWith(
      expect.objectContaining({
        sdarTask: expect.objectContaining({
          taskId: "task-plan-1",
          state: "INPUT_REQUIRED",
          internalPhase: "awaiting_plan_confirmation",
          phaseMessage: "Inspect Road 7 before dispatch.",
          artifacts: [],
        }),
      }),
    );
    expect(observer).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("wraps a structured hybrid runtime result as one world explanation chat result", async () => {
    const expected = hybridWorldExplanationFixture(
      assembleWorldExplanation(assemblyInput()),
    );
    const { kind: ignoredKind, ...structuredFields } = expected;
    void ignoredKind;
    const structured = structuredFields as HybridAuthoritySeparatedResult;
    const compareHybrid = jest.fn(async () => structured);
    const statusForTask = jest.fn(async function* (
      _input: unknown,
      _signal: AbortSignal | undefined,
      observed: (value: unknown) => void,
    ) {
      observed({
        source: "task",
        value: {
          taskId: "task-plan-1",
          contextId: "context-plan-1",
          state: "COMPLETED",
          internalPhase: "completed",
          phaseMessage: "Published plan snapshot.",
          artifacts: [],
        },
        fragments: ["Published plan snapshot."],
      });
      yield "Published plan snapshot.";
    });
    const application = new ConversationApplicationService({
      repository: repository([binding("task-plan-1", "plan001")]),
      coordinator: { statusForTask } as unknown as SdarTaskCoordinator,
      model: {
        decideTurn: async () => hybridPlan(),
        answer: async () => "unused",
      },
      worldGrounding: {
        answerWorld: jest.fn(async () => "unused"),
        compareHybrid,
        submitOperational: jest.fn(async () => "unused"),
      },
    });

    await expect(application.execute(turn())).resolves.toEqual(expected);
    expect(compareHybrid).toHaveBeenCalledTimes(1);
  });

  it("lists ambiguous active Tasks and never reads or compares authority state", async () => {
    const statusForTask = jest.fn();
    const compareHybrid = jest.fn(async () => "unused");
    const application = new ConversationApplicationService({
      repository: repository([
        binding("task-plan-1", "plan001"),
        binding("task-plan-2", "plan002"),
      ]),
      coordinator: { statusForTask } as unknown as SdarTaskCoordinator,
      model: {
        decideTurn: async () => hybridPlan(),
        answer: async () => "unused",
      },
      worldGrounding: {
        answerWorld: jest.fn(async () => "unused"),
        compareHybrid,
        submitOperational: jest.fn(async () => "unused"),
      },
    });

    const response = await application.execute(turn());
    expect(response).toContain("plan001: WORKING");
    expect(response).toContain("plan002: WORKING");
    expect(statusForTask).not.toHaveBeenCalled();
    expect(compareHybrid).not.toHaveBeenCalled();
  });

  it("fails closed when the published SDAR plan snapshot exceeds its bound", async () => {
    const compareHybrid = jest.fn(async () => "unused");
    const statusForTask = jest.fn(async function* (
      _input: unknown,
      _signal: AbortSignal | undefined,
      observed: (value: unknown) => void,
    ) {
      observed({
        source: "task",
        value: {
          taskId: "task-plan-1",
          contextId: "context-plan-1",
          state: "INPUT_REQUIRED",
          internalPhase: "awaiting_plan_confirmation",
          phaseMessage: "Inspect Road 7 before dispatch.",
          artifacts: [],
        },
        fragments: ["x".repeat(8_001)],
      });
      yield "bounded status";
    });
    const application = new ConversationApplicationService({
      repository: repository([binding("task-plan-1", "plan001")]),
      coordinator: { statusForTask } as unknown as SdarTaskCoordinator,
      model: {
        decideTurn: async () => hybridPlan(),
        answer: async () => "unused",
      },
      worldGrounding: {
        answerWorld: jest.fn(async () => "unused"),
        compareHybrid,
        submitOperational: jest.fn(async () => "unused"),
      },
    });

    await expect(application.execute(turn())).resolves.toBe(
      "AUTHORITY_FUSION_PLAN_UNAVAILABLE",
    );
    expect(compareHybrid).not.toHaveBeenCalled();
  });

  it("passes a FAILED published Task snapshot for read-only lifecycle fusion", async () => {
    const compareHybrid = jest.fn(async () => "AUTHORITY_FUSION_V2_READY");
    const statusForTask = jest.fn(async function* (
      _input: unknown,
      _signal: AbortSignal | undefined,
      observed: (value: unknown) => void,
    ) {
      observed({
        source: "task",
        value: {
          taskId: "task-plan-1",
          contextId: "context-plan-1",
          state: "FAILED",
          internalPhase: "failed",
          phaseMessage: "Planning failed.",
          artifacts: [],
        },
        fragments: ["The SDAR Task failed before publishing a plan."],
      });
      yield "The SDAR Task failed before publishing a plan.";
    });
    const application = new ConversationApplicationService({
      repository: repository([binding("task-plan-1", "plan001")]),
      coordinator: { statusForTask } as unknown as SdarTaskCoordinator,
      model: {
        decideTurn: async () => hybridPlan(),
        answer: async () => "unused",
      },
      worldGrounding: {
        answerWorld: jest.fn(async () => "unused"),
        compareHybrid,
        submitOperational: jest.fn(async () => "unused"),
      },
    });

    await expect(application.execute(turn())).resolves.toBe(
      "AUTHORITY_FUSION_V2_READY",
    );
    expect(compareHybrid).toHaveBeenCalledWith(
      expect.objectContaining({
        sdarTask: expect.objectContaining({
          taskId: "task-plan-1",
          state: "FAILED",
          internalPhase: "failed",
        }),
      }),
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

function repository(tasks: readonly TaskBinding[]) {
  return {
    listActiveTasksForChat: async () => tasks,
    findAuthorizedTask: async () => undefined,
    touchTaskReference: async () => undefined,
  };
}

function binding(taskId: string, shortId: string): TaskBinding {
  return {
    bindingId: `binding-${taskId}`,
    threadId: "thread-1",
    sdarTaskId: taskId,
    sdarContextId: `context-${taskId}`,
    shortId,
    status: "WORKING",
    version: 1,
  };
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

function hybridPlan() {
  return {
    schemaVersion: "0.4",
    turnRoute: "HYBRID_PLAN_REALITY_COMPARE",
    groundingRequirement: "COMPARE_PLAN_REALITY",
    answerMode: "HYBRID_COMPARISON",
    taskDirective: { action: "STATUS" },
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
