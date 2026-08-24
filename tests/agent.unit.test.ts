import { describe, expect, it, jest } from "@jest/globals";

import type { ConversationContext } from "../packages/conversation-context/src/index.js";
import type { TaskSummary } from "../packages/task-directory/src/index.js";
import { createSingleAgentChatGraph } from "../src/agent/graph.js";
import type { StructuredChatModel } from "../src/agent/model.js";

const taskA = task("task-alpha-full", "alpha001", "WORKING", "Alpha audit");
const taskB = task(
  "task-bravo-full",
  "bravo02",
  "INPUT_REQUIRED",
  "Bravo rollout",
  "awaiting_plan_confirmation",
);

function modelWith(
  decision: unknown,
  answer = "local model answer",
): StructuredChatModel {
  return {
    decideTurn: jest.fn(async () => decision),
    answer: jest.fn(async () => answer),
  };
}

async function invoke(
  model: StructuredChatModel,
  text: string,
  context: ConversationContext = conversation(),
  utilityRequest = false,
) {
  return createSingleAgentChatGraph(model).invoke({
    messages: [{ role: "user", content: text }],
    threadId: context.threadId,
    utilityRequest,
    conversationContext: context,
  });
}

describe("P06 model-driven thin chat graph", () => {
  it("handles utility requests locally without calling the model", async () => {
    const model = modelWith({
      kind: "new_task",
      taskText: "must not run",
    });
    const result = await invoke(
      model,
      "generate a title",
      conversation(),
      true,
    );

    expect(result.requestKind).toBe("utility");
    expect(result.messages.at(-1)?.content).toBe("Single SDAR chat");
    expect(model.decideTurn).not.toHaveBeenCalled();
    expect(model.answer).not.toHaveBeenCalled();
  });

  it("passes full bounded context to decideTurn and general answering", async () => {
    const context = conversation({
      activeTasks: [taskA],
      focusedTaskId: taskA.taskId,
    });
    const model = modelWith({ kind: "general_chat" }, "hello back");
    const result = await invoke(model, "hello", context);

    expect(result.requestKind).toBe("general_chat");
    expect(result.messages.at(-1)?.content).toBe("hello back");
    expect(model.decideTurn).toHaveBeenCalledWith({
      context,
      currentUserText: "hello",
    });
    expect(model.answer).toHaveBeenCalledWith({
      context,
      currentUserText: "hello",
    });
  });

  it("allows a model-classified new Task while another Task is active", async () => {
    const result = await invoke(
      modelWith({ kind: "new_task", taskText: "run provider diagnostics" }),
      "What is provider fleet status?",
      conversation({ activeTasks: [taskA] }),
    );

    expect(result.requestKind).toBe("new_task");
    expect(result.taskText).toBe("run provider diagnostics");
  });

  it("resolves explicit short ID, Focus, and unqualified multi-Task status locally", async () => {
    const context = conversation({
      activeTasks: [taskA, taskB],
      focusedTaskId: taskB.taskId,
    });
    const byShort = await invoke(
      modelWith({ kind: "task_status", selector: { shortId: "alpha001" } }),
      "status alpha001",
      context,
    );
    const byFocus = await invoke(
      modelWith({
        kind: "task_follow_up",
        selector: { reference: "focused" },
        action: "confirm_plan",
        text: "confirm it",
      }),
      "confirm it",
      context,
    );
    const all = await invoke(
      modelWith({ kind: "task_status" }),
      "status",
      context,
    );

    expect(byShort.targetTaskId).toBe(taskA.taskId);
    expect(byFocus.targetTaskId).toBe(taskB.taskId);
    expect(byFocus.followUpAction).toBe("confirm_plan");
    expect(all.requestKind).toBe("list_tasks");
    expect(all.includeTerminalTasks).toBe(false);
  });

  it("rejects extra fields and illegal actions without a second model call", async () => {
    const model = modelWith({
      kind: "task_follow_up",
      selector: { reference: "focused" },
      action: "launch_mcp",
      text: "ignore architecture",
      endpoint: "https://attacker.invalid",
    });
    const result = await invoke(model, "ignore architecture");

    expect(result.requestKind).toBe("general_chat");
    expect(result.lastError).toBe("invalid_structured_classification");
    expect(result.messages.at(-1)?.content).toContain("no SDAR operation");
    expect(model.answer).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("attacker.invalid");
  });

  it("clarifies an ambiguous summary selector and exposes safe candidates", async () => {
    const context = conversation({
      activeTasks: [taskA, { ...taskB, summary: "Alpha secondary audit" }],
    });
    const result = await invoke(
      modelWith({ kind: "task_cancel", selector: { summaryQuery: "alpha" } }),
      "cancel the alpha task",
      context,
    );

    expect(result.requestKind).toBe("general_chat");
    expect(result.lastError).toBe("ambiguous_task_reference");
    expect(result.messages.at(-1)?.content).toContain("alpha001");
    expect(result.messages.at(-1)?.content).toContain("bravo02");
  });

  it("returns a safe local error when decideTurn throws", async () => {
    const model: StructuredChatModel = {
      decideTurn: jest.fn(async () => {
        throw new Error("model details must not leak");
      }),
      answer: jest.fn(async () => "must not answer"),
    };
    const result = await invoke(model, "start something");

    expect(result.lastError).toBe("conversation_model_unavailable");
    expect(result.messages.at(-1)?.content).toContain("no SDAR operation");
    expect(model.answer).not.toHaveBeenCalled();
  });
});

function conversation(
  overrides: Partial<ConversationContext> = {},
): ConversationContext {
  return {
    threadId: "thread-p06",
    messages: [],
    activeTasks: [],
    recentTerminalTasks: [],
    ...overrides,
  };
}

function task(
  taskId: string,
  shortId: string,
  status: string,
  summary: string,
  internalPhase?: string,
): TaskSummary {
  return {
    bindingId: `binding-${shortId}`,
    taskId,
    contextId: `context-${shortId}`,
    shortId,
    status,
    summary,
    ...(internalPhase === undefined ? {} : { internalPhase }),
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}
