import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import pg from "pg";

import type { RunAgentInput } from "../packages/ag-ui-api-contract/src/index.js";
import { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import {
  InteractionEventFactory,
  type SdarInteractionEvent,
} from "../packages/interaction-contract/src/index.js";
import {
  DurableAgUiRunService,
  legacyChatResultToInteractionEvents,
  taskRequestId,
} from "../packages/interaction-runtime/src/index.js";
import {
  AgUiTaskCoordinatorRepository,
  InteractionPersistenceRepository,
  hashJson,
  runMigrations,
  type JsonValue,
} from "../packages/persistence/src/index.js";
import type {
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

describeWithPostgres("durable AG-UI Run recovery", () => {
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
    await pool.query(`
      TRUNCATE TABLE
        chat_service.agent_card_snapshot,
        chat_service.agui_interrupt_binding,
        chat_service.interaction_run,
        chat_service.interaction_request,
        chat_service.a2a_event_cache,
        chat_service.request_idempotency,
        chat_service.conversation_task_binding,
        chat_service.client_thread_binding,
        chat_service.chat_thread_binding,
        chat_service.conversation_thread,
        chat_service.principal
      CASCADE
    `);
    repository = new InteractionPersistenceRepository(pool, 2_000);
    const principal = await repository.resolvePrincipal({
      issuer: "p08-test",
      subject: "user-a",
      role: "user",
    });
    const thread = await repository.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "external-thread-a",
      principalId: principal.principalId,
    });
    principalId = principal.principalId;
    threadId = thread.threadId;
  });

  afterAll(async () => pool.end());

  it("replays a completed local Run and rejects changed input", async () => {
    let executeCount = 0;
    const service = new DurableAgUiRunService({
      repository,
      execute: async function* (context) {
        executeCount += 1;
        const factory = new InteractionEventFactory({
          runId: context.input.runId,
          threadId: context.input.threadId,
        });
        yield required(
          factory.create("run.started", { boundary: "bounded_interaction" }),
        );
        yield required(factory.publicText("durable local response"));
        yield required(factory.create("run.finished", {}));
      },
      recoverTask: () => {
        throw new Error("No Task recovery was expected");
      },
    });

    const first = await collect(service.run(context(runInput("run-local"))));
    const replay = await collect(service.run(context(runInput("run-local"))));
    const conflict = await collect(
      service.run(context(runInput("run-local", "different input"))),
    );

    expect(executeCount).toBe(1);
    expect(replay.map((event) => event.eventType)).toEqual(
      first.map((event) => event.eventType),
    );
    expect(conflict.at(-1)?.eventType).toBe("run.error");
    expect(conflict.at(-1)?.payload.code).toBe("run_id_conflict");
  });

  it("closes an execution failure as a replayable safe ERROR Run", async () => {
    let executeCount = 0;
    const service = new DurableAgUiRunService({
      repository,
      execute: async function* () {
        executeCount += 1;
        yield* [];
        throw new Error("private upstream failure");
      },
      recoverTask: () => {
        throw new Error("No Task recovery was expected");
      },
    });

    const first = await collect(service.run(context(runInput("run-error"))));
    const replay = await collect(service.run(context(runInput("run-error"))));

    expect(executeCount).toBe(1);
    expect(first.map((event) => event.eventType)).toEqual([
      "run.started",
      "run.error",
    ]);
    expect(first.at(-1)?.payload).toEqual({
      code: "interaction_error",
      message: "The AG-UI run failed safely.",
    });
    expect(replay).toEqual(first);
    const failedRun = await repository.findAuthorizedRun({
      runId: "run-error",
      principalId,
      threadId,
    });
    expect(failedRun).toMatchObject({ status: "ERROR" });
    expect(failedRun?.taskId).toBeUndefined();
  });

  it("recovers a durable Run after a crash before A2A submission", async () => {
    const input = runInput("run-before-submit");
    const requestHash = hashJson(input as unknown as JsonValue);
    await repository.claimRequest({
      protocol: "ag_ui",
      externalRequestId: input.runId,
      principalId,
      threadId,
      requestHash,
      leaseOwner: "crashed-process",
      leaseMs: 60_000,
    });
    await repository.startOrGetRun({
      runId: input.runId,
      protocol: "ag_ui",
      principalId,
      threadId,
      externalRequestId: input.runId,
    });
    await expireClaims(input.runId);

    let executeCount = 0;
    const service = new DurableAgUiRunService({
      repository,
      execute: async function* (context) {
        executeCount += 1;
        const factory = new InteractionEventFactory({
          runId: context.input.runId,
          threadId: context.input.threadId,
        });
        yield required(factory.create("run.started", {}));
        yield required(factory.publicText("recovered before submission"));
        yield required(factory.create("run.finished", {}));
      },
      recoverTask: () => {
        throw new Error("No Task recovery was expected");
      },
    });

    await collect(service.run(context(input)));

    expect(executeCount).toBe(1);
    await expect(
      repository.findAuthorizedRun({
        runId: input.runId,
        principalId,
        threadId,
      }),
    ).resolves.toMatchObject({ status: "FINISHED" });
  });

  it("reuses the stable A2A message ID after a crash following submission", async () => {
    const input = runInput("run-after-submit");
    const outerHash = hashJson(input as unknown as JsonValue);
    const innerId = taskRequestId(input.runId);
    const innerHash = hashJson({
      chatId: threadId,
      userId: principalId,
      userMessageId: innerId,
      text: lastUserText(input),
    });
    await repository.claimRequest({
      protocol: "ag_ui",
      externalRequestId: input.runId,
      principalId,
      threadId,
      requestHash: outerHash,
      leaseOwner: "crashed-process",
      leaseMs: 60_000,
    });
    await repository.startOrGetRun({
      runId: input.runId,
      protocol: "ag_ui",
      principalId,
      threadId,
      externalRequestId: input.runId,
    });
    await repository.claimRequest({
      protocol: "ag_ui",
      externalRequestId: innerId,
      principalId,
      threadId,
      requestHash: innerHash,
      leaseOwner: "crashed-process",
      leaseMs: 60_000,
    });
    await expireClaims(input.runId);

    const client = new IdempotentSubmissionClient(innerId);
    const service = taskService(repository, coordinator(repository, client));
    await collect(service.run(context(input)));

    expect(client.messageIds).toEqual([innerId]);
    expect(client.remoteTaskCreations).toBe(1);
    await expect(
      repository.findAuthorizedTask({
        principalId,
        threadId,
        sdarTaskId: "task-p08",
      }),
    ).resolves.toBeDefined();
  });
  it("recovers an accepted Task after disconnect without resubmission or cancellation", async () => {
    const client = new HangingClient();
    const firstCoordinator = coordinator(repository, client);
    const firstService = taskService(repository, firstCoordinator);
    const abort = new AbortController();
    const firstRun = collect(
      firstService.run(context(runInput("run-task"), abort.signal)),
    );

    await client.streamStarted;
    await waitFor(async () =>
      Boolean(
        await repository.findRequestResult({
          protocol: "ag_ui",
          externalRequestId: taskRequestId("run-task"),
          principalId,
          threadId,
        }),
      ),
    );
    abort.abort();
    await firstRun;

    const disconnected = await repository.findAuthorizedRun({
      runId: "run-task",
      principalId,
      threadId,
    });
    expect(disconnected).toMatchObject({
      status: "RUNNING",
      taskId: "task-p08",
      contextId: "context-p08",
    });
    expect(client.submitCount).toBe(1);
    expect(client.cancelCount).toBe(0);

    const restartedRepository = new InteractionPersistenceRepository(
      pool,
      2_000,
    );
    const restartedCoordinator = coordinator(restartedRepository, client);
    const restartedService = taskService(
      restartedRepository,
      restartedCoordinator,
    );
    const recovered = await collect(
      restartedService.run(context(runInput("run-task"))),
    );
    const duplicate = await collect(
      restartedService.run(context(runInput("run-task"))),
    );

    expect(recovered.some((event) => event.eventType === "message.text")).toBe(
      true,
    );
    expect(duplicate.some((event) => event.eventType === "message.text")).toBe(
      true,
    );
    expect(client.submitCount).toBe(1);
    expect(client.getCount).toBe(2);
    expect(client.cancelCount).toBe(0);
    await expect(
      restartedRepository.findAuthorizedRun({
        runId: "run-task",
        principalId,
        threadId,
      }),
    ).resolves.toMatchObject({ status: "FINISHED", taskId: "task-p08" });
    await expect(
      restartedRepository.findAuthorizedTask({
        principalId,
        threadId,
        sdarTaskId: "task-p08",
      }),
    ).resolves.toMatchObject({ sdarContextId: "context-p08" });
  });

  async function expireClaims(runId: string): Promise<void> {
    await pool.query(
      `
        UPDATE chat_service.interaction_request
        SET lease_until = now() - interval '1 second'
        WHERE principal_id = $1 AND thread_id = $2
          AND external_request_id IN ($3, $4)
      `,
      [principalId, threadId, runId, taskRequestId(runId)],
    );
  }
  function context(
    input: RunAgentInput,
    signal: AbortSignal = new AbortController().signal,
  ) {
    return { input, principalId, threadId, signal };
  }
});

function taskService(
  repository: InteractionPersistenceRepository,
  coordinator: SdarTaskCoordinator,
): DurableAgUiRunService {
  return new DurableAgUiRunService({
    repository,
    execute: (context) =>
      legacyChatResultToInteractionEvents(
        coordinator.submit(
          {
            userText: lastUserText(context.input),
            userId: context.principalId,
            chatId: context.threadId,
            userMessageId: taskRequestId(context.input.runId),
          },
          context.signal,
        ),
        { runId: context.input.runId, threadId: context.input.threadId },
      ),
    recoverTask: (context, taskId) =>
      legacyChatResultToInteractionEvents(
        coordinator.statusForTask(
          {
            chatId: context.threadId,
            userId: context.principalId,
            taskId,
          },
          context.signal,
        ),
        { runId: context.input.runId, threadId: context.input.threadId },
      ),
  });
}

function coordinator(
  repository: InteractionPersistenceRepository,
  client: SdarA2aClient,
): SdarTaskCoordinator {
  return new SdarTaskCoordinator({
    repository: new AgUiTaskCoordinatorRepository(repository),
    getClient: async () => client,
    pollingBudgetMs: 0,
  });
}

class IdempotentSubmissionClient implements SdarA2aClient {
  readonly protocolBinding = "HTTP+JSON" as const;
  readonly protocolVersion = "1.0" as const;
  readonly endpoint = "http://sdar.test/a2a";
  readonly messageIds: string[] = [];
  remoteTaskCreations = 1;
  submitCount = 0;
  getCount = 0;
  cancelCount = 0;

  constructor(private readonly acceptedMessageId: string) {}

  async *submitTaskStream(
    input: SubmitTaskInput,
  ): AsyncGenerator<NormalizedStreamEvent> {
    this.submitCount += 1;
    this.messageIds.push(input.messageId);
    if (input.messageId !== this.acceptedMessageId) {
      this.remoteTaskCreations += 1;
    }
    yield { kind: "task", task: task("COMPLETED", "deduplicated result") };
  }

  async getTask(): Promise<NormalizedTask> {
    this.getCount += 1;
    return task("COMPLETED", "deduplicated result");
  }

  async cancelTask(): Promise<NormalizedTask> {
    this.cancelCount += 1;
    return task("CANCELED", "cancelled");
  }

  async sendFollowUp(): Promise<NormalizedSendResult> {
    throw new Error("not used");
  }
}
class HangingClient implements SdarA2aClient {
  readonly protocolBinding = "HTTP+JSON" as const;
  readonly protocolVersion = "1.0" as const;
  readonly endpoint = "http://sdar.test/a2a";
  readonly streamStarted: Promise<void>;
  submitCount = 0;
  getCount = 0;
  cancelCount = 0;
  private markStreamStarted!: () => void;

  constructor() {
    this.streamStarted = new Promise((resolve) => {
      this.markStreamStarted = resolve;
    });
  }

  async *submitTaskStream(
    _input: SubmitTaskInput,
    options?: OperationOptions,
  ): AsyncGenerator<NormalizedStreamEvent> {
    this.submitCount += 1;
    this.markStreamStarted();
    yield { kind: "task", task: task("WORKING", "accepted") };
    await new Promise<void>((resolve) => {
      if (options?.signal?.aborted === true) return resolve();
      options?.signal?.addEventListener("abort", () => resolve(), {
        once: true,
      });
    });
  }

  async getTask(): Promise<NormalizedTask> {
    this.getCount += 1;
    return task("WORKING", "recovered from durable binding");
  }

  async cancelTask(): Promise<NormalizedTask> {
    this.cancelCount += 1;
    return task("CANCELED", "cancelled");
  }

  async sendFollowUp(): Promise<NormalizedSendResult> {
    throw new Error("not used");
  }
}

function task(
  state: NormalizedTask["state"],
  statusMessage: string,
): NormalizedTask {
  return {
    taskId: "task-p08",
    contextId: "context-p08",
    state,
    statusMessage: {
      messageId: "agent-message-p08",
      role: "AGENT",
      parts: [{ kind: "text", mediaType: "text/plain", text: statusMessage }],
    },
    artifacts: [],
  };
}

function runInput(
  runId: string,
  text = "perform the requested task",
): RunAgentInput {
  return {
    threadId: "external-thread-a",
    runId,
    state: {},
    messages: [{ id: `${runId}:user`, role: "user", content: text }],
    tools: [],
    context: [],
    forwardedProps: {},
  };
}

function lastUserText(input: RunAgentInput): string {
  const message = [...input.messages]
    .reverse()
    .find((candidate) => candidate.role === "user");
  return typeof message?.content === "string" ? message.content : "";
}

async function collect(
  events: AsyncIterable<SdarInteractionEvent>,
): Promise<SdarInteractionEvent[]> {
  const collected: SdarInteractionEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected interaction event");
  return value;
}
