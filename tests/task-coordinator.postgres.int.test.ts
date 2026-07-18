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

  async sendFollowUp(): Promise<never> {
    throw new Error("not used in Phase 6");
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
