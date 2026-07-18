import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import pg from "pg";

import { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import {
  ChatPersistenceRepository,
  runMigrations,
} from "../packages/persistence/src/index.js";
import type {
  FollowUpInput,
  NormalizedSendResult,
  NormalizedStreamEvent,
  NormalizedTask,
  OperationOptions,
  SdarA2aClient,
  SubmitTaskInput,
} from "../packages/sdar-a2a-adapter/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;

describeWithPostgres("bounded SDAR task coordination", () => {
  const pool = new Pool({ connectionString, max: 4 });
  const repository = new ChatPersistenceRepository(pool, 60_000);

  beforeAll(async () => {
    const database = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    expect(database.rows[0]?.database_name).toBe("single_agent_chat_phase4");
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE TABLE
        chat_service.a2a_event_cache,
        chat_service.request_idempotency,
        chat_service.conversation_task_binding,
        chat_service.chat_thread_binding
      CASCADE
    `);
    await repository.getOrCreateThread({
      openWebUiChatId: "chat-a",
      userId: "user-a",
      userRole: "user",
    });
  });

  afterAll(async () => pool.end());

  it("returns an immediate Message without inventing a Task binding", async () => {
    const client = new FakeClient([
      { kind: "message", message: agentMessage("immediate answer") },
    ]);
    const output = await collect(coordinator(client).submit(turn()));

    expect(output).toEqual(["immediate answer"]);
    expect(await repository.listActiveBindings()).toEqual([]);
    expect(client.submitCount).toBe(1);
  });

  it("streams Task status.message and phaseMessage as conversational deltas", async () => {
    const client = new FakeClient([
      { kind: "task", task: task("WORKING", "planning", "Inspecting inputs") },
      {
        kind: "status",
        taskId: "task-a",
        contextId: "context-a",
        state: "COMPLETED",
        message: agentMessage("Finished safely"),
        phaseMessage: "Publishing result",
      },
    ]);
    const output = await collect(coordinator(client).submit(turn()));

    expect(output).toEqual([
      "**SDAR status: WORKING**",
      "planning",
      "Inspecting inputs",
      "**SDAR status: COMPLETED**",
      "Finished safely",
      "Publishing result",
    ]);
    await expect(
      repository.findAuthorizedTask({
        openWebUiChatId: "chat-a",
        userId: "user-a",
        sdarTaskId: "task-a",
      }),
    ).resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("polls a bounded stream to a terminal Task and renders text plus JSON artifacts", async () => {
    let clock = 0;
    const client = new FakeClient(
      [{ kind: "task", task: task("WORKING", "started") }],
      [
        {
          ...task("COMPLETED", "done"),
          artifacts: [
            {
              artifactId: "result",
              parts: [
                { kind: "text", mediaType: "text/plain", text: "final text" },
                {
                  kind: "data",
                  mediaType: "application/json",
                  data: { result: "ok" },
                },
              ],
            },
          ],
        },
      ],
    );
    const output = await collect(
      coordinator(client, {
        pollingBudgetMs: 50,
        now: () => clock,
        delay: async (milliseconds) => {
          clock += milliseconds;
        },
      }).submit(turn()),
    );

    expect(client.getCount).toBe(1);
    expect(output.join("\n")).toContain("final text");
    expect(output.join("\n")).toContain('"result": "ok"');
  });

  it("ends its observation budget while the long Task continues and never cancels", async () => {
    let clock = 0;
    const client = new FakeClient(
      [{ kind: "task", task: task("WORKING", "long running") }],
      [task("WORKING", "still running")],
    );
    const output = await collect(
      coordinator(client, {
        pollingBudgetMs: 30,
        pollingIntervalMs: 10,
        now: () => clock,
        delay: async (milliseconds) => {
          clock += milliseconds;
        },
      }).submit(turn()),
    );

    expect(output.at(-1)).toContain("ending without cancellation");
    expect(client.getCount).toBe(3);
    expect(client.cancelCount).toBe(0);
  });

  it("aborts the roughly thirty-second stream boundary without canceling the Task", async () => {
    const client = new HangingClient();
    const output = await collect(
      coordinator(client, { streamBudgetMs: 30, pollingBudgetMs: 0 }).submit(
        turn(),
      ),
    );

    expect(output.at(-1)).toContain("ending without cancellation");
    expect(client.streamSignalAborted).toBe(true);
    expect(client.cancelCount).toBe(0);
  });

  it("recovers through authorized getTask after a caller disconnect", async () => {
    const client = new HangingClient();
    client.nextTask = task("WORKING", "recovered status");
    const controller = new AbortController();
    const iterator = coordinator(client, { pollingBudgetMs: 0 }).submit(
      turn(),
      controller.signal,
    );
    await expect(iterator.next()).resolves.toMatchObject({
      value: "**SDAR status: WORKING**",
    });
    controller.abort();
    while (!(await iterator.next()).done) {
      // Drain the caller-aborted generator so its stream budget timer is closed.
    }

    const output = await collect(
      coordinator(client).status({ chatId: "chat-a", userId: "user-a" }),
    );
    expect(output).toEqual(["**SDAR status: WORKING**", "recovered status"]);
    expect(client.cancelCount).toBe(0);
  });

  it("prevents duplicate submission and replays the bound Task", async () => {
    const client = new FakeClient(
      [{ kind: "task", task: task("COMPLETED", "first result") }],
      [task("COMPLETED", "first result")],
    );
    const runtime = coordinator(client);
    await collect(runtime.submit(turn()));
    const replay = await collect(runtime.submit(turn()));

    expect(client.submitCount).toBe(1);
    expect(client.getCount).toBe(1);
    expect(replay).toEqual(["**SDAR status: COMPLETED**", "first result"]);
  });

  it("serializes concurrent different-message submissions before remote Task creation", async () => {
    const client = new ConcurrentSubmitClient();
    const runtime = coordinator(client);
    const first = collect(
      runtime.submit({ ...turn(), userMessageId: "concurrent-a" }),
    );
    await client.started;
    const second = await collect(
      runtime.submit({ ...turn(), userMessageId: "concurrent-b" }),
    );
    client.release();
    await first;

    expect(client.submitCount).toBe(1);
    expect(second.join("\n")).toContain("already submitting");
  });
  it("stops at plan confirmation without inferring an automatic decision", async () => {
    const client = new FakeClient([
      {
        kind: "task",
        task: {
          ...task("INPUT_REQUIRED", "Review this plan"),
          internalPhase: "awaiting_plan_confirmation",
        },
      },
    ]);
    const output = await collect(coordinator(client).submit(turn()));

    expect(output.join("\n")).toContain("explicit plan decision");
    expect(client.getCount).toBe(0);
    const binding = await repository.findActiveTaskForChat({
      chatId: "chat-a",
      userId: "user-a",
    });
    expect(binding?.pendingInput).toMatchObject({
      internalPhase: "awaiting_plan_confirmation",
    });
  });

  it.each(["confirm_plan", "reject_plan", "revise_plan"] as const)(
    "sends explicit %s only in the plan-confirmation phase",
    async (action) => {
      await seedBinding("INPUT_REQUIRED", {
        internalPhase: "awaiting_plan_confirmation",
      });
      const client = new InteractiveClient(
        task("WORKING", "decision accepted"),
      );
      const output = await collect(
        coordinator(client).followUp({ ...turn(), action }),
      );

      expect(client.followUps).toHaveLength(1);
      expect(client.followUps[0]).toMatchObject({
        action,
        taskId: "task-a",
        contextId: "context-a",
        userId: "user-a",
      });
      expect(output.join("\n")).toContain("decision accepted");
    },
  );

  it("sends provide_input with the published input_request_id and one Data value", async () => {
    await seedBinding("INPUT_REQUIRED", {
      internalPhase: "awaiting_user_input",
      inputRequestId: "input-42",
    });
    const client = new InteractiveClient(task("WORKING", "input accepted"));
    await collect(
      coordinator(client).followUp({
        ...turn(),
        action: "provide_input",
        data: { answer: 42 },
      }),
    );

    expect(client.followUps[0]).toMatchObject({
      action: "provide_input",
      inputRequestId: "input-42",
      data: { answer: 42 },
    });
  });

  it("rejects a wrong phase/action locally without contacting SDAR", async () => {
    await seedBinding("INPUT_REQUIRED", {
      internalPhase: "awaiting_user_input",
    });
    const client = new InteractiveClient(task("WORKING"));
    const output = await collect(
      coordinator(client).followUp({ ...turn(), action: "confirm_plan" }),
    );

    expect(output[0]).toContain("not allowed");
    expect(client.followUps).toEqual([]);
  });

  it("resumes only a published paused interaction", async () => {
    await seedBinding("INPUT_REQUIRED", { internalPhase: "paused" });
    const client = new InteractiveClient(task("WORKING", "resumed"));
    await collect(
      coordinator(client).followUp({ ...turn(), action: "resume" }),
    );
    expect(client.followUps[0]?.action).toBe("resume");
  });

  it("sends pause for a working Task", async () => {
    await seedBinding("WORKING");
    const client = new InteractiveClient({
      ...task("INPUT_REQUIRED", "paused by user"),
      internalPhase: "paused",
    });
    await collect(coordinator(client).followUp({ ...turn(), action: "pause" }));
    expect(client.followUps[0]?.action).toBe("pause");
  });

  it("renders rejected user input and preserves the awaiting-input phase", async () => {
    await seedBinding("INPUT_REQUIRED", {
      internalPhase: "awaiting_user_input",
      inputRequestId: "input-42",
    });
    const client = new InteractiveClient({
      ...task("INPUT_REQUIRED", "Input rejected: use an integer"),
      internalPhase: "awaiting_user_input",
      inputRequestId: "input-43",
    });
    const output = await collect(
      coordinator(client).followUp({ ...turn(), action: "provide_input" }),
    );

    expect(output.join("\n")).toContain("Input rejected");
    const binding = await repository.findActiveTaskForChat({
      chatId: "chat-a",
      userId: "user-a",
    });
    expect(binding?.pendingInput).toMatchObject({
      internalPhase: "awaiting_user_input",
      inputRequestId: "input-43",
    });
  });
  it("uses top-level cancelTask and renders exactly the returned state boundary", async () => {
    await seedBinding("WORKING");
    const client = new InteractiveClient(task("CANCELED", "cancel accepted"));
    const output = await collect(coordinator(client).cancel(turn()));

    expect(client.cancelCount).toBe(1);
    expect(output.join("\n")).toContain("**SDAR status: CANCELED**");
    expect(output.at(-1)).toContain("does not prove");
  });

  it("does not repeat the same provide_input message", async () => {
    await seedBinding("INPUT_REQUIRED", {
      internalPhase: "awaiting_user_input",
    });
    const client = new InteractiveClient(task("WORKING", "input accepted"));
    const runtime = coordinator(client);
    const input = { ...turn(), action: "provide_input" as const };
    await collect(runtime.followUp(input));
    await collect(runtime.followUp(input));
    expect(client.followUps).toHaveLength(1);
  });

  it("does not repeat the same top-level cancellation", async () => {
    await seedBinding("WORKING");
    const client = new InteractiveClient(task("CANCELED", "canceled"));
    const runtime = coordinator(client);
    await collect(runtime.cancel(turn()));
    await collect(runtime.cancel(turn()));
    expect(client.cancelCount).toBe(1);
  });
  it("distinguishes and redacts Capability Gap from business failure", async () => {
    await seedBinding("WORKING");
    const client = new FakeClient(
      [],
      [
        {
          ...task("FAILED", "token=super-secret capability missing"),
          internalPhase: "capability_gap",
          errorCode: "CAPABILITY_GAP",
          capabilityGap: { capability: "geo-analysis" },
          nextAction: "register-capability-and-submit-new-task",
        },
      ],
    );
    const output = await collect(
      coordinator(client).status({ chatId: "chat-a", userId: "user-a" }),
    );

    expect(output.join("\n")).toContain("Capability Gap");
    expect(output.join("\n")).toContain("geo-analysis");
    expect(output.join("\n")).not.toContain("super-secret");
  });

  it("labels an ordinary failed Task as a redacted business failure", async () => {
    await seedBinding("WORKING");
    const client = new FakeClient(
      [],
      [
        {
          ...task("FAILED", "password=hunter2 execution failed"),
          errorCode: "EXECUTION_FAILED",
        },
      ],
    );
    const output = await collect(
      coordinator(client).status({ chatId: "chat-a", userId: "user-a" }),
    );

    expect(output.join("\n")).toContain("business failure");
    expect(output.join("\n")).toContain("EXECUTION_FAILED");
    expect(output.join("\n")).not.toContain("hunter2");
    expect(output.join("\n")).not.toContain("Capability Gap");
  });
  it("fails closed when cancelTask returns a different Task identity", async () => {
    await seedBinding("WORKING");
    const client = new InteractiveClient({
      ...task("CANCELED"),
      taskId: "different-task",
    });
    await expect(collect(coordinator(client).cancel(turn()))).rejects.toThrow(
      "mismatched Task identity",
    );
  });

  async function seedBinding(
    status: string,
    pendingInput?: Record<string, string>,
  ): Promise<void> {
    const binding = await repository.createTaskBinding({
      openWebUiChatId: "chat-a",
      userId: "user-a",
      sdarTaskId: "task-a",
      sdarContextId: "context-a",
      status,
    });
    if (pendingInput !== undefined) {
      await repository.updateTaskBinding({
        bindingId: binding.bindingId,
        expectedVersion: binding.version,
        status,
        pendingInput,
        terminal: false,
      });
    }
  }
  function coordinator(
    client: SdarA2aClient,
    overrides: Partial<
      ConstructorParameters<typeof SdarTaskCoordinator>[0]
    > = {},
  ): SdarTaskCoordinator {
    return new SdarTaskCoordinator({
      repository,
      getClient: async () => client,
      pollingBudgetMs: 0,
      ...overrides,
    });
  }
});

class FakeClient implements SdarA2aClient {
  readonly protocolBinding = "HTTP+JSON" as const;
  readonly protocolVersion = "1.0" as const;
  readonly endpoint = "http://sdar.test/a2a";
  submitCount = 0;
  getCount = 0;
  cancelCount = 0;

  constructor(
    private readonly events: readonly NormalizedStreamEvent[],
    private readonly polled: readonly NormalizedTask[] = [],
  ) {}

  async *submitTaskStream(
    input: SubmitTaskInput,
    options?: OperationOptions,
  ): AsyncGenerator<NormalizedStreamEvent> {
    void input;
    void options;
    this.submitCount += 1;
    for (const event of this.events) yield event;
  }

  async getTask(): Promise<NormalizedTask> {
    const index = this.getCount++;
    return (
      this.polled[Math.min(index, this.polled.length - 1)] ?? task("WORKING")
    );
  }

  async cancelTask(): Promise<NormalizedTask> {
    this.cancelCount += 1;
    return task("CANCELED");
  }

  async sendFollowUp(input: FollowUpInput): Promise<NormalizedSendResult> {
    void input;
    throw new Error("not used by this test client");
  }
}

class ConcurrentSubmitClient extends FakeClient {
  readonly started: Promise<void>;
  private markStarted!: () => void;
  private continueFirst!: () => void;
  private readonly continued: Promise<void>;

  constructor() {
    super([]);
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
    this.continued = new Promise((resolve) => {
      this.continueFirst = resolve;
    });
  }

  release(): void {
    this.continueFirst();
  }

  override async *submitTaskStream(): AsyncGenerator<NormalizedStreamEvent> {
    this.submitCount += 1;
    this.markStarted();
    await this.continued;
    yield { kind: "task", task: task("COMPLETED", "only one task") };
  }
}
class InteractiveClient extends FakeClient {
  readonly followUps: FollowUpInput[] = [];

  constructor(private readonly returnedTask: NormalizedTask) {
    super([]);
  }

  override async sendFollowUp(
    input: FollowUpInput,
  ): Promise<NormalizedSendResult> {
    this.followUps.push(input);
    return { kind: "task", task: this.returnedTask };
  }

  override async cancelTask(): Promise<NormalizedTask> {
    this.cancelCount += 1;
    return this.returnedTask;
  }
}
class HangingClient extends FakeClient {
  streamSignalAborted = false;
  nextTask = task("WORKING", "still working");

  constructor() {
    super([]);
  }

  override async *submitTaskStream(
    _input: SubmitTaskInput,
    options?: OperationOptions,
  ): AsyncGenerator<NormalizedStreamEvent> {
    this.submitCount += 1;
    yield { kind: "task", task: task("WORKING", "accepted") };
    await new Promise<void>((resolve) => {
      if (options?.signal?.aborted === true) {
        this.streamSignalAborted = true;
        resolve();
        return;
      }
      options?.signal?.addEventListener(
        "abort",
        () => {
          this.streamSignalAborted = true;
          resolve();
        },
        { once: true },
      );
    });
  }

  override async getTask(): Promise<NormalizedTask> {
    this.getCount += 1;
    return this.nextTask;
  }
}

function turn() {
  return {
    userText: "do the work",
    userId: "user-a",
    chatId: "chat-a",
    userMessageId: "message-a",
  } as const;
}

function task(
  state: NormalizedTask["state"],
  message?: string,
  phaseMessage?: string,
): NormalizedTask {
  return {
    taskId: "task-a",
    contextId: "context-a",
    state,
    ...(message === undefined ? {} : { statusMessage: agentMessage(message) }),
    ...(phaseMessage === undefined ? {} : { phaseMessage }),
    artifacts: [],
  };
}

function agentMessage(text: string) {
  return {
    messageId: "agent-message",
    role: "AGENT" as const,
    parts: [{ kind: "text" as const, mediaType: "text/plain", text }],
  };
}

async function collect(fragments: AsyncIterable<string>): Promise<string[]> {
  const output: string[] = [];
  for await (const fragment of fragments) output.push(fragment);
  return output;
}
