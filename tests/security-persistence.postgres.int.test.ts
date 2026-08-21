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
  InteractionTaskCoordinatorRepository,
  InteractionPersistenceRepository,
  runMigrations,
} from "../packages/persistence/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;

describeWithPostgres("P09 persistence authorization", () => {
  const pool = new Pool({ connectionString, max: 4 });
  const repository = new InteractionPersistenceRepository(pool, 2_000);

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
  });

  afterAll(async () => pool.end());

  it("denies cross-principal Run collision and unbound Task enumeration before A2A", async () => {
    const owner = await principalThread("owner");
    const attacker = await principalThread("attacker");
    await repository.startOrGetRun({
      runId: "shared-external-run-id",
      protocol: "ag_ui",
      principalId: owner.principalId,
      threadId: owner.threadId,
      externalRequestId: "shared-external-run-id",
    });
    await repository.createTaskBinding({
      principalId: owner.principalId,
      threadId: owner.threadId,
      sdarTaskId: "owner-task",
      sdarContextId: "owner-context",
      status: "WORKING",
    });

    await expect(
      repository.startOrGetRun({
        runId: "shared-external-run-id",
        protocol: "ag_ui",
        principalId: attacker.principalId,
        threadId: attacker.threadId,
        externalRequestId: "shared-external-run-id",
      }),
    ).rejects.toThrow("not authorized");
    await expect(
      repository.findAuthorizedRun({
        runId: "shared-external-run-id",
        principalId: attacker.principalId,
        threadId: attacker.threadId,
      }),
    ).resolves.toBeUndefined();

    let clientCreations = 0;
    const coordinator = new SdarTaskCoordinator({
      repository: new InteractionTaskCoordinatorRepository(repository, "ag_ui"),
      getClient: async () => {
        clientCreations += 1;
        throw new Error("A2A must not be constructed for an unbound Task");
      },
    });
    const response = await collect(
      coordinator.statusForTask({
        chatId: attacker.threadId,
        userId: attacker.principalId,
        taskId: "owner-task",
      }),
    );

    expect(response).toEqual([
      "The requested SDAR Task is not bound to this user and chat.",
    ]);
    expect(clientCreations).toBe(0);
  });

  async function principalThread(subject: string) {
    const principal = await repository.resolvePrincipal({
      issuer: "p09-test",
      subject,
      role: "user",
    });
    const thread = await repository.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "shared-external-thread",
      principalId: principal.principalId,
    });
    return { principalId: principal.principalId, threadId: thread.threadId };
  }
});

async function collect(values: AsyncIterable<string>): Promise<string[]> {
  const collected: string[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}
