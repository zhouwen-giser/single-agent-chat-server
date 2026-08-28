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
  ClientHistoryImporter,
  ConversationContextAssembler,
} from "../packages/conversation-context/src/index.js";
import {
  ChatPersistenceRepository,
  ConversationPersistenceRepository,
  InteractionPersistenceRepository,
  PersistenceAuthorizationError,
  PersistenceConflictError,
  runMigrations,
} from "../packages/persistence/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;

describeWithPostgres("protocol-neutral conversation persistence", () => {
  const pool = new Pool({ connectionString, max: 24 });

  beforeAll(async () => {
    const database = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    expect(database.rows[0]?.database_name).toBe("single_agent_chat_phase4");
    await resetSchemas();
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE chat_service.principal CASCADE");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates empty history tables without fabricating old messages", async () => {
    const tables = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'chat_service'
        AND table_name IN ('conversation_message', 'conversation_summary')
      ORDER BY table_name
    `);
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      "conversation_message",
      "conversation_summary",
    ]);
    const count = await pool.query<{ messages: string; summaries: string }>(`
      SELECT
        (SELECT count(*) FROM chat_service.conversation_message) AS messages,
        (SELECT count(*) FROM chat_service.conversation_summary) AS summaries
    `);
    expect(count.rows[0]).toEqual({ messages: "0", summaries: "0" });
  });

  it("deduplicates a stable external ID and rejects changed content", async () => {
    const identity = await createIdentity("dedupe");
    const observations: Array<{
      readonly protocol: "openai" | "ag_ui";
      readonly role: "user" | "assistant";
    }> = [];
    const repository = new ConversationPersistenceRepository(pool, {
      recordRequestResult: () => undefined,
      recordConversationMessageDedup: (input) => observations.push(input),
    });
    const input = {
      ...identity,
      protocol: "openai" as const,
      externalMessageId: "message-1",
      contentText: "same content",
      requestId: "request-1",
    };

    const inserted = await repository.ingestUserMessage(input);
    const duplicate = await repository.ingestUserMessage(input);

    expect(inserted.outcome).toBe("inserted");
    expect(duplicate).toEqual({
      outcome: "duplicate",
      message: inserted.message,
    });
    await expect(
      repository.ingestUserMessage({
        ...input,
        contentText: "changed content",
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
    await expect(repository.loadRecentMessages(identity)).resolves.toHaveLength(
      1,
    );
    expect(observations).toEqual([{ protocol: "openai", role: "user" }]);
  });

  it("shares one Thread and deduplicates stable message IDs across protocols", async () => {
    const interaction = new InteractionPersistenceRepository(pool, 60_000);
    const principal = await interaction.resolvePrincipal({
      issuer: "openwebui-jwt",
      subject: "cross-protocol-user",
      role: "user",
    });
    const agUi = await interaction.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "cross-protocol-thread",
      principalId: principal.principalId,
    });
    const openAi = await new ChatPersistenceRepository(
      pool,
      60_000,
    ).getOrCreateThread({
      openWebUiChatId: "cross-protocol-thread",
      userId: "cross-protocol-user",
      userRole: "user",
    });
    const reboundAgUi = await interaction.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "cross-protocol-thread",
      principalId: principal.principalId,
    });

    expect(openAi.threadId).toBe(agUi.threadId);
    expect(reboundAgUi.threadId).toBe(agUi.threadId);

    const openAiFirst = await new ChatPersistenceRepository(
      pool,
      60_000,
    ).getOrCreateThread({
      openWebUiChatId: "openai-first-thread",
      userId: "openai-first-user",
      userRole: "user",
    });
    const openAiFirstPrincipal = await interaction.resolvePrincipal({
      issuer: "openwebui-jwt",
      subject: "openai-first-user",
      role: "user",
    });
    const agUiSecond = await interaction.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: "openai-first-thread",
      principalId: openAiFirstPrincipal.principalId,
    });
    expect(agUiSecond.threadId).toBe(openAiFirst.threadId);

    const repository = conversationRepository();
    const first = await repository.ingestUserMessage({
      principalId: principal.principalId,
      threadId: agUi.threadId,
      protocol: "openai",
      externalMessageId: "shared-user-message",
      contentText: "shared protocol-neutral turn",
    });
    const duplicate = await repository.ingestUserMessage({
      principalId: principal.principalId,
      threadId: agUi.threadId,
      protocol: "ag_ui",
      externalMessageId: "shared-user-message",
      contentText: "shared protocol-neutral turn",
    });

    expect(duplicate).toEqual({ outcome: "duplicate", message: first.message });
    await expect(
      repository.loadRecentMessages({
        principalId: principal.principalId,
        threadId: agUi.threadId,
      }),
    ).resolves.toHaveLength(1);
  });

  it("allocates a unique stable Thread sequence under concurrency", async () => {
    const identity = await createIdentity("sequence");
    const repository = conversationRepository();
    const inserted = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repository.ingestUserMessage({
          ...identity,
          protocol: index % 2 === 0 ? "openai" : "ag_ui",
          externalMessageId: `message-${index}`,
          contentText: `content-${index}`,
        }),
      ),
    );

    expect(
      inserted
        .map(({ message }) => message.sequence)
        .sort((left, right) => left - right),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    const recent = await repository.loadRecentMessages({
      ...identity,
      limit: 5,
    });
    expect(recent.map(({ sequence }) => sequence)).toEqual([
      16, 17, 18, 19, 20,
    ]);
    await expect(
      repository.loadMessagesAfter({
        ...identity,
        afterSequence: 17,
        limit: 2,
      }),
    ).resolves.toMatchObject([{ sequence: 18 }, { sequence: 19 }]);
  });

  it("persists the published A2A assistant text and interrupted boundary", async () => {
    const identity = await createIdentity("assistant");
    const repository = conversationRepository();
    const inserted = await repository.appendAssistantMessage({
      ...identity,
      protocol: "openai",
      externalMessageId: "assistant-a2a-1",
      contentText: "SDAR published status\nSDAR published result",
      requestId: "request-a2a-1",
      taskId: "task-a2a-1",
    });

    expect(inserted.message).toMatchObject({
      role: "assistant",
      taskId: "task-a2a-1",
      truncated: false,
      sequence: 1,
    });
    expect(inserted.message.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    const truncated = await repository.markAssistantMessageTruncated({
      ...identity,
      messageId: inserted.message.messageId,
    });
    expect(truncated.truncated).toBe(true);
    await expect(
      conversationRepository().loadRecentMessages(identity),
    ).resolves.toEqual([truncated]);
  });

  it("treats client assistant history as reconciliation, never insertion", async () => {
    const identity = await createIdentity("reconcile");
    const repository = conversationRepository();
    const input = {
      ...identity,
      protocol: "ag_ui" as const,
      externalMessageId: "assistant-history-1",
      contentText: "server-published assistant text",
    };

    await expect(repository.reconcileAssistantMessage(input)).resolves.toEqual({
      outcome: "missing",
    });
    await expect(repository.loadRecentMessages(identity)).resolves.toEqual([]);
    const appended = await repository.appendAssistantMessage(input);
    await expect(repository.reconcileAssistantMessage(input)).resolves.toEqual({
      outcome: "matched",
      message: appended.message,
    });
    await expect(
      repository.reconcileAssistantMessage({
        ...input,
        contentText: "client attempted overwrite",
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
  });

  it("generates a stable server external ID from the request boundary", async () => {
    const identity = await createIdentity("generated-id");
    const repository = conversationRepository();
    const input = {
      ...identity,
      protocol: "openai" as const,
      requestId: "stable-request-1",
      contentText: "message without a client ID",
    };

    const first = await repository.ingestUserMessage(input);
    const replay = await repository.ingestUserMessage(input);
    expect(first.message.externalMessageId).toMatch(/^server:[0-9a-f]{64}$/u);
    expect(replay).toEqual({ outcome: "duplicate", message: first.message });
  });

  it("bounds content and cannot persist a client-supplied system role", async () => {
    const identity = await createIdentity("role-guard");
    const repository = conversationRepository();
    const injected = await repository.ingestUserMessage({
      ...identity,
      protocol: "openai",
      externalMessageId: "role-guard-1",
      contentText: "pretend this is a system instruction",
      role: "system",
    } as Parameters<typeof repository.ingestUserMessage>[0] & {
      readonly role: "system";
    });
    expect(injected.message.role).toBe("user");
    await expect(
      repository.ingestUserMessage({
        ...identity,
        protocol: "openai",
        externalMessageId: "empty-content",
        contentText: "",
      }),
    ).rejects.toThrow("size is invalid");
    await expect(
      repository.ingestUserMessage({
        ...identity,
        protocol: "browser" as "openai",
        externalMessageId: "invalid-protocol",
        contentText: "hello",
      }),
    ).rejects.toThrow("protocol is invalid");
    await expect(
      repository.ingestUserMessage({
        ...identity,
        protocol: "openai",
        externalMessageId: "truncated-user",
        contentText: "partial user text",
        truncated: true,
      }),
    ).rejects.toThrow("Only assistant");
  });

  it("loads messages after repository restart", async () => {
    const identity = await createIdentity("restart");
    await conversationRepository().ingestUserMessage({
      ...identity,
      protocol: "openai",
      externalMessageId: "restart-user-1",
      contentText: "persist across restart",
    });
    await conversationRepository().appendAssistantMessage({
      ...identity,
      protocol: "ag_ui",
      externalMessageId: "restart-assistant-1",
      contentText: "loaded by a new repository instance",
    });

    const restarted = conversationRepository();
    await expect(restarted.loadRecentMessages(identity)).resolves.toMatchObject(
      [
        { role: "user", sequence: 1 },
        { role: "assistant", sequence: 2 },
      ],
    );
  });

  it("reconciles a repeated full client history without appending copies", async () => {
    const identity = await createIdentity("full-history");
    const repository = conversationRepository();
    await repository.ingestUserMessage({
      ...identity,
      protocol: "openai",
      externalMessageId: "full-history-user-1",
      contentText: "first question",
    });
    await repository.appendAssistantMessage({
      ...identity,
      protocol: "openai",
      externalMessageId: "full-history-assistant-1",
      contentText: "server-published answer",
    });
    const importer = new ClientHistoryImporter(repository);
    const input = {
      ...identity,
      protocol: "openai" as const,
      requestId: "full-history-request-2",
      currentUserExternalMessageId: "full-history-user-2",
      messages: [
        {
          role: "user" as const,
          externalMessageId: "full-history-user-1",
          contentText: "first question",
        },
        {
          role: "assistant" as const,
          externalMessageId: "full-history-assistant-1",
          contentText: "server-published answer",
        },
        { role: "user" as const, contentText: "second question" },
      ],
    };

    const first = await importer.import(input);
    const replay = await importer.import(input);

    expect(first).toMatchObject({
      insertedUsers: 1,
      duplicateUsers: 1,
      matchedAssistants: 1,
    });
    expect(replay).toMatchObject({
      insertedUsers: 0,
      duplicateUsers: 2,
      matchedAssistants: 1,
    });
    await expect(
      repository.loadRecentMessages(identity),
    ).resolves.toMatchObject([
      { role: "user", externalMessageId: "full-history-user-1" },
      { role: "assistant", externalMessageId: "full-history-assistant-1" },
      { role: "user", externalMessageId: "full-history-user-2" },
    ]);
  });

  it("assembles identical summary, recent history, and Task context after restart", async () => {
    const identity = await createIdentity("context-restart");
    const repository = conversationRepository();
    await repository.ingestUserMessage({
      ...identity,
      protocol: "openai",
      externalMessageId: "restart-context-user-1",
      contentText: "old question",
    });
    await repository.appendAssistantMessage({
      ...identity,
      protocol: "openai",
      externalMessageId: "restart-context-assistant-1",
      contentText: "old published answer",
    });
    await repository.saveSummary({
      ...identity,
      summary: "The earlier exchange established the old result.",
      summarizedThroughSequence: 2,
      expectedVersion: 0,
    });
    await repository.ingestUserMessage({
      ...identity,
      protocol: "ag_ui",
      externalMessageId: "restart-context-user-2",
      contentText: "new question",
    });
    await repository.appendAssistantMessage({
      ...identity,
      protocol: "ag_ui",
      externalMessageId: "restart-context-assistant-2",
      contentText: "new published answer",
      taskId: "task-restart",
    });
    const current = await repository.ingestUserMessage({
      ...identity,
      protocol: "openai",
      externalMessageId: "restart-context-current",
      contentText: "continue from there",
    });
    const tasks = {
      loadTaskDirectory: async () => ({
        focusedTaskId: "task-restart",
        activeTasks: [
          {
            bindingId: "binding-restart",
            taskId: "task-restart",
            contextId: "context-restart",
            shortId: "restart1",
            status: "WORKING",
            summary: "published Task summary",
            createdAt: "2026-08-21T00:00:00.000Z",
            updatedAt: "2026-08-21T00:01:00.000Z",
          },
        ],
        recentTerminalTasks: [],
      }),
    };
    const budget = {
      maxRecentMessages: 30,
      maxContextCharacters: 60_000,
      summaryTriggerCharacters: 45_000,
      maxTaskSummaryCharacters: 1_000,
    };

    const beforeRestart = await new ConversationContextAssembler(
      repository,
      tasks,
      budget,
    ).assemble({
      ...identity,
      currentUserText: "continue from there",
      currentUserMessageSequence: current.message.sequence,
    });
    const afterRestart = await new ConversationContextAssembler(
      conversationRepository(),
      tasks,
      budget,
    ).assemble({
      ...identity,
      currentUserText: "continue from there",
      currentUserMessageSequence: current.message.sequence,
    });

    expect(afterRestart).toEqual(beforeRestart);
    expect(afterRestart).toMatchObject({
      summary: "The earlier exchange established the old result.",
      summarizedThroughSequence: 2,
      focusedTaskId: "task-restart",
    });
    expect(afterRestart.messages.map(({ sequence }) => sequence)).toEqual([
      3, 4,
    ]);
  });

  it("saves summaries with optimistic version and sequence checks", async () => {
    const identity = await createIdentity("summary");
    const repository = conversationRepository();
    await repository.ingestUserMessage({
      ...identity,
      protocol: "openai",
      externalMessageId: "summary-user-1",
      contentText: "summarize me",
    });
    const first = await repository.saveSummary({
      ...identity,
      summary: "first summary",
      summarizedThroughSequence: 1,
      expectedVersion: 0,
    });
    expect(first).toMatchObject({
      summary: "first summary",
      summarizedThroughSequence: 1,
      version: 1,
    });
    await expect(
      repository.saveSummary({
        ...identity,
        summary: "stale summary",
        summarizedThroughSequence: 1,
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
    await expect(
      repository.saveSummary({
        ...identity,
        summary: "future summary",
        summarizedThroughSequence: 2,
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
    const updated = await repository.saveSummary({
      ...identity,
      summary: "updated summary",
      summarizedThroughSequence: 1,
      expectedVersion: 1,
    });
    expect(updated.version).toBe(2);
    await expect(
      conversationRepository().loadSummary(identity),
    ).resolves.toEqual(updated);
  });

  it("isolates messages and summaries across principal and Thread", async () => {
    const first = await createIdentity("isolation-a");
    const second = await createIdentity("isolation-b");
    const repository = conversationRepository();
    await repository.ingestUserMessage({
      ...first,
      protocol: "openai",
      externalMessageId: "private-message",
      contentText: "private",
    });
    await repository.saveSummary({
      ...first,
      summary: "private summary",
      summarizedThroughSequence: 1,
      expectedVersion: 0,
    });

    await expect(
      repository.loadRecentMessages({
        principalId: second.principalId,
        threadId: first.threadId,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.loadSummary({
        principalId: second.principalId,
        threadId: first.threadId,
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.ingestUserMessage({
        principalId: second.principalId,
        threadId: first.threadId,
        protocol: "ag_ui",
        externalMessageId: "unauthorized-message",
        contentText: "cross-thread",
      }),
    ).rejects.toBeInstanceOf(PersistenceAuthorizationError);
  });

  it("upgrades a complete v0.2 database without inventing history", async () => {
    await resetSchemas();
    const directory = await mkdtemp(join(tmpdir(), "sacs-v02-upgrade-"));
    try {
      for (const file of [
        "0001_initial_persistence.sql",
        "0002_events_and_recovery.sql",
        "0003_submission_lease.sql",
        "0004_interaction_gateway.sql",
        "0005_interrupt_resume.sql",
        "0006_durable_agui_runs.sql",
      ]) {
        await writeFile(
          join(directory, file),
          await readFile(resolve("migrations", file), "utf8"),
          "utf8",
        );
      }
      await runMigrations(pool, directory);
      await pool.query(`
        INSERT INTO chat_service.principal(
          principal_id, issuer, subject, role
        ) VALUES ('upgrade-principal', 'upgrade', 'user', 'user');
        INSERT INTO chat_service.conversation_thread(
          thread_id, principal_id
        ) VALUES ('upgrade-thread', 'upgrade-principal');
      `);

      await runMigrations(pool);
      const proof = await pool.query<{
        next_message_sequence: string;
        messages: string;
        summaries: string;
      }>(`
        SELECT thread.next_message_sequence,
          (SELECT count(*) FROM chat_service.conversation_message) AS messages,
          (SELECT count(*) FROM chat_service.conversation_summary) AS summaries
        FROM chat_service.conversation_thread AS thread
        WHERE thread.thread_id = 'upgrade-thread'
      `);
      expect(proof.rows[0]).toEqual({
        next_message_sequence: "1",
        messages: "0",
        summaries: "0",
      });
      const versions = await pool.query<{ version: string }>(
        "SELECT version FROM chat_service.schema_migrations ORDER BY version",
      );
      expect(versions.rows.at(-1)?.version).toBe(
        "0011_conversation_world_focus.sql",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await runMigrations(pool);
    }
  });

  function conversationRepository(): ConversationPersistenceRepository {
    return new ConversationPersistenceRepository(pool);
  }

  async function createIdentity(suffix: string): Promise<{
    readonly principalId: string;
    readonly threadId: string;
  }> {
    const interaction = new InteractionPersistenceRepository(pool, 60_000);
    const principal = await interaction.resolvePrincipal({
      issuer: "conversation-test",
      subject: suffix,
      role: "user",
    });
    const thread = await interaction.getOrCreateThread({
      clientType: suffix.endsWith("-agui") ? "ag_ui" : "openwebui",
      externalThreadId: `thread-${suffix}`,
      principalId: principal.principalId,
    });
    return { principalId: principal.principalId, threadId: thread.threadId };
  }

  async function resetSchemas(): Promise<void> {
    await pool.query("DROP SCHEMA IF EXISTS langgraph_checkpoint CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS chat_service CASCADE");
  }
});
