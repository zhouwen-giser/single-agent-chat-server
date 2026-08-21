import { describe, expect, it, jest } from "@jest/globals";

import { createSdarChatRunner } from "../apps/server/src/chat/sdar-chat-runner.js";
import type { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import type { ConversationContext } from "../packages/conversation-context/src/index.js";
import type {
  ChatPersistenceRepository,
  TaskBinding,
} from "../packages/persistence/src/index.js";
import type { TaskSummary } from "../packages/task-directory/src/index.js";
import type { StructuredChatModel } from "../src/agent/model.js";

const alpha = task("task-alpha", "alpha001", "WORKING", "Alpha audit");
const bravo = task(
  "task-bravo",
  "bravo02",
  "INPUT_REQUIRED",
  "Bravo rollout",
  "awaiting_plan_confirmation",
);

describe("P06 model decision and Task reference integration", () => {
  it("routes Provider status to a new SDAR Task despite existing Tasks", async () => {
    const submit = jest.fn(() => fragments("submitted"));
    const fixture = runnerFixture({
      tasks: [alpha, bravo],
      decision: {
        kind: "new_task",
        taskText: "Query SDAR for Provider fleet status",
      },
      coordinator: { submit },
    });

    await collect(await fixture.run("What is the Provider fleet status?"));

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: "Query SDAR for Provider fleet status",
      }),
      undefined,
    );
  });

  it("resolves two-turn B status then focused pronoun confirmation", async () => {
    let focusedTaskId: string | undefined;
    const statusForTask = jest.fn((input: { readonly taskId: string }) => {
      focusedTaskId = input.taskId;
      return fragments("bravo status");
    });
    const followUp = jest.fn(() => fragments("confirmed"));
    const fixture = runnerFixture({
      tasks: [alpha, bravo],
      focused: () => focusedTaskId,
      decision: ({ currentUserText }: { readonly currentUserText: string }) =>
        currentUserText === "查看 B"
          ? { kind: "task_status", selector: { shortId: "bravo02" } }
          : {
              kind: "task_follow_up",
              selector: { reference: "focused" },
              action: "confirm_plan",
              text: currentUserText,
            },
      coordinator: { statusForTask, followUp },
    });

    await collect(await fixture.run("查看 B"));
    await collect(await fixture.run("确认它"));

    expect(statusForTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: bravo.taskId }),
      undefined,
    );
    expect(followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: bravo.taskId,
        action: "confirm_plan",
      }),
      undefined,
    );
  });

  it("clarifies multi-Task cancellation without Focus and never calls A2A", async () => {
    const cancel = jest.fn();
    const fixture = runnerFixture({
      tasks: [alpha, bravo],
      decision: {
        kind: "task_cancel",
        selector: { reference: "only_active" },
      },
      coordinator: { cancel },
    });

    const text = await collect(await fixture.run("取消它"));

    expect(text).toContain("matches multiple Tasks");
    expect(text).toContain("alpha001");
    expect(text).toContain("bravo02");
    expect(cancel).not.toHaveBeenCalled();
    expect(fixture.classificationErrors).toHaveBeenCalledWith(
      "ambiguous_task_reference",
    );
  });

  it("lists every active Task for unqualified status and rejects invalid output locally", async () => {
    const status = jest.fn();
    const fixture = runnerFixture({
      tasks: [alpha, bravo],
      decision: ({ currentUserText }: { readonly currentUserText: string }) =>
        currentUserText === "status"
          ? { kind: "task_status" }
          : { kind: "task_cancel", selector: {}, extra: "unsafe" },
      coordinator: { status },
    });

    const statusText = await collect(await fixture.run("status"));
    const invalidText = await collect(await fixture.run("unsafe model output"));

    expect(statusText).toContain("alpha001: WORKING");
    expect(statusText).toContain("bravo02: INPUT_REQUIRED");
    expect(invalidText).toContain("no SDAR operation");
    expect(status).not.toHaveBeenCalled();
  });
});

function runnerFixture(input: {
  readonly tasks: readonly TaskSummary[];
  readonly focused?: () => string | undefined;
  readonly decision:
    unknown | ((input: { readonly currentUserText: string }) => unknown);
  readonly coordinator: Readonly<Record<string, unknown>>;
}) {
  const bindings = input.tasks.map(toBinding);
  const repository = {
    listActiveTasksForChat: jest.fn(async () => bindings),
    findAuthorizedTask: jest.fn(
      async ({ sdarTaskId }: { readonly sdarTaskId: string }) =>
        bindings.find((binding) => binding.sdarTaskId === sdarTaskId),
    ),
    touchTaskReference: jest.fn(async () => undefined),
  } as unknown as ChatPersistenceRepository;
  const model: StructuredChatModel = {
    decideTurn: jest.fn(async (modelInput) =>
      typeof input.decision === "function"
        ? input.decision(modelInput)
        : input.decision,
    ),
    answer: jest.fn(async () => "general answer"),
  };
  const classificationErrors = jest.fn();
  const runner = createSdarChatRunner({
    repository,
    coordinator: input.coordinator as unknown as SdarTaskCoordinator,
    model,
    onClassificationError: classificationErrors,
    assembleContext: async () => context(input.tasks, input.focused?.()),
  });
  let sequence = 0;
  return {
    classificationErrors,
    run(userText: string) {
      sequence += 1;
      return runner({
        userText,
        identity: {
          userId: "principal-p06",
          role: "user",
          issuedAt: 1,
          expiresAt: 2,
        },
        openWebUi: {
          chatId: "chat-p06",
          messageId: `assistant-${sequence}`,
          userMessageId: `user-${sequence}`,
        },
        threadId: "thread-p06",
        runId: `run-${sequence}`,
      });
    },
  };
}

function context(
  tasks: readonly TaskSummary[],
  focusedTaskId?: string,
): ConversationContext {
  return {
    threadId: "thread-p06",
    messages: [],
    activeTasks: tasks,
    recentTerminalTasks: [],
    ...(focusedTaskId === undefined ? {} : { focusedTaskId }),
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

function toBinding(taskSummary: TaskSummary): TaskBinding {
  return {
    bindingId: taskSummary.bindingId,
    threadId: "thread-p06",
    sdarTaskId: taskSummary.taskId,
    sdarContextId: taskSummary.contextId,
    shortId: taskSummary.shortId,
    status: taskSummary.status,
    createdAt: taskSummary.createdAt,
    updatedAt: taskSummary.updatedAt,
    ...(taskSummary.internalPhase === undefined
      ? {}
      : { pendingInput: { internalPhase: taskSummary.internalPhase } }),
    version: 0,
  };
}

async function collect(
  result:
    | string
    | AsyncIterable<
        string | { readonly eventType: string; readonly payload: unknown }
      >,
): Promise<string> {
  if (typeof result === "string") return result;
  const values: string[] = [];
  for await (const value of result) {
    if (typeof value === "string") values.push(value);
    else if (
      value.eventType === "message.text" &&
      value.payload !== null &&
      typeof value.payload === "object" &&
      "text" in value.payload &&
      typeof value.payload.text === "string"
    ) {
      values.push(value.payload.text);
    }
  }
  return values.join("\n");
}

async function* fragments(value: string): AsyncGenerator<string> {
  yield value;
}
