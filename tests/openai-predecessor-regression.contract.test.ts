import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../apps/server/src/bootstrap.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import { createSdarChatRunner } from "../apps/server/src/chat/sdar-chat-runner.js";
import type { SdarTaskCoordinator } from "../packages/chat-runtime/src/index.js";
import type {
  ChatPersistenceRepository,
  TaskBinding,
} from "../packages/persistence/src/index.js";
import type { StructuredChatModel } from "../src/agent/model.js";

const serviceKey = "p10-openai-service-key-at-least-32-characters";
const jwtSecret = "p10-openwebui-jwt-secret-at-least-32-characters";
const now = 1_786_377_600_000;
const config: ServerConfig = {
  serviceKey,
  agUiServiceKey: "p10-ag-ui-service-key-at-least-32-characters",
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

let server: FastifyInstance | undefined;
let activeBindings: TaskBinding[] = [];
let messageSequence = 0;

const submit = jest.fn((input: { readonly userText: string }) =>
  fragments(`submit:${input.userText}`),
);
const status = jest.fn((input: { readonly taskId: string }) =>
  fragments(`status:${input.taskId}`),
);
const followUp = jest.fn((input: { readonly action: string }) =>
  fragments(`follow_up:${input.action}`),
);
const cancel = jest.fn(() => fragments("cancel_task"));
const executeQuery = jest.fn(
  async (input: { readonly intent: string }) => `query:${input.intent}`,
);
const fixtureModel: StructuredChatModel = {
  decideTurn: async ({ currentUserText }) => decisionFor(currentUserText),
  answer: async () => "你好，我是单个 SDAR Agent 的测试聊天入口。",
};

describe("P10 OpenAI/OpenWebUI predecessor regression", () => {
  afterEach(async () => {
    await server?.close();
    server = undefined;
    activeBindings = [];
    messageSequence = 0;
    jest.clearAllMocks();
  });

  it.each([
    ["这个 Agent 有哪些能力？", "query_capabilities"],
    ["查看当前任务", "query_active_task"],
    ["task status", "query_task_status"],
    ["查看任务结果", "query_task_result"],
    ["task history", "query_task_history"],
    ["列出这个会话的任务", "list_conversation_tasks"],
    ["previous task", "query_previous_task"],
    ["当前允许的操作", "query_allowed_actions"],
    ["查看能力缺口", "query_capability_gap"],
  ])(
    "serves %s through the OpenAI entry without mutating SDAR",
    async (prompt, intent) => {
      const response = await completion(prompt, intent.length % 2 === 0);

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("单个 SDAR Agent");
      if (intent.length % 2 === 0) {
        expect(response.body.match(/data: \[DONE\]/gu)).toHaveLength(1);
      }
      expect(executeQuery).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      expect(followUp).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it.each<{
    task: TaskBinding | undefined;
    prompt: string;
    operation: "submit" | "follow_up" | "cancel";
    action?: string;
  }>([
    { task: undefined, prompt: "Execute a release audit", operation: "submit" },
    {
      task: binding("WORKING"),
      prompt: "Execute another release audit",
      operation: "submit",
    },
    {
      task: binding("WORKING"),
      prompt: "pause",
      operation: "follow_up",
      action: "pause",
    },
    {
      task: binding("WORKING"),
      prompt: "cancel the goal",
      operation: "follow_up",
      action: "cancel_goal",
    },
    {
      task: binding("INPUT_REQUIRED", "awaiting_plan_confirmation"),
      prompt: "确认",
      operation: "follow_up",
      action: "confirm_plan",
    },
    {
      task: binding("INPUT_REQUIRED", "awaiting_plan_confirmation"),
      prompt: "reject",
      operation: "follow_up",
      action: "reject_plan",
    },
    {
      task: binding("INPUT_REQUIRED", "awaiting_plan_confirmation"),
      prompt: "revise the plan",
      operation: "follow_up",
      action: "revise_plan",
    },
    {
      task: binding("INPUT_REQUIRED", "awaiting_plan_confirmation"),
      prompt: "patch the goal",
      operation: "follow_up",
      action: "patch_goal",
    },
    {
      task: binding("INPUT_REQUIRED", "awaiting_user_input"),
      prompt: "device-17",
      operation: "follow_up",
      action: "provide_input",
    },
    {
      task: binding("INPUT_REQUIRED", "paused"),
      prompt: "resume",
      operation: "follow_up",
      action: "resume",
    },
    {
      task: binding("WORKING"),
      prompt: "cancel the task",
      operation: "cancel",
    },
  ])(
    "routes predecessor mutation $prompt exactly once",
    async ({ task, prompt, operation, action }) => {
      activeBindings = task === undefined ? [] : [task];
      const response = await completion(prompt, true);

      expect(response.statusCode).toBe(200);
      expect(response.body.match(/data: \[DONE\]/gu)).toHaveLength(1);
      if (operation === "submit") {
        expect(submit).toHaveBeenCalledTimes(1);
        expect(response.body).toContain(`submit:${prompt}`);
      } else if (operation === "follow_up") {
        expect(followUp).toHaveBeenCalledTimes(1);
        expect(followUp).toHaveBeenCalledWith(
          expect.objectContaining({ action }),
          expect.any(AbortSignal),
        );
        expect(response.body).toContain(`follow_up:${action}`);
      } else {
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(response.body).toContain("cancel_task");
      }
      expect(executeQuery).not.toHaveBeenCalled();
    },
  );
  it("keeps ordinary and Open WebUI utility requests local", async () => {
    const ordinary = await completion("hello", false);
    const utility = await completion("generate a title", false, {
      "x-openwebui-task": "title_generation",
    });

    expect(ordinary.statusCode).toBe(200);
    expect(ordinary.json().choices[0].message.content).toContain(
      "单个 SDAR Agent",
    );
    expect(utility.statusCode).toBe(200);
    expect(utility.json().choices[0].message.content).toContain(
      "Single SDAR chat",
    );
    expect(submit).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("lists multiple Tasks, resolves an explicit status, and clarifies ambiguous cancellation", async () => {
    activeBindings = [
      binding("WORKING", undefined, "task-alpha", "alpha1"),
      binding("WORKING", undefined, "task-beta", "beta1"),
    ];

    const listed = await completion("list v03 tasks", false);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().choices[0].message.content).toContain("alpha1");
    expect(listed.json().choices[0].message.content).toContain("beta1");
    expect(status).not.toHaveBeenCalled();

    const explicit = await completion("status beta1", false);
    expect(explicit.statusCode).toBe(200);
    expect(explicit.json().choices[0].message.content).toContain(
      "status:task-beta",
    );
    expect(status).toHaveBeenCalledTimes(1);

    const ambiguous = await completion("cancel one of them", false);
    expect(ambiguous.statusCode).toBe(200);
    expect(ambiguous.json().choices[0].message.content).toContain(
      "multiple Tasks",
    );
    expect(ambiguous.json().choices[0].message.content).toContain("alpha1");
    expect(ambiguous.json().choices[0].message.content).toContain("beta1");
    expect(cancel).not.toHaveBeenCalled();
  });
});

async function completion(
  prompt: string,
  stream: boolean,
  extraHeaders: Record<string, string> = {},
) {
  server ??= createServer();
  messageSequence += 1;
  return server.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      "x-openwebui-user-jwt": identityJwt(),
      "x-openwebui-chat-id": "p10-chat",
      "x-openwebui-message-id": `p10-assistant-${messageSequence}`,
      "x-openwebui-user-message-id": `p10-user-${messageSequence}`,
      ...extraHeaders,
    },
    payload: {
      model: "sdar-single-agent",
      messages: [{ role: "user", content: prompt }],
      stream,
    },
  });
}

function createServer(): FastifyInstance {
  const repository = {
    listActiveTasksForChat: async () => activeBindings,
    findAuthorizedTask: async ({ sdarTaskId }: { sdarTaskId: string }) =>
      activeBindings.find((task) => task.sdarTaskId === sdarTaskId),
    touchTaskReference: async () => undefined,
  } as unknown as ChatPersistenceRepository;
  const coordinator = {
    submit,
    status,
    statusForTask: status,
    followUp,
    cancel,
  } as unknown as SdarTaskCoordinator;
  const runChat = createSdarChatRunner({
    repository,
    coordinator,
    model: fixtureModel,
  });
  return buildServer({
    config,
    now: () => now,
    runChat,
    resolveChatThread: async (input) => ({
      threadId: `${input.userId}:${input.openWebUiChatId}`,
      openWebUiChatId: input.openWebUiChatId,
      userId: input.userId,
      userRole: input.userRole,
    }),
  });
}

function binding(
  statusValue: string,
  internalPhase?: string,
  taskId = "p10-task",
  shortId = "p10task",
): TaskBinding {
  return {
    bindingId: `binding-${taskId}`,
    threadId: "p10-user:p10-chat",
    sdarTaskId: taskId,
    sdarContextId: `context-${taskId}`,
    shortId,
    status: statusValue,
    ...(internalPhase === undefined ? {} : { pendingInput: { internalPhase } }),
    version: 1,
  };
}

function decisionFor(text: string): unknown {
  if (text.startsWith("Execute")) return { kind: "new_task", taskText: text };
  if (text === "list v03 tasks") {
    return { kind: "list_tasks", includeTerminal: false };
  }
  if (text === "status beta1") {
    return { kind: "task_status", selector: { shortId: "beta1" } };
  }
  if (text === "cancel one of them") {
    return { kind: "task_cancel", selector: { reference: "only_active" } };
  }
  const followUpAction = new Map<string, string>([
    ["pause", "pause"],
    ["cancel the goal", "cancel_goal"],
    ["确认", "confirm_plan"],
    ["reject", "reject_plan"],
    ["revise the plan", "revise_plan"],
    ["patch the goal", "patch_goal"],
    ["device-17", "provide_input"],
    ["resume", "resume"],
  ]).get(text);
  if (followUpAction !== undefined) {
    return {
      kind: "task_follow_up",
      selector: { reference: "only_active" },
      action: followUpAction,
      text,
    };
  }
  if (text === "cancel the task") {
    return { kind: "task_cancel", selector: { reference: "only_active" } };
  }
  return { kind: "general_chat" };
}

async function* fragments(value: string): AsyncGenerator<string> {
  yield value;
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
