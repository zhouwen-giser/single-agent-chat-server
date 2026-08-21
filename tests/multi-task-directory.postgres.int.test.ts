import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import pg from "pg";

import {
  InteractionPersistenceRepository,
  PersistenceAuthorizationError,
  runMigrations,
} from "../packages/persistence/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const describePostgres =
  connectionString === undefined ? describe.skip : describe;

describePostgres("P05 multi-Task directory, focus, and leases", () => {
  const pool = new Pool({ connectionString, max: 8 });

  beforeAll(async () => {
    const database = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    expect(database.rows[0]?.database_name).toBe("single_agent_chat_phase4");
  });

  beforeEach(async () => {
    await resetSchema();
    await runMigrations(pool);
  });

  afterAll(async () => {
    await resetSchema();
    await pool.end();
  });

  it("binds three active Tasks to one thread with stable collision-safe short IDs and durable focus", async () => {
    const repository = new InteractionPersistenceRepository(pool, 60_000, 8);
    const { principalId, threadId } = await createThread(repository, "three");
    const first = await createTask(
      repository,
      principalId,
      threadId,
      "abcdefgh-1111",
    );
    const second = await createTask(
      repository,
      principalId,
      threadId,
      "abcdefgh-2222",
    );
    const third = await createTask(
      repository,
      principalId,
      threadId,
      "task-third",
    );

    expect(first.shortId).toBe("abcdefgh");
    expect(second.shortId).toBe("abcdefgh-222");
    expect(new Set([first.shortId, second.shortId, third.shortId]).size).toBe(
      3,
    );
    await expect(
      repository.countActiveTasksForChat({ principalId, threadId }),
    ).resolves.toBe(3);
    await expect(
      repository.findFocusedTaskForChat({ principalId, threadId }),
    ).resolves.toMatchObject({ bindingId: third.bindingId });

    const restarted = new InteractionPersistenceRepository(pool, 60_000, 8);
    const directory = await restarted.loadTaskDirectory({
      principalId,
      threadId,
    });
    expect(directory.activeTasks).toHaveLength(3);
    expect(directory.focusedTaskId).toBe(third.sdarTaskId);
    expect(directory.lastReferencedTaskId).toBe(third.sdarTaskId);
  });

  it("isolates directories by principal and rejects cross-thread focus", async () => {
    const repository = new InteractionPersistenceRepository(pool, 60_000, 8);
    const owner = await createThread(repository, "owner");
    const sibling = await createThread(
      repository,
      "sibling",
      owner.principalId,
    );
    const other = await createThread(repository, "other");
    const task = await createTask(
      repository,
      owner.principalId,
      owner.threadId,
      "owner-task",
    );

    await expect(
      repository.setFocusedTask({
        principalId: owner.principalId,
        threadId: sibling.threadId,
        bindingId: task.bindingId,
      }),
    ).rejects.toBeInstanceOf(PersistenceAuthorizationError);
    await expect(
      repository.setFocusedTask({
        principalId: other.principalId,
        threadId: owner.threadId,
        bindingId: task.bindingId,
      }),
    ).rejects.toBeInstanceOf(PersistenceAuthorizationError);
    await expect(
      repository.listActiveTasksForChat({
        principalId: other.principalId,
        threadId: owner.threadId,
      }),
    ).resolves.toEqual([]);
  });

  it("serializes submission claims and enforces the configured active limit", async () => {
    const repository = new InteractionPersistenceRepository(pool, 60_000, 2);
    const { principalId, threadId } = await createThread(repository, "limit");
    const claims = await Promise.all([
      repository.claimTaskSubmissionSlot({
        principalId,
        threadId,
        leaseOwner: "worker-a",
      }),
      repository.claimTaskSubmissionSlot({
        principalId,
        threadId,
        leaseOwner: "worker-b",
      }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const owner = claims[0] ? "worker-a" : "worker-b";
    await createTask(repository, principalId, threadId, "limit-task-1");
    await repository.releaseTaskSubmissionSlot({
      principalId,
      threadId,
      leaseOwner: owner,
    });

    await expect(
      repository.claimTaskSubmissionSlot({
        principalId,
        threadId,
        leaseOwner: "worker-c",
      }),
    ).resolves.toBe(true);
    await createTask(repository, principalId, threadId, "limit-task-2");
    await repository.releaseTaskSubmissionSlot({
      principalId,
      threadId,
      leaseOwner: "worker-c",
    });
    await expect(
      repository.claimTaskSubmissionSlot({
        principalId,
        threadId,
        leaseOwner: "worker-d",
      }),
    ).resolves.toBe(false);
  });

  it("leases one Task exclusively while allowing different Tasks in parallel", async () => {
    const repository = new InteractionPersistenceRepository(pool, 60_000, 8);
    const { principalId, threadId } = await createThread(repository, "leases");
    const first = await createTask(
      repository,
      principalId,
      threadId,
      "lease-task-1",
    );
    const second = await createTask(
      repository,
      principalId,
      threadId,
      "lease-task-2",
    );

    await expect(
      repository.claimTaskInteractionSlot({
        principalId,
        threadId,
        bindingId: first.bindingId,
        leaseOwner: "worker-a",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.claimTaskInteractionSlot({
        principalId,
        threadId,
        bindingId: first.bindingId,
        leaseOwner: "worker-b",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.claimTaskInteractionSlot({
        principalId,
        threadId,
        bindingId: second.bindingId,
        leaseOwner: "worker-b",
      }),
    ).resolves.toBe(true);
  });

  it("does not count terminal Tasks against the active limit", async () => {
    const repository = new InteractionPersistenceRepository(pool, 60_000, 1);
    const { principalId, threadId } = await createThread(
      repository,
      "terminal",
    );
    const task = await createTask(
      repository,
      principalId,
      threadId,
      "terminal-task",
    );
    await repository.updateTaskBinding({
      bindingId: task.bindingId,
      expectedVersion: task.version,
      status: "COMPLETED",
      terminal: true,
    });

    await expect(
      repository.countActiveTasksForChat({ principalId, threadId }),
    ).resolves.toBe(0);
    await expect(
      repository.claimTaskSubmissionSlot({
        principalId,
        threadId,
        leaseOwner: "worker-next",
      }),
    ).resolves.toBe(true);
  });

  it("upgrades a complete v0.2 schema and removes the one-active index", async () => {
    await resetSchema();
    await pool.query("CREATE SCHEMA chat_service");
    await pool.query(`
      CREATE TABLE chat_service.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const file of [
      "0001_initial_persistence.sql",
      "0002_events_and_recovery.sql",
    ]) {
      const sql = await readFile(
        resolve(process.cwd(), "migrations", file),
        "utf8",
      );
      await pool.query(sql);
      await pool.query(
        "INSERT INTO chat_service.schema_migrations(version, checksum) VALUES ($1, $2)",
        [file, createHash("sha256").update(sql).digest("hex")],
      );
    }

    await runMigrations(pool);
    const index = await pool.query(
      `SELECT 1 FROM pg_indexes
       WHERE schemaname = 'chat_service'
         AND indexname = 'conversation_one_active_task_per_thread'`,
    );
    expect(index.rowCount).toBe(0);
    const repository = new InteractionPersistenceRepository(pool, 60_000, 8);
    const { principalId, threadId } = await createThread(repository, "upgrade");
    await Promise.all(
      ["upgrade-1", "upgrade-2", "upgrade-3"].map((taskId) =>
        createTask(repository, principalId, threadId, taskId),
      ),
    );
    await expect(
      repository.countActiveTasksForChat({ principalId, threadId }),
    ).resolves.toBe(3);
  });

  async function resetSchema(): Promise<void> {
    await pool.query("DROP SCHEMA IF EXISTS langgraph_checkpoint CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS chat_service CASCADE");
  }
});

async function createThread(
  repository: InteractionPersistenceRepository,
  suffix: string,
  principalId?: string,
): Promise<{ readonly principalId: string; readonly threadId: string }> {
  const principal =
    principalId === undefined
      ? await repository.resolvePrincipal({
          issuer: "p05-test",
          subject: `principal-${suffix}`,
          role: "user",
        })
      : { principalId };
  const thread = await repository.getOrCreateThread({
    clientType: "openwebui",
    externalThreadId: `thread-${suffix}`,
    principalId: principal.principalId,
  });
  return { principalId: principal.principalId, threadId: thread.threadId };
}

function createTask(
  repository: InteractionPersistenceRepository,
  principalId: string,
  threadId: string,
  taskId: string,
) {
  return repository.createTaskBinding({
    principalId,
    threadId,
    sdarTaskId: taskId,
    sdarContextId: `context-${taskId}`,
    status: "WORKING",
  });
}
