import { describe, expect, it } from "@jest/globals";

import { createSdarChatRunner } from "../apps/server/src/chat/sdar-chat-runner.js";
import type { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import type { ChatPersistenceRepository } from "../packages/persistence/src/index.js";
import {
  InteractionQueryService,
  resolveQueryIntent,
  type QueryRepository,
} from "../packages/interaction-query/src/index.js";
import type {
  AgentCardSnapshot,
  TaskBinding,
} from "../packages/persistence/src/index.js";
import type {
  NormalizedTask,
  SdarA2aClient,
} from "../packages/sdar-a2a-adapter/src/index.js";

describe("deterministic interaction queries", () => {
  it.each([
    ["这个 Agent 有哪些能力？", "query_capabilities"],
    ["查看当前任务", "query_active_task"],
    ["task status", "query_task_status"],
    ["查看任务结果", "query_task_result"],
    ["task history", "query_task_history"],
    ["列出这个会话的任务", "list_conversation_tasks"],
    ["previous task", "query_previous_task"],
    ["当前允许的操作", "query_allowed_actions"],
    ["查看能力缺口", "query_capability_gap"],
  ])("resolves %s before model classification", (text, intent) => {
    expect(resolveQueryIntent(text)).toMatchObject({ intent });
  });

  it("extracts only an explicitly labelled Task ID", () => {
    expect(resolveQueryIntent("task status task_id=task-123")).toEqual({
      intent: "query_task_status",
      taskId: "task-123",
    });
    expect(resolveQueryIntent("task status task-123")).toEqual({
      intent: "query_task_status",
    });
  });

  it("rejects an unbound Task ID before creating a client", async () => {
    let clientCreations = 0;
    const service = new InteractionQueryService(
      repositoryFixture(),
      async () => {
        clientCreations += 1;
        return clientFixture().client;
      },
    );

    await expect(
      service.execute({
        intent: "query_task_status",
        taskId: "foreign-task",
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).resolves.toBe("That Task is not authorized for this conversation.");
    expect(clientCreations).toBe(0);
  });

  it("uses only getTask after local authorization", async () => {
    const binding = taskBinding();
    const repository = repositoryFixture({ authorized: binding });
    const fixture = clientFixture(taskFixture());
    const service = new InteractionQueryService(
      repository,
      async () => fixture.client,
    );

    const result = await service.execute({
      intent: "query_task_status",
      taskId: binding.sdarTaskId,
      principalId: "principal-1",
      threadId: binding.threadId,
    });

    expect(result).toContain("Task task-1 is WORKING");
    expect(fixture.calls).toEqual({
      getTask: 1,
      submit: 0,
      followUp: 0,
      cancel: 0,
    });
  });

  it("reads capabilities from the current Agent Card and persists a safe LKG", async () => {
    const saved: Omit<AgentCardSnapshot, "snapshotId">[] = [];
    const repository = repositoryFixture({ saved });
    const fixture = clientFixture();
    const service = new InteractionQueryService(
      repository,
      async () => fixture.client,
      () => new Date("2026-08-11T00:00:00.000Z"),
    );

    const result = await service.execute({
      intent: "query_capabilities",
      principalId: "principal-1",
      threadId: "thread-1",
    });

    expect(result).toContain("current Agent Card");
    expect(result).toContain("Run a published workflow");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      protocolVersion: "1.0",
      specPatch: "1.0.1",
      binding: "HTTP+JSON",
      observedAt: "2026-08-11T00:00:00.000Z",
    });
    expect(JSON.stringify(saved[0])).not.toContain("http://sdar.test/a2a");
  });

  it("labels Agent Card LKG as degraded and not readiness", async () => {
    const repository = repositoryFixture({ snapshot: snapshotFixture() });
    const service = new InteractionQueryService(repository, async () => {
      throw new Error("SDAR unavailable");
    });

    const result = await service.execute({
      intent: "query_capabilities",
      principalId: "principal-1",
      threadId: "thread-1",
    });

    expect(result).toContain("degraded last-known-good Agent Card");
    expect(result).toContain("not a readiness signal");
  });

  it.each([
    [
      "awaiting_plan_confirmation",
      "confirm_plan, reject_plan, revise_plan, patch_goal",
    ],
    ["awaiting_user_input", "provide_input"],
    ["paused", "resume, cancel_goal"],
  ])(
    "maps INPUT_REQUIRED phase %s to distinct actions",
    async (phase, actions) => {
      const binding = taskBinding();
      const repository = repositoryFixture({ active: binding });
      const fixture = clientFixture(
        taskFixture({ state: "INPUT_REQUIRED", internalPhase: phase }),
      );
      const service = new InteractionQueryService(
        repository,
        async () => fixture.client,
      );

      await expect(
        service.execute({
          intent: "query_allowed_actions",
          principalId: "principal-1",
          threadId: "thread-1",
        }),
      ).resolves.toContain(actions);
    },
  );

  it("queries the latest authorized binding after the active Task completes", async () => {
    const completedBinding = {
      ...taskBinding(),
      status: "COMPLETED",
      terminalAt: "2026-08-11T02:00:00.000Z",
    };
    const repository = repositoryFixture({ list: [completedBinding] });
    const fixture = clientFixture(
      taskFixture({
        state: "COMPLETED",
        artifacts: [
          {
            artifactId: "final",
            name: "final",
            parts: [
              { kind: "text", mediaType: "text/plain", text: "complete" },
            ],
          },
        ],
      }),
    );
    const service = new InteractionQueryService(
      repository,
      async () => fixture.client,
    );

    await expect(
      service.execute({
        intent: "query_task_result",
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).resolves.toContain("final: complete");
    expect(fixture.calls.getTask).toBe(1);
  });
  it("renders only published results, history, and capability gap", async () => {
    const binding = taskBinding();
    const repository = repositoryFixture({ active: binding });
    const fixture = clientFixture(
      taskFixture({
        artifacts: [
          {
            artifactId: "artifact-1",
            name: "final-result",
            parts: [{ kind: "text", mediaType: "text/plain", text: "done" }],
          },
        ],
        history: [
          {
            messageId: "message-1",
            role: "AGENT",
            parts: [
              { kind: "text", mediaType: "text/plain", text: "public update" },
            ],
          },
        ],
        capabilityGap: { code: "missing-provider" },
      }),
    );
    const service = new InteractionQueryService(
      repository,
      async () => fixture.client,
    );
    const base = { principalId: "principal-1", threadId: "thread-1" };

    await expect(
      service.execute({ ...base, intent: "query_task_result" }),
    ).resolves.toContain("final-result: done");
    await expect(
      service.execute({ ...base, intent: "query_task_history" }),
    ).resolves.toContain("AGENT: public update");
    await expect(
      service.execute({ ...base, intent: "query_capability_gap" }),
    ).resolves.toContain("missing-provider");
    expect(fixture.historyLengths).toContain(100);
    expect(
      fixture.calls.submit + fixture.calls.followUp + fixture.calls.cancel,
    ).toBe(0);
  });

  it("routes a Task list through model decision and the authorized directory", async () => {
    let directoryLookups = 0;
    const runner = createSdarChatRunner({
      repository: {
        listActiveTasksForChat: async () => {
          directoryLookups += 1;
          return [taskBinding()];
        },
      } as unknown as ChatPersistenceRepository,
      coordinator: {} as SdarTaskCoordinator,
      model: {
        decideTurn: async () => ({
          kind: "list_tasks",
          includeTerminal: false,
        }),
        answer: async () => "unused",
      },
    });

    const result = await runner({
      userText: "列出这个会话的任务",
      clientMessages: [{ role: "user", contentText: "列出这个会话的任务" }],
      identity: {
        userId: "principal-1",
        role: "user",
        issuedAt: 1,
        expiresAt: 2,
      },
      openWebUi: {
        chatId: "chat-1",
        messageId: "message-1",
        userMessageId: "user-message-1",
      },
      threadId: "thread-1",
      runId: "run-1",
    });
    if (typeof result === "string") throw new Error("typed events expected");
    const eventTypes: string[] = [];
    for await (const event of result) {
      if (typeof event !== "string") eventTypes.push(event.eventType);
    }

    expect(directoryLookups).toBe(1);
    expect(eventTypes).toEqual(["run.started", "message.text", "run.finished"]);
  });
  it("lists only local authorized bindings without touching A2A", async () => {
    let clientCreations = 0;
    const repository = repositoryFixture({ list: [taskBinding()] });
    const service = new InteractionQueryService(repository, async () => {
      clientCreations += 1;
      return clientFixture().client;
    });

    await expect(
      service.execute({
        intent: "list_conversation_tasks",
        principalId: "principal-1",
        threadId: "thread-1",
      }),
    ).resolves.toContain("task-1: WORKING (active)");
    expect(clientCreations).toBe(0);
  });
});

function repositoryFixture(
  options: {
    readonly authorized?: TaskBinding;
    readonly active?: TaskBinding;
    readonly list?: readonly TaskBinding[];
    readonly snapshot?: AgentCardSnapshot;
    readonly saved?: Omit<AgentCardSnapshot, "snapshotId">[];
  } = {},
): QueryRepository {
  return {
    findAuthorizedTask: async () => options.authorized,
    listActiveTasksForChat: async () =>
      options.active === undefined ? [] : [options.active],
    listTaskBindings: async () => options.list ?? [],
    recordAuthorizedTaskObservation: async () =>
      options.authorized ?? options.active,
    saveAgentCardSnapshot: async (input) => {
      options.saved?.push(input);
      return { snapshotId: "snapshot-new", ...input };
    },
    getLatestAgentCardSnapshot: async () => options.snapshot,
  };
}

function clientFixture(task: NormalizedTask = taskFixture()): {
  readonly client: SdarA2aClient;
  readonly calls: {
    getTask: number;
    submit: number;
    followUp: number;
    cancel: number;
  };
  readonly historyLengths: number[];
} {
  const calls = { getTask: 0, submit: 0, followUp: 0, cancel: 0 };
  const historyLengths: number[] = [];
  const client: SdarA2aClient = {
    protocolBinding: "HTTP+JSON",
    protocolVersion: "1.0",
    endpoint: "http://sdar.test/a2a",
    agentCard: {
      name: "SDAR",
      version: "1.4.1",
      protocolVersion: "1.0",
      protocolBinding: "HTTP+JSON",
      streaming: true,
      skills: [
        {
          id: "workflow-run",
          name: "Run a published workflow",
          description: "Executes public SDAR capabilities.",
          tags: ["workflow"],
          examples: [],
        },
      ],
    },
    async *submitTaskStream() {
      yield* [];
      calls.submit += 1;
      throw new Error("query must not submit");
    },
    async sendFollowUp() {
      calls.followUp += 1;
      throw new Error("query must not follow up");
    },
    async getTask(_taskId, options) {
      calls.getTask += 1;
      if (options?.historyLength !== undefined)
        historyLengths.push(options.historyLength);
      return task;
    },
    async cancelTask() {
      calls.cancel += 1;
      throw new Error("query must not cancel");
    },
  };
  return { client, calls, historyLengths };
}

function taskFixture(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    taskId: "task-1",
    contextId: "context-1",
    state: "WORKING",
    artifacts: [],
    history: [],
    ...overrides,
  };
}

function taskBinding(): TaskBinding {
  return {
    bindingId: "binding-1",
    threadId: "thread-1",
    sdarTaskId: "task-1",
    sdarContextId: "context-1",
    status: "WORKING",
    version: 0,
  };
}

function snapshotFixture(): AgentCardSnapshot {
  return {
    snapshotId: "snapshot-1",
    contentHash: "content-hash",
    protocolVersion: "1.0",
    specPatch: "1.0.1",
    binding: "HTTP+JSON",
    safeSkills: [
      {
        id: "workflow-run",
        name: "Run a published workflow",
        description: "LKG projection",
      },
    ],
    sourceUrlHash: "source-hash",
    observedAt: "2026-08-10T00:00:00.000Z",
  };
}
