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
  InteractionPersistenceRepository,
  runMigrations,
} from "../packages/persistence/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;

describeWithPostgres("protocol-neutral interaction persistence", () => {
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

  afterAll(async () => {
    await pool.end();
  });

  it("creates protocol-neutral principals and isolated client thread bindings", async () => {
    const repository = interactionRepository();
    const first = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "user-a",
      role: "user",
    });
    const second = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "user-b",
      role: "user",
    });
    const openWebUi = await repository.getOrCreateThread({
      clientType: "openwebui",
      externalThreadId: "same-external-thread",
      principalId: first.principalId,
    });
    const agUi = await repository.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "same-external-thread",
      principalId: first.principalId,
    });
    const otherPrincipal = await repository.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "same-external-thread",
      principalId: second.principalId,
    });

    expect(openWebUi.threadId).not.toBe(agUi.threadId);
    expect(agUi.threadId).not.toBe(otherPrincipal.threadId);
    await expect(
      repository.startRun({
        runId: "unauthorized-run",
        protocol: "ag_ui",
        principalId: second.principalId,
        threadId: agUi.threadId,
        externalRequestId: "request-1",
      }),
    ).rejects.toThrow("not authorized");
  });

  it("keeps interaction request claims durable and protocol scoped", async () => {
    const repository = interactionRepository();
    const principal = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "request-user",
      role: "user",
    });
    const thread = await repository.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "request-thread",
      principalId: principal.principalId,
    });
    const input = {
      protocol: "ag_ui" as const,
      externalRequestId: "run-request-1",
      principalId: principal.principalId,
      threadId: thread.threadId,
      requestHash: "stable-hash",
      leaseOwner: "worker-a",
    };
    const claim = await repository.claimRequest(input);
    expect(claim).toMatchObject({ outcome: "acquired" });
    if (claim.outcome !== "acquired") throw new Error("claim not acquired");
    await repository.completeRequest({
      requestId: claim.requestId,
      principalId: principal.principalId,
      leaseOwner: "worker-a",
      resultTaskId: "task-1",
    });
    await expect(
      repository.claimRequest({ ...input, leaseOwner: "worker-b" }),
    ).resolves.toEqual({ outcome: "replay", resultTaskId: "task-1" });
    await expect(
      repository.claimRequest({
        ...input,
        requestHash: "changed-hash",
        leaseOwner: "worker-c",
      }),
    ).resolves.toEqual({ outcome: "conflict" });
  });

  it("lists and authorizes Tasks only inside the principal-owned internal thread", async () => {
    const repository = interactionRepository();
    const owner = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "query-owner",
      role: "user",
    });
    const other = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "query-other",
      role: "user",
    });
    const ownerThread = await repository.getOrCreateThread({
      clientType: "openwebui",
      externalThreadId: "query-owner-thread",
      principalId: owner.principalId,
    });
    const siblingThread = await repository.getOrCreateThread({
      clientType: "openwebui",
      externalThreadId: "query-sibling-thread",
      principalId: owner.principalId,
    });
    await repository.createTaskBinding({
      principalId: owner.principalId,
      threadId: ownerThread.threadId,
      sdarTaskId: "owner-task",
      sdarContextId: "owner-context",
      status: "WORKING",
    });
    await repository.createTaskBinding({
      principalId: owner.principalId,
      threadId: siblingThread.threadId,
      sdarTaskId: "sibling-task",
      sdarContextId: "sibling-context",
      status: "WORKING",
    });

    await expect(
      repository.listTaskBindings({
        principalId: owner.principalId,
        threadId: ownerThread.threadId,
      }),
    ).resolves.toMatchObject([{ sdarTaskId: "owner-task" }]);
    await expect(
      repository.listTaskBindings({
        principalId: other.principalId,
        threadId: ownerThread.threadId,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.findAuthorizedTask({
        principalId: owner.principalId,
        threadId: ownerThread.threadId,
        sdarTaskId: "sibling-task",
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.findAuthorizedTask({
        principalId: other.principalId,
        threadId: ownerThread.threadId,
        sdarTaskId: "owner-task",
      }),
    ).resolves.toBeUndefined();
  });
  it("records getTask observations only for an authorized Task binding", async () => {
    const repository = interactionRepository();
    const owner = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "observation-owner",
      role: "user",
    });
    const other = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "observation-other",
      role: "user",
    });
    const thread = await repository.getOrCreateThread({
      clientType: "openwebui",
      externalThreadId: "observation-thread",
      principalId: owner.principalId,
    });
    await repository.createTaskBinding({
      principalId: owner.principalId,
      threadId: thread.threadId,
      sdarTaskId: "observation-task",
      sdarContextId: "observation-context",
      status: "WORKING",
    });

    await expect(
      repository.recordAuthorizedTaskObservation({
        principalId: other.principalId,
        threadId: thread.threadId,
        sdarTaskId: "observation-task",
        status: "COMPLETED",
        terminal: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.recordAuthorizedTaskObservation({
        principalId: owner.principalId,
        threadId: thread.threadId,
        sdarTaskId: "observation-task",
        status: "INPUT_REQUIRED",
        pendingInput: { internalPhase: "awaiting_user_input" },
        lastStatusTimestamp: "2026-08-11T01:00:00.000Z",
        terminal: false,
      }),
    ).resolves.toMatchObject({
      status: "INPUT_REQUIRED",
      pendingInput: { internalPhase: "awaiting_user_input" },
      lastStatusTimestamp: "2026-08-11T01:00:00.000Z",
    });
  });
  it("restores an open interrupt and run after repository restart", async () => {
    const firstRepository = interactionRepository();
    const principal = await firstRepository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "interrupt-user",
      role: "user",
    });
    const thread = await firstRepository.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "interrupt-thread",
      principalId: principal.principalId,
    });
    await firstRepository.startRun({
      runId: "interrupt-run",
      protocol: "ag_ui",
      principalId: principal.principalId,
      threadId: thread.threadId,
      externalRequestId: "interrupt-request",
    });
    await firstRepository.createInterrupt({
      interruptId: "interrupt-1",
      runId: "interrupt-run",
      principalId: principal.principalId,
      threadId: thread.threadId,
      taskId: "task-1",
      contextId: "context-1",
      internalPhase: "awaiting_user_input",
      inputRequestId: "input-request-1",
    });

    const restartedRepository = interactionRepository();
    await expect(
      restartedRepository.findOpenInterrupt({
        interruptId: "interrupt-1",
        principalId: principal.principalId,
        threadId: thread.threadId,
      }),
    ).resolves.toMatchObject({
      taskId: "task-1",
      contextId: "context-1",
      internalPhase: "awaiting_user_input",
      status: "OPEN",
    });
    await expect(
      restartedRepository.findOpenInterrupt({
        interruptId: "interrupt-1",
        principalId: randomUUID(),
        threadId: thread.threadId,
      }),
    ).resolves.toBeUndefined();
  });

  it("stores only the safe Agent Card LKG projection", async () => {
    const repository = interactionRepository();
    await repository.saveAgentCardSnapshot({
      contentHash: createHash("sha256").update("safe-card").digest("hex"),
      protocolVersion: "1.0",
      specPatch: "1.0.1",
      binding: "HTTP+JSON",
      safeSkills: [{ id: "public-skill", name: "Published skill" }],
      sourceUrlHash: createHash("sha256").update("source-url").digest("hex"),
      observedAt: "2026-08-11T00:00:00.000Z",
    });
    await expect(
      repository.getLatestAgentCardSnapshot(),
    ).resolves.toMatchObject({
      protocolVersion: "1.0",
      binding: "HTTP+JSON",
      safeSkills: [{ id: "public-skill", name: "Published skill" }],
    });
  });

  it("upgrades the complete v0.1 schema without losing bindings", async () => {
    await resetSchemas();
    const directory = await mkdtemp(join(tmpdir(), "sacs-v01-upgrade-"));
    try {
      for (const file of [
        "0001_initial_persistence.sql",
        "0002_events_and_recovery.sql",
        "0003_submission_lease.sql",
      ]) {
        await writeFile(
          join(directory, file),
          await readFile(resolve("migrations", file), "utf8"),
          "utf8",
        );
      }
      await runMigrations(pool, directory);
      await pool.query(`
        INSERT INTO chat_service.chat_thread_binding(
          thread_id, openwebui_chat_id, user_id, user_role
        ) VALUES ('upgrade-thread', 'upgrade-chat', 'upgrade-user', 'user');
        INSERT INTO chat_service.conversation_task_binding(
          binding_id, thread_id, sdar_task_id, sdar_context_id, status
        ) VALUES (
          'upgrade-binding', 'upgrade-thread', 'upgrade-task',
          'upgrade-context', 'WORKING'
        );
      `);

      await runMigrations(pool);
      const proof = await pool.query<{
        legacy_thread: string;
        interaction_thread: string;
        migrated_task_thread: string;
      }>(`
        SELECT legacy.thread_id AS legacy_thread,
               client.internal_thread_id AS interaction_thread,
               task.conversation_thread_id AS migrated_task_thread
        FROM chat_service.chat_thread_binding legacy
        JOIN chat_service.client_thread_binding client
          ON client.external_thread_id = legacy.openwebui_chat_id
         AND client.principal_id = legacy.user_id
         AND client.client_type = 'openwebui'
        JOIN chat_service.conversation_task_binding task
          ON task.thread_id = legacy.thread_id
        WHERE task.sdar_task_id = 'upgrade-task'
      `);
      expect(proof.rows[0]).toEqual({
        legacy_thread: proof.rows[0]?.legacy_thread,
        interaction_thread: proof.rows[0]?.legacy_thread,
        migrated_task_thread: proof.rows[0]?.legacy_thread,
      });
      const versions = await pool.query<{ version: string }>(
        "SELECT version FROM chat_service.schema_migrations ORDER BY version",
      );
      expect(versions.rows.map(({ version }) => version)).toEqual([
        "0001_initial_persistence.sql",
        "0002_events_and_recovery.sql",
        "0003_submission_lease.sql",
        "0004_interaction_gateway.sql",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await runMigrations(pool);
    }
  });

  function interactionRepository(): InteractionPersistenceRepository {
    return new InteractionPersistenceRepository(pool, 60_000);
  }

  async function resetSchemas(): Promise<void> {
    await pool.query("DROP SCHEMA IF EXISTS langgraph_checkpoint CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS chat_service CASCADE");
  }
});
