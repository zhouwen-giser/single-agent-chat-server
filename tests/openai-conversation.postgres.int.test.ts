import { createHmac } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { FastifyInstance } from "fastify";
import pg from "pg";

import { buildServer } from "../apps/server/src/bootstrap.js";
import { createSdarChatRunner } from "../apps/server/src/chat/sdar-chat-runner.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import type { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import {
  ClientHistoryImporter,
  ConversationContextAssembler,
} from "../packages/conversation-context/src/index.js";
import {
  ChatPersistenceRepository,
  ConversationPersistenceRepository,
  InteractionPersistenceRepository,
  runMigrations,
} from "../packages/persistence/src/index.js";
import type { StructuredChatModel } from "../src/agent/model.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;
const serviceKey = "p10-durable-openai-service-key-32-characters";
const jwtSecret = "p10-durable-openai-jwt-secret-32-characters";
const now = 1_787_270_400_000;
const config: ServerConfig = {
  serviceKey,
  agUiServiceKey: "p10-durable-agui-service-key-32-characters",
  openWebUiUserJwtSecret: jwtSecret,
  host: "127.0.0.1",
  port: 3000,
  bodyLimitBytes: 65_536,
  requestTimeoutMs: 5_000,
  modelId: "sdar-single-agent",
  corsAllowedOrigins: [],
  rateLimitMax: 200,
  rateLimitWindowMs: 60_000,
  maxMessages: 64,
  maxMessageChars: 32_768,
  maxResponseChars: 65_536,
  logLevel: "silent",
  streamBudgetMs: 30_000,
  pollingBudgetMs: 5_000,
  pollingIntervalMs: 1_000,
};

describeWithPostgres("P10 durable OpenAI conversation integration", () => {
  const pool = new Pool({ connectionString, max: 12 });
  let server: FastifyInstance | undefined;

  beforeAll(async () => {
    const database = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    expect(database.rows[0]?.database_name).toBe("single_agent_chat_phase4");
    await resetSchemas();
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await server?.close();
    server = undefined;
    await pool.query("TRUNCATE TABLE chat_service.principal CASCADE");
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await server?.close();
    await pool.end();
  });

  it("deduplicates repeated full history and restores two-turn context", async () => {
    const observedContexts: string[][] = [];
    const decideTurn = jest.fn(async () => ({ kind: "general_chat" }));
    const answer = jest.fn(
      async (input: Parameters<StructuredChatModel["answer"]>[0]) => {
        const history = input.context.messages.map(
          ({ role, contentText }) => `${role}:${contentText}`,
        );
        observedContexts.push(history);
        return history.length === 0
          ? "answer:first"
          : `answer:${history.join("|")}`;
      },
    );
    const model: StructuredChatModel = {
      decideTurn,
      answer,
    };
    server = createServer(model);

    const first = await completion(server, {
      assistantId: "assistant-1",
      userId: "user-1",
      messages: [{ role: "user", content: "first question" }],
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().choices[0].message.content).toBe("answer:first");

    const repeatedHistory = [
      { role: "user", content: "first question", id: "user-1" },
      { role: "assistant", content: "answer:first", id: "assistant-1" },
      { role: "user", content: "second question" },
    ];
    const second = await completion(server, {
      assistantId: "assistant-2",
      userId: "user-2",
      parentId: "assistant-1",
      messages: repeatedHistory,
    });
    const replay = await completion(server, {
      assistantId: "assistant-2",
      userId: "user-2",
      parentId: "assistant-1",
      messages: repeatedHistory,
    });

    expect(second.statusCode).toBe(200);
    expect(replay.json()).toEqual(second.json());
    expect(observedContexts).toEqual([
      [],
      ["user:first question", "assistant:answer:first"],
      ["user:first question", "assistant:answer:first"],
    ]);

    const identity = await conversationIdentity();
    const messages =
      await conversationRepository().loadRecentMessages(identity);
    expect(messages).toMatchObject([
      {
        role: "user",
        externalMessageId: "user-1",
        requestId: "user-1",
      },
      {
        role: "assistant",
        externalMessageId: "assistant-1",
        requestId: "user-1",
      },
      {
        role: "user",
        externalMessageId: "user-2",
        requestId: "user-2",
      },
      {
        role: "assistant",
        externalMessageId: "assistant-2",
        requestId: "user-2",
      },
    ]);
    expect(messages).toHaveLength(4);
  });

  it("persists the actual streamed text and leaves utility history untouched", async () => {
    const decideTurn = jest.fn(async () => ({ kind: "general_chat" }));
    const answer = jest.fn(async () => "streamed answer");
    const model: StructuredChatModel = {
      decideTurn,
      answer,
    };
    server = createServer(model);
    const streamed = await completion(server, {
      assistantId: "assistant-stream",
      userId: "user-stream",
      messages: [{ role: "user", content: "stream this" }],
      stream: true,
    });

    expect(streamed.statusCode).toBe(200);
    expect(streamed.body).toContain("streamed answer");
    expect(streamed.body).toMatch(/data: \[DONE\]\n\n$/u);
    const identity = await conversationIdentity();
    const beforeUtility =
      await conversationRepository().loadRecentMessages(identity);
    expect(beforeUtility).toMatchObject([
      { role: "user", externalMessageId: "user-stream" },
      {
        role: "assistant",
        externalMessageId: "assistant-stream",
        contentText: "streamed answer",
        truncated: false,
      },
    ]);
    const decisionCalls = decideTurn.mock.calls.length;
    const answerCalls = answer.mock.calls.length;

    const utility = await completion(server, {
      assistantId: "assistant-utility",
      userId: "user-utility",
      messages: [{ role: "user", content: "generate a title" }],
      utility: "title_generation",
    });
    expect(utility.statusCode).toBe(200);
    expect(utility.json().choices[0].message.content).toBe("Single SDAR chat");
    expect(decideTurn.mock.calls).toHaveLength(decisionCalls);
    expect(answer.mock.calls).toHaveLength(answerCalls);
    await expect(
      conversationRepository().loadRecentMessages(identity),
    ).resolves.toEqual(beforeUtility);
  });

  function createServer(model: StructuredChatModel): FastifyInstance {
    const repository = new ChatPersistenceRepository(pool, 60_000, 8);
    const interactionRepository = new InteractionPersistenceRepository(
      pool,
      60_000,
      8,
    );
    const history = conversationRepository();
    const importer = new ClientHistoryImporter(history);
    const assembler = new ConversationContextAssembler(
      history,
      interactionRepository,
      {
        maxRecentMessages: 30,
        maxContextCharacters: 60_000,
        summaryTriggerCharacters: 45_000,
        maxTaskSummaryCharacters: 1_000,
      },
    );
    const runChat = createSdarChatRunner({
      repository,
      coordinator: {} as SdarTaskCoordinator,
      model,
      assembleContext: assembler.assemble.bind(assembler),
      importHistory: importer.import.bind(importer),
    });
    return buildServer({
      config,
      now: () => now,
      nextId: () => "completion-id",
      runChat,
      resolveChatThread: (input) => repository.getOrCreateThread(input),
      persistAssistantMessage: async (input) => {
        await history.appendAssistantMessage({ ...input, protocol: "openai" });
      },
    });
  }

  function conversationRepository(): ConversationPersistenceRepository {
    return new ConversationPersistenceRepository(pool);
  }

  async function conversationIdentity(): Promise<{
    readonly principalId: string;
    readonly threadId: string;
  }> {
    const result = await pool.query<{
      readonly principal_id: string;
      readonly thread_id: string;
    }>(`
      SELECT thread.principal_id, binding.thread_id
      FROM chat_service.chat_thread_binding AS binding
      JOIN chat_service.conversation_thread AS thread
        ON thread.thread_id = binding.thread_id
      WHERE binding.openwebui_chat_id = 'p10-chat'
        AND binding.user_id = 'p10-user'
    `);
    const row = result.rows[0];
    if (row === undefined) throw new Error("P10 conversation binding missing");
    return { principalId: row.principal_id, threadId: row.thread_id };
  }

  async function resetSchemas(): Promise<void> {
    await pool.query("DROP SCHEMA IF EXISTS langgraph_checkpoint CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS chat_service CASCADE");
  }
});

async function completion(
  server: FastifyInstance,
  input: {
    readonly assistantId: string;
    readonly userId: string;
    readonly parentId?: string;
    readonly messages: readonly Readonly<Record<string, unknown>>[];
    readonly stream?: boolean;
    readonly utility?: string;
  },
) {
  return server.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      "x-openwebui-user-jwt": identityJwt(),
      "x-openwebui-chat-id": "p10-chat",
      "x-openwebui-message-id": input.assistantId,
      "x-openwebui-user-message-id": input.userId,
      ...(input.parentId === undefined
        ? {}
        : { "x-openwebui-user-message-parent-id": input.parentId }),
      ...(input.utility === undefined
        ? {}
        : { "x-openwebui-task": input.utility }),
    },
    payload: {
      model: config.modelId,
      messages: input.messages,
      stream: input.stream ?? false,
    },
  });
}

function identityJwt(): string {
  const seconds = Math.floor(now / 1_000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "open-webui",
    sub: "p10-user",
    role: "user",
    iat: seconds - 1,
    exp: seconds + 299,
  });
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${payload}`, "ascii")
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
