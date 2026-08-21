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
import { InteractionEventFactory } from "../packages/interaction-contract/src/index.js";
import { InterruptResumeService } from "../packages/interaction-runtime/src/index.js";
import {
  InteractionPersistenceRepository,
  InteractionTaskCoordinatorRepository,
  runMigrations,
} from "../packages/persistence/src/index.js";
import type {
  FollowUpInput,
  NormalizedSendResult,
  NormalizedTask,
  SdarA2aClient,
} from "../packages/sdar-a2a-adapter/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;

describeWithPostgres("P11 multi-Task AG-UI interrupt authority", () => {
  const pool = new Pool({ connectionString, max: 8 });
  let repository: InteractionPersistenceRepository;
  let principalId: string;
  let threadId: string;

  beforeAll(async () => {
    const database = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    expect(database.rows[0]?.database_name).toBe("single_agent_chat_phase4");
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE chat_service.principal CASCADE");
    repository = new InteractionPersistenceRepository(pool, 2_000, 8);
    const principal = await repository.resolvePrincipal({
      issuer: "p11-interrupt",
      subject: "user-a",
      role: "user",
    });
    const thread = await repository.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "p11-interrupt-thread",
      principalId: principal.principalId,
    });
    principalId = principal.principalId;
    threadId = thread.threadId;
  });

  afterAll(async () => pool.end());

  it("keeps A and C interrupts open while querying B, then resumes exact A", async () => {
    for (const [taskId, contextId, status] of [
      ["task-a", "context-a", "INPUT_REQUIRED"],
      ["task-b", "context-b", "WORKING"],
      ["task-c", "context-c", "INPUT_REQUIRED"],
    ] as const) {
      await repository.createTaskBinding({
        principalId,
        threadId,
        sdarTaskId: taskId,
        sdarContextId: contextId,
        status,
      });
    }
    await repository.startRun({
      runId: "run-a",
      protocol: "ag_ui",
      principalId,
      threadId,
      externalRequestId: "run-a",
    });
    await repository.startRun({
      runId: "run-c",
      protocol: "ag_ui",
      principalId,
      threadId,
      externalRequestId: "run-c",
    });

    const client = new MultiTaskInterruptClient();
    const interrupts = new InterruptResumeService({
      repository,
      getClient: async () => client,
      now: () => new Date("2026-08-22T00:00:00.000Z"),
    });
    await interrupts.persistInputRequired({
      event: inputRequired("run-a", "task-a", "context-a", "input-a"),
      principalId,
      internalThreadId: threadId,
    });
    await interrupts.persistInputRequired({
      event: inputRequired("run-c", "task-c", "context-c", "input-c"),
      principalId,
      internalThreadId: threadId,
    });

    const coordinator = new SdarTaskCoordinator({
      repository: new InteractionTaskCoordinatorRepository(repository, "ag_ui"),
      getClient: async () => client,
      pollingBudgetMs: 0,
    });
    const status = await collect(
      coordinator.statusForTask({
        chatId: threadId,
        userId: principalId,
        taskId: "task-b",
      }),
    );
    expect(status.join("\n")).toContain("task B is working");
    expect(client.requestedTaskIds).toEqual(["task-b"]);
    await expect(
      repository.loadTaskDirectory({ principalId, threadId }),
    ).resolves.toMatchObject({ focusedTaskId: "task-b" });
    await expect(
      repository.findOpenInterruptForTask({
        principalId,
        threadId,
        taskId: "task-a",
      }),
    ).resolves.toMatchObject({ interruptId: "run-a:input-required" });
    await expect(
      repository.findOpenInterruptForTask({
        principalId,
        threadId,
        taskId: "task-c",
      }),
    ).resolves.toMatchObject({ interruptId: "run-c:input-required" });

    await expect(
      interrupts.resolve({
        entry: {
          interruptId: "run-a:input-required",
          status: "resolved",
          payload: {
            action: "provide_input",
            text: "answer A",
            inputRequestId: "input-a",
          },
        },
        principalId,
        threadId,
      }),
    ).resolves.toMatchObject({
      kind: "resolved",
      interrupt: { taskId: "task-a", status: "RESOLVED" },
    });
    expect(client.followUps).toMatchObject([
      {
        taskId: "task-a",
        contextId: "context-a",
        inputRequestId: "input-a",
      },
    ]);
    await expect(
      repository.findOpenInterruptForTask({
        principalId,
        threadId,
        taskId: "task-c",
      }),
    ).resolves.toMatchObject({ status: "OPEN" });
  });
});

class MultiTaskInterruptClient implements SdarA2aClient {
  readonly protocolBinding = "HTTP+JSON" as const;
  readonly protocolVersion = "1.0" as const;
  readonly endpoint = "http://sdar.test/a2a";
  readonly requestedTaskIds: string[] = [];
  readonly followUps: FollowUpInput[] = [];

  async *submitTaskStream(): AsyncGenerator<never> {
    yield* [] as never[];
    throw new Error("not used");
  }

  async getTask(taskId: string): Promise<NormalizedTask> {
    this.requestedTaskIds.push(taskId);
    if (taskId === "task-a") {
      return task(
        "task-a",
        "context-a",
        "INPUT_REQUIRED",
        "task A needs input",
        "input-a",
      );
    }
    if (taskId === "task-c") {
      return task(
        "task-c",
        "context-c",
        "INPUT_REQUIRED",
        "task C needs input",
        "input-c",
      );
    }
    return task("task-b", "context-b", "WORKING", "task B is working");
  }

  async cancelTask(taskId: string): Promise<NormalizedTask> {
    return task(taskId, `context-${taskId.at(-1)}`, "CANCELED", "cancelled");
  }

  async sendFollowUp(input: FollowUpInput): Promise<NormalizedSendResult> {
    this.followUps.push(input);
    return {
      kind: "message",
      message: {
        messageId: "resume-a-message",
        taskId: input.taskId,
        contextId: input.contextId,
        role: "AGENT",
        parts: [
          {
            kind: "text",
            mediaType: "text/plain",
            text: "A resumed",
          },
        ],
      },
    };
  }
}

function inputRequired(
  runId: string,
  taskId: string,
  contextId: string,
  inputRequestId: string,
) {
  const factory = new InteractionEventFactory({
    runId,
    threadId: "p11-interrupt-thread",
    nextId: () => "event",
  });
  const event = factory.create(
    "input.required",
    {
      internalPhase: "awaiting_user_input",
      inputRequestId,
      allowedActions: ["provide_input"],
    },
    { task: { taskId, contextId } },
  );
  if (event === undefined) throw new Error("input.required event missing");
  return event;
}

function task(
  taskId: string,
  contextId: string,
  state: NormalizedTask["state"],
  text: string,
  inputRequestId?: string,
): NormalizedTask {
  return {
    taskId,
    contextId,
    state,
    ...(state === "INPUT_REQUIRED"
      ? {
          internalPhase: "awaiting_user_input" as const,
          inputRequestId,
        }
      : {}),
    statusMessage: {
      messageId: `${taskId}-message`,
      role: "AGENT",
      parts: [{ kind: "text", mediaType: "text/plain", text }],
    },
    artifacts: [],
  };
}

async function collect(values: AsyncIterable<string>): Promise<string[]> {
  const output: string[] = [];
  for await (const value of values) output.push(value);
  return output;
}
