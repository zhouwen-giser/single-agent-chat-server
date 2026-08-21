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
import { HttpAgent } from "@ag-ui/client";
import type { FastifyInstance } from "fastify";
import pg from "pg";

import { buildServer } from "../apps/server/src/bootstrap.js";
import { createSdarAgUiInteractionSource } from "../apps/server/src/chat/sdar-agui-runner.js";
import { createSdarChatRunner } from "../apps/server/src/chat/sdar-chat-runner.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import { createInteractionAgUiRunHandler } from "../packages/ag-ui-interaction-adapter/src/index.js";
import type { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import {
  ClientHistoryImporter,
  ConversationContextAssembler,
} from "../packages/conversation-context/src/index.js";
import {
  DurableAgUiRunService,
  taskRequestId,
} from "../packages/interaction-runtime/src/index.js";
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
const now = 1_787_356_800_000;
const openAiKey = "p11-openai-service-key-at-least-32-characters";
const agUiKey = "p11-agui-service-key-at-least-32-characters";
const jwtSecret = "p11-principal-jwt-secret-at-least-32-characters";
const config: ServerConfig = {
  serviceKey: openAiKey,
  agUiServiceKey: agUiKey,
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

describeWithPostgres("P11 shared OpenAI and AG-UI conversation", () => {
  const pool = new Pool({ connectionString, max: 12 });
  let server: FastifyInstance | undefined;

  beforeAll(async () => {
    const database = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    expect(database.rows[0]?.database_name).toBe("single_agent_chat_phase4");
    await pool.query("DROP SCHEMA IF EXISTS langgraph_checkpoint CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS chat_service CASCADE");
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

  it("deduplicates shared full history and restores context through the official client", async () => {
    const observedContexts: string[][] = [];
    const model: StructuredChatModel = {
      decideTurn: jest.fn(async () => ({ kind: "general_chat" })),
      answer: jest.fn(
        async (input: Parameters<StructuredChatModel["answer"]>[0]) => {
          const history = input.context.messages.map(
            ({ role, contentText }) => `${role}:${contentText}`,
          );
          observedContexts.push(history);
          return history.length === 0
            ? "answer:first"
            : `answer:${history.join("|")}`;
        },
      ),
    };
    server = createServer(model);

    const first = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${openAiKey}`,
        "x-openwebui-user-jwt": jwt("p11-user"),
        "x-openwebui-chat-id": "shared-thread",
        "x-openwebui-message-id": "assistant-1",
        "x-openwebui-user-message-id": "user-1",
      },
      payload: {
        model: config.modelId,
        messages: [{ id: "user-1", role: "user", content: "first question" }],
      },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().choices[0].message.content).toBe("answer:first");

    const eventTypes: string[] = [];
    const agent = new HttpAgent({
      url: "http://sacs.test/ag-ui",
      headers: {
        authorization: `Bearer ${agUiKey}`,
        "x-openwebui-user-jwt": jwt("p11-user"),
      },
      threadId: "shared-thread",
      initialMessages: [
        { id: "user-1", role: "user", content: "first question" },
        { id: "assistant-1", role: "assistant", content: "answer:first" },
        { id: "user-2", role: "user", content: "second question" },
      ],
      fetch: injectFetch(server),
    });
    const result = await agent.runAgent(
      { runId: "run-agui-2" },
      {
        onEvent: ({ event }) => {
          eventTypes.push(event.type);
        },
      },
    );

    expect(result.newMessages).toMatchObject([
      {
        role: "assistant",
        content: "answer:user:first question|assistant:answer:first",
      },
    ]);
    expect(eventTypes.at(0)).toBe("RUN_STARTED");
    expect(eventTypes.at(-1)).toBe("RUN_FINISHED");
    expect(observedContexts).toEqual([
      [],
      ["user:first question", "assistant:answer:first"],
    ]);

    const binding = await pool.query<{
      principal_id: string;
      internal_thread_id: string;
    }>(`
      SELECT principal_id, internal_thread_id
      FROM chat_service.client_thread_binding
      WHERE external_thread_id = 'shared-thread'
      ORDER BY client_type
    `);
    expect(
      new Set(binding.rows.map(({ internal_thread_id }) => internal_thread_id))
        .size,
    ).toBe(1);
    expect(binding.rows).toHaveLength(2);
    const identity = {
      principalId: binding.rows[0]?.principal_id ?? "missing",
      threadId: binding.rows[0]?.internal_thread_id ?? "missing",
    };
    const messages = await new ConversationPersistenceRepository(
      pool,
    ).loadRecentMessages(identity);
    expect(messages).toMatchObject([
      { role: "user", externalMessageId: "user-1", protocol: "openai" },
      {
        role: "assistant",
        externalMessageId: "assistant-1",
        protocol: "openai",
      },
      { role: "user", externalMessageId: "user-2", protocol: "ag_ui" },
      {
        role: "assistant",
        contentText: "answer:user:first question|assistant:answer:first",
        protocol: "ag_ui",
        truncated: false,
      },
    ]);
    expect(messages).toHaveLength(4);
  });

  function createServer(model: StructuredChatModel): FastifyInstance {
    const chatRepository = new ChatPersistenceRepository(pool, 60_000, 8);
    const interactionRepository = new InteractionPersistenceRepository(
      pool,
      60_000,
      8,
    );
    const conversationRepository = new ConversationPersistenceRepository(pool);
    const importer = new ClientHistoryImporter(conversationRepository);
    const assembler = new ConversationContextAssembler(
      conversationRepository,
      interactionRepository,
      {
        maxRecentMessages: 30,
        maxContextCharacters: 60_000,
        summaryTriggerCharacters: 45_000,
        maxTaskSummaryCharacters: 1_000,
      },
    );
    const shared = {
      coordinator: {} as SdarTaskCoordinator,
      model,
      assembleContext: assembler.assemble.bind(assembler),
      importHistory: importer.import.bind(importer),
    };
    const agUiSource = createSdarAgUiInteractionSource({
      repository: interactionRepository,
      ...shared,
    });
    const durable = new DurableAgUiRunService({
      repository: interactionRepository,
      execute: agUiSource,
      recoverTask: () => {
        throw new Error("No Task recovery expected for general chat");
      },
    });
    const runAgUi = createInteractionAgUiRunHandler((context) =>
      durable.run({
        input: context.input,
        principalId: context.principalId,
        threadId: context.internalThreadId,
        signal: context.signal,
      }),
    );
    return buildServer({
      config,
      now: () => now,
      nextId: () => "p11-completion",
      resolveChatThread: (input) => chatRepository.getOrCreateThread(input),
      runChat: createSdarChatRunner({ repository: chatRepository, ...shared }),
      persistAssistantMessage: async (input) => {
        await conversationRepository.appendAssistantMessage({
          ...input,
          protocol: "openai",
        });
      },
      resolveAgUiThread: async (input) => {
        const principal = await interactionRepository.resolvePrincipal({
          issuer: "openwebui-jwt",
          subject: input.userId,
          role: input.userRole,
        });
        return interactionRepository.getOrCreateThread({
          clientType: "ag_ui",
          externalThreadId: input.externalThreadId,
          principalId: principal.principalId,
        });
      },
      runAgUi,
      persistAgUiAssistantMessages: async (input) => {
        const run = await interactionRepository.findAuthorizedRun({
          runId: input.runInput.runId,
          principalId: input.principalId,
          threadId: input.internalThreadId,
        });
        for (const message of input.messages) {
          await conversationRepository.appendAssistantMessage({
            principalId: input.principalId,
            threadId: input.internalThreadId,
            protocol: "ag_ui",
            externalMessageId: message.externalMessageId,
            requestId: taskRequestId(input.runInput.runId),
            contentText: message.contentText,
            ...(run?.taskId === undefined ? {} : { taskId: run.taskId }),
            truncated: input.truncated,
          });
        }
      },
    });
  }
});

function injectFetch(server: FastifyInstance) {
  return async (_url: string, init: RequestInit): Promise<Response> => {
    const requestHeaders: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      requestHeaders[name] = value;
    });
    const response = await server.inject({
      method: (init.method ?? "POST") as "POST",
      url: "/ag-ui",
      headers: requestHeaders,
      payload: typeof init.body === "string" ? init.body : undefined,
    });
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) {
        value.forEach((item) => responseHeaders.append(name, item));
      } else if (value !== undefined) {
        responseHeaders.set(name, String(value));
      }
    }
    return new Response(new Uint8Array(response.rawPayload), {
      status: response.statusCode,
      headers: responseHeaders,
    });
  };
}

function jwt(subject: string): string {
  const seconds = Math.floor(now / 1_000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "open-webui",
    sub: subject,
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
