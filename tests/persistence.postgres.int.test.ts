import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  ChatPersistenceRepository,
  runMigrations,
  setupPersistence,
} from "../packages/persistence/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;

describeWithPostgres("PostgreSQL persistence", () => {
  const pool = new Pool({ connectionString, max: 8 });

  beforeAll(async () => {
    const database = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    expect(database.rows[0]?.database_name).toBe("single_agent_chat_phase4");
    await resetSchemas();
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
  });

  afterAll(async () => {
    await pool.end();
  });

  it("migrates an empty database and initializes the isolated checkpoint schema", async () => {
    const runtime = await setupPersistence(config());
    await runtime.close();

    const migrations = await pool.query<{ version: string }>(
      "SELECT version FROM chat_service.schema_migrations ORDER BY version",
    );
    expect(migrations.rows.map(({ version }) => version)).toEqual([
      "0001_initial_persistence.sql",
      "0002_events_and_recovery.sql",
      "0003_submission_lease.sql",
      "0004_interaction_gateway.sql",
      "0005_interrupt_resume.sql",
      "0006_durable_agui_runs.sql",
      "0007_conversation_history.sql",
      "0008_multi_task_directory.sql",
      "0009_request_result_union.sql",
      "0010_grounding_lifecycle.sql",
      "0011_conversation_world_focus.sql",
      "0012_authority_fusion.sql",
      "0013_world_explanation.sql",
    ]);

    const checkpointTables = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'langgraph_checkpoint'
    `);
    expect(checkpointTables.rows.length).toBeGreaterThan(0);
  });

  it("upgrades a version-one database append-only", async () => {
    await resetSchemas();
    const directory = await mkdtemp(
      join(tmpdir(), "single-agent-chat-migrations-"),
    );
    try {
      const file = "0001_initial_persistence.sql";
      const sql = await readFile(resolve("migrations", file), "utf8");
      await writeFile(join(directory, file), sql, "utf8");
      await runMigrations(pool, directory);

      const beforeUpgrade = await pool.query<{ exists: boolean }>(`
        SELECT to_regclass('chat_service.a2a_event_cache') IS NOT NULL AS exists
      `);
      expect(beforeUpgrade.rows[0]?.exists).toBe(false);

      await runMigrations(pool);
      const versions = await pool.query<{ version: string; checksum: string }>(
        "SELECT version, checksum FROM chat_service.schema_migrations ORDER BY version",
      );
      expect(versions.rows).toHaveLength(13);
      expect(versions.rows[0]?.checksum).toBe(
        createHash("sha256").update(sql).digest("hex"),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serializes and recovers per-chat Task submission leases", async () => {
    const repository = repositoryFor(pool);
    await repository.getOrCreateThread({
      openWebUiChatId: "slot-chat",
      userId: "slot-user",
      userRole: "user",
    });
    await expect(
      repository.claimTaskSubmissionSlot({
        chatId: "slot-chat",
        userId: "slot-user",
        leaseOwner: "worker-a",
        leaseMs: 5_000,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.claimTaskSubmissionSlot({
        chatId: "slot-chat",
        userId: "slot-user",
        leaseOwner: "worker-b",
      }),
    ).resolves.toBe(false);
    await pool.query(`
      UPDATE chat_service.chat_thread_binding
      SET submission_lease_until = now() - interval '1 second'
      WHERE openwebui_chat_id = 'slot-chat' AND user_id = 'slot-user'
    `);
    const recovery = await repository.reconcileStartup({
      leaseOwner: "startup-worker",
    });
    expect(recovery.recoveredSubmissionSlotCount).toBe(1);
    await expect(
      repository.claimTaskSubmissionSlot({
        chatId: "slot-chat",
        userId: "slot-user",
        leaseOwner: "worker-b",
      }),
    ).resolves.toBe(true);
    await repository.releaseTaskSubmissionSlot({
      chatId: "slot-chat",
      userId: "slot-user",
      leaseOwner: "worker-b",
    });
  });
  it("restores active task bindings after a process restart", async () => {
    const firstRuntime = await setupPersistence(config());
    await firstRuntime.repository.getOrCreateThread({
      openWebUiChatId: "restart-chat",
      userId: "restart-user",
      userRole: "user",
    });
    await firstRuntime.repository.createTaskBinding({
      openWebUiChatId: "restart-chat",
      userId: "restart-user",
      sdarTaskId: "restart-task",
      sdarContextId: "restart-context",
      status: "WORKING",
    });
    await firstRuntime.close();

    const secondRuntime = await setupPersistence(config());
    try {
      const recovery = await secondRuntime.repository.reconcileStartup({
        leaseOwner: randomUUID(),
      });
      expect(
        recovery.activeBindings.map(({ sdarTaskId }) => sdarTaskId),
      ).toEqual(["restart-task"]);
    } finally {
      await secondRuntime.close();
    }
  });

  it("isolates task bindings by both chat and user", async () => {
    const repository = repositoryFor(pool);
    for (const userId of ["user-a", "user-b"]) {
      await repository.getOrCreateThread({
        openWebUiChatId: "shared-chat-id",
        userId,
        userRole: "user",
      });
    }
    await repository.createTaskBinding({
      openWebUiChatId: "shared-chat-id",
      userId: "user-a",
      sdarTaskId: "private-task",
      sdarContextId: "private-context",
      status: "WORKING",
    });

    await expect(
      repository.findAuthorizedTask({
        openWebUiChatId: "shared-chat-id",
        userId: "user-b",
        sdarTaskId: "private-task",
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.createTaskBinding({
        openWebUiChatId: "shared-chat-id",
        userId: "user-a",
        sdarTaskId: "second-active-task",
        sdarContextId: "second-context",
        status: "WORKING",
      }),
    ).resolves.toMatchObject({ sdarTaskId: "second-active-task" });
    await expect(
      repository.countActiveTasksForChat({
        chatId: "shared-chat-id",
        userId: "user-a",
      }),
    ).resolves.toBe(2);
  });

  it("ignores stale status timestamps without losing optimistic versioning", async () => {
    const repository = repositoryFor(pool);
    await repository.getOrCreateThread({
      openWebUiChatId: "stale-chat",
      userId: "stale-user",
      userRole: "user",
    });
    const binding = await repository.createTaskBinding({
      openWebUiChatId: "stale-chat",
      userId: "stale-user",
      sdarTaskId: "stale-task",
      sdarContextId: "stale-context",
      status: "SUBMITTED",
    });
    const current = await repository.updateTaskBinding({
      bindingId: binding.bindingId,
      expectedVersion: binding.version,
      status: "WORKING",
      lastStatusTimestamp: "2026-07-18T10:00:00.000Z",
      terminal: false,
    });
    const stale = await repository.updateTaskBinding({
      bindingId: current.bindingId,
      expectedVersion: current.version,
      status: "FAILED",
      lastStatusTimestamp: "2026-07-18T09:00:00.000Z",
      terminal: true,
    });
    expect(stale.status).toBe("WORKING");
    expect(stale.terminalAt).toBeUndefined();
    expect(stale.version).toBe(current.version + 1);
  });
  it("deduplicates events and never reopens a terminal binding", async () => {
    const repository = repositoryFor(pool);
    await repository.getOrCreateThread({
      openWebUiChatId: "terminal-chat",
      userId: "terminal-user",
      userRole: "user",
    });
    const binding = await repository.createTaskBinding({
      openWebUiChatId: "terminal-chat",
      userId: "terminal-user",
      sdarTaskId: "terminal-task",
      sdarContextId: "terminal-context",
      status: "WORKING",
    });
    const terminal = await repository.updateTaskBinding({
      bindingId: binding.bindingId,
      expectedVersion: binding.version,
      status: "COMPLETED",
      terminal: true,
    });
    const staleUpdate = await repository.updateTaskBinding({
      bindingId: terminal.bindingId,
      expectedVersion: terminal.version,
      status: "WORKING",
      terminal: false,
    });
    expect(staleUpdate.terminalAt).toBe(terminal.terminalAt);
    expect(staleUpdate.status).toBe("COMPLETED");

    const event = {
      taskId: "terminal-task",
      eventKind: "status-update",
      eventHash: "event-hash",
      status: "COMPLETED",
      summary: { message: "done" },
    } as const;
    await expect(repository.recordEvent(event)).resolves.toBe(true);
    await expect(repository.recordEvent(event)).resolves.toBe(false);
  });

  function config() {
    if (connectionString === undefined) {
      throw new Error("TEST_DATABASE_URL is required for PostgreSQL tests");
    }
    return {
      connectionString,
      poolMax: 4,
      operationTimeoutMs: 5_000,
      idempotencyLeaseMs: 60_000,
      maxActiveTasksPerChat: 8,
    } as const;
  }

  async function resetSchemas(): Promise<void> {
    await pool.query("DROP SCHEMA IF EXISTS langgraph_checkpoint CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS chat_service CASCADE");
  }
});

function repositoryFor(pool: pg.Pool): ChatPersistenceRepository {
  return new ChatPersistenceRepository(pool, 60_000);
}
