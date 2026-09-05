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
  InteractionTaskCoordinatorRepository,
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

  it("shares cross-protocol Threads while isolating principals", async () => {
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

    expect(openWebUi.threadId).toBe(agUi.threadId);
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
      result: { kind: "task", taskId: "task-1", contextId: "context-1" },
    });
    await expect(
      repository.claimRequest({ ...input, leaseOwner: "worker-b" }),
    ).resolves.toEqual({
      outcome: "replay",
      result: { kind: "task", taskId: "task-1", contextId: "context-1" },
    });
    await expect(
      repository.claimRequest({
        ...input,
        requestHash: "changed-hash",
        leaseOwner: "worker-c",
      }),
    ).resolves.toEqual({ outcome: "conflict" });
  });

  it("atomically persists and replays a bounded Message result", async () => {
    const observations: Array<{
      readonly kind: "task" | "message";
      readonly replay: boolean;
    }> = [];
    const repository = new InteractionPersistenceRepository(pool, 60_000, 8, {
      recordRequestResult: (input) => observations.push(input),
      recordConversationMessageDedup: () => undefined,
    });
    const principal = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "message-result-user",
      role: "user",
    });
    const thread = await repository.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "message-result-thread",
      principalId: principal.principalId,
    });
    const input = {
      protocol: "ag_ui" as const,
      externalRequestId: "message-result-request",
      principalId: principal.principalId,
      threadId: thread.threadId,
      requestHash: "message-result-hash",
      leaseOwner: "message-worker-a",
    };
    const claim = await repository.claimRequest(input);
    if (claim.outcome !== "acquired") throw new Error("claim not acquired");
    const result = {
      kind: "message" as const,
      messageId: "message-result-1",
      relatedTaskId: "task-related",
      contextId: "context-related",
      message: {
        messageId: "message-result-1",
        taskId: "task-related",
        contextId: "context-related",
        role: "AGENT" as const,
        parts: [
          {
            kind: "text" as const,
            mediaType: "text/plain",
            text: "stable rendered result",
          },
        ],
      },
      renderedText: "stable rendered result",
    };
    await repository.completeRequest({
      requestId: claim.requestId,
      principalId: principal.principalId,
      leaseOwner: input.leaseOwner,
      result,
    });

    await expect(
      repository.claimRequest({ ...input, leaseOwner: "message-worker-b" }),
    ).resolves.toEqual({ outcome: "replay", result });
    await expect(
      new InteractionTaskCoordinatorRepository(
        repository,
        "ag_ui",
      ).claimRequest({
        idempotencyKey: input.externalRequestId,
        userId: principal.principalId,
        openWebUiChatId: thread.threadId,
        requestHash: input.requestHash,
        leaseOwner: "message-worker-c",
      }),
    ).resolves.toEqual({ outcome: "replay", result });
    const stored = await pool.query<{
      readonly result_hash: string;
      readonly result_message_json: unknown;
    }>(
      `SELECT result_hash, result_message_json
       FROM chat_service.interaction_request
       WHERE protocol = 'ag_ui' AND external_request_id = $1`,
      [input.externalRequestId],
    );
    expect(stored.rows[0]?.result_hash).toHaveLength(64);
    expect(stored.rows[0]?.result_message_json).toEqual(result.message);
    expect(observations).toEqual([
      { kind: "message", replay: false },
      { kind: "message", replay: true },
      { kind: "message", replay: true },
    ]);
  });

  it("rejects COMPLETED requests with no result or both result variants", async () => {
    const repository = interactionRepository();
    const principal = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "invalid-result-user",
      role: "user",
    });
    const thread = await repository.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "invalid-result-thread",
      principalId: principal.principalId,
    });
    const claimInput = {
      protocol: "ag_ui" as const,
      principalId: principal.principalId,
      threadId: thread.threadId,
      requestHash: "invalid-result-hash",
      leaseOwner: "invalid-result-worker",
    };
    const noResult = await repository.claimRequest({
      ...claimInput,
      externalRequestId: "no-result",
    });
    const bothResults = await repository.claimRequest({
      ...claimInput,
      externalRequestId: "both-results",
    });
    if (noResult.outcome !== "acquired" || bothResults.outcome !== "acquired") {
      throw new Error("claims not acquired");
    }

    await expect(
      pool.query(
        `UPDATE chat_service.interaction_request
         SET status = 'COMPLETED', lease_owner = NULL, lease_until = NULL
         WHERE request_id = $1`,
        [noResult.requestId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        `UPDATE chat_service.interaction_request
         SET status = 'COMPLETED', result_kind = 'TASK',
             result_task_id = 'task-double',
             result_context_id = 'context-double',
             result_message_id = 'message-double',
             result_message_json = '{"messageId":"message-double","role":"AGENT","parts":[]}'::jsonb,
             result_rendered_text = 'double', result_hash = 'hash',
             lease_owner = NULL, lease_until = NULL
         WHERE request_id = $1`,
        [bothResults.requestId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
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
      reason: "sdar.input_required",
      inputRequestId: "input-request-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
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

  it("claims interrupt resolution durably across restart and isolates identity", async () => {
    const repository = interactionRepository();
    const principal = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "resolution-owner",
      role: "user",
    });
    const other = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "resolution-other",
      role: "user",
    });
    const thread = await repository.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "resolution-thread",
      principalId: principal.principalId,
    });
    await repository.createTaskBinding({
      principalId: principal.principalId,
      threadId: thread.threadId,
      sdarTaskId: "resolution-task",
      sdarContextId: "resolution-context",
      status: "INPUT_REQUIRED",
    });
    await repository.startRun({
      runId: "resolution-run",
      protocol: "ag_ui",
      principalId: principal.principalId,
      threadId: thread.threadId,
      externalRequestId: "resolution-request",
    });
    await repository.createInterrupt({
      interruptId: "resolution-interrupt",
      runId: "resolution-run",
      principalId: principal.principalId,
      threadId: thread.threadId,
      taskId: "resolution-task",
      contextId: "resolution-context",
      internalPhase: "awaiting_plan_confirmation",
      reason: "sdar.plan_confirmation",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const claimInput = {
      interruptId: "resolution-interrupt",
      principalId: principal.principalId,
      threadId: thread.threadId,
      taskId: "resolution-task",
      contextId: "resolution-context",
      resolutionHash: "resolution-hash-a",
    };

    await expect(
      repository.claimInterruptResolution(claimInput),
    ).resolves.toMatchObject({
      outcome: "acquired",
      interrupt: { status: "RESOLVING", resolutionHash: "resolution-hash-a" },
    });
    const restarted = interactionRepository();
    await expect(
      restarted.claimInterruptResolution(claimInput),
    ).resolves.toMatchObject({
      outcome: "in_progress",
    });
    await expect(
      restarted.claimInterruptResolution({
        ...claimInput,
        resolutionHash: "resolution-hash-b",
      }),
    ).resolves.toMatchObject({ outcome: "conflict" });
    await expect(
      restarted.claimInterruptResolution({
        ...claimInput,
        principalId: other.principalId,
      }),
    ).resolves.toEqual({ outcome: "not_found" });
    await restarted.completeInterruptResolution({
      interruptId: "resolution-interrupt",
      principalId: principal.principalId,
      resolutionHash: "resolution-hash-a",
    });
    await expect(
      interactionRepository().claimInterruptResolution(claimInput),
    ).resolves.toMatchObject({
      outcome: "replay",
      interrupt: { status: "RESOLVED" },
    });
  });

  it("expires or locally cancels interrupts without opening a new side-effect claim", async () => {
    const repository = interactionRepository();
    const principal = await repository.resolvePrincipal({
      issuer: "sacs-test",
      subject: "interrupt-lifecycle-owner",
      role: "user",
    });
    for (const [suffix, expiresAt] of [
      ["expired", "2000-01-01T00:00:00.000Z"],
      ["cancel", "2099-01-01T00:00:00.000Z"],
    ] as const) {
      const thread = await repository.getOrCreateThread({
        clientType: "ag_ui",
        externalThreadId: `${suffix}-thread`,
        principalId: principal.principalId,
      });
      await repository.createTaskBinding({
        principalId: principal.principalId,
        threadId: thread.threadId,
        sdarTaskId: `${suffix}-task`,
        sdarContextId: `${suffix}-context`,
        status: "INPUT_REQUIRED",
      });
      await repository.startRun({
        runId: `${suffix}-run`,
        protocol: "ag_ui",
        principalId: principal.principalId,
        threadId: thread.threadId,
        externalRequestId: `${suffix}-request`,
      });
      await repository.createInterrupt({
        interruptId: `${suffix}-interrupt`,
        runId: `${suffix}-run`,
        principalId: principal.principalId,
        threadId: thread.threadId,
        taskId: `${suffix}-task`,
        contextId: `${suffix}-context`,
        internalPhase: "paused",
        reason: "sdar.paused",
        expiresAt,
      });
      const resolution = {
        interruptId: `${suffix}-interrupt`,
        principalId: principal.principalId,
        threadId: thread.threadId,
        taskId: `${suffix}-task`,
        contextId: `${suffix}-context`,
        resolutionHash: `${suffix}-hash`,
      };
      if (suffix === "expired") {
        await expect(
          repository.claimInterruptResolution(resolution),
        ).resolves.toMatchObject({
          outcome: "expired",
          interrupt: { status: "CANCELLED" },
        });
      } else {
        await expect(
          repository.cancelInterrupt(resolution),
        ).resolves.toMatchObject({
          outcome: "acquired",
          interrupt: { status: "CANCELLED" },
        });
        await expect(
          repository.cancelInterrupt(resolution),
        ).resolves.toMatchObject({
          outcome: "replay",
        });
      }
    }
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
        INSERT INTO chat_service.request_idempotency(
          idempotency_key, user_id, openwebui_chat_id, request_hash,
          result_task_id, status
        ) VALUES (
          'upgrade-request', 'upgrade-user', 'upgrade-chat', 'upgrade-hash',
          'upgrade-task', 'COMPLETED'
        );
      `);

      await runMigrations(pool);
      const proof = await pool.query<{
        legacy_thread: string;
        interaction_thread: string;
        migrated_task_thread: string;
        result_kind: string;
        result_context_id: string;
      }>(`
        SELECT legacy.thread_id AS legacy_thread,
               client.internal_thread_id AS interaction_thread,
               task.conversation_thread_id AS migrated_task_thread,
               request.result_kind,
               request.result_context_id
        FROM chat_service.chat_thread_binding legacy
        JOIN chat_service.client_thread_binding client
          ON client.external_thread_id = legacy.openwebui_chat_id
         AND client.principal_id = legacy.user_id
         AND client.client_type = 'openwebui'
        JOIN chat_service.conversation_task_binding task
          ON task.thread_id = legacy.thread_id
        JOIN chat_service.interaction_request request
          ON request.thread_id = legacy.thread_id
         AND request.external_request_id = 'upgrade-request'
        WHERE task.sdar_task_id = 'upgrade-task'
      `);
      expect(proof.rows[0]).toEqual({
        legacy_thread: proof.rows[0]?.legacy_thread,
        interaction_thread: proof.rows[0]?.legacy_thread,
        migrated_task_thread: proof.rows[0]?.legacy_thread,
        result_kind: "TASK",
        result_context_id: "upgrade-context",
      });
      const versions = await pool.query<{ version: string }>(
        "SELECT version FROM chat_service.schema_migrations ORDER BY version",
      );
      expect(versions.rows.map(({ version }) => version)).toEqual([
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
        "0014_structured_world_selection.sql",
        "0015_interactive_analysis.sql",
        "0016_analysis_development_control.sql",
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
