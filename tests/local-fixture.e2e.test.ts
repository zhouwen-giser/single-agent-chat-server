import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it } from "@jest/globals";
import type { FastifyInstance } from "fastify";

import type { ChatRunnerContext } from "../apps/server/src/api/openai-routes.js";
import { buildServer } from "../apps/server/src/bootstrap.js";
import type { ServerConfig } from "../apps/server/src/config.js";

const nowMilliseconds = 1_700_000_000_000;
const nowSeconds = Math.floor(nowMilliseconds / 1_000);
const serviceKey = "phase-13-fixture-service-key-32-bytes";
const jwtSecret = "phase-13-fixture-jwt-secret-32-bytes";
const config: ServerConfig = {
  serviceKey,
  agUiServiceKey: "phase-5-ag-ui-service-key-at-least-32-characters",
  openWebUiUserJwtSecret: jwtSecret,
  host: "127.0.0.1",
  port: 3000,
  bodyLimitBytes: 16_384,
  requestTimeoutMs: 5_000,
  modelId: "sdar-single-agent",
  corsAllowedOrigins: [],
  rateLimitMax: 60,
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

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("Phase 13 deterministic local fixture E2E", () => {
  it("covers model discovery, ordinary chat, utility isolation, user isolation, and complete SSE", async () => {
    const observed: ChatRunnerContext[] = [];
    server = buildServer({
      config,
      now: () => nowMilliseconds,
      nextId: () => "fixture-id",
      resolveChatThread: async (input) => ({
        threadId: input.userId + ":" + input.openWebUiChatId,
        openWebUiChatId: input.openWebUiChatId,
        userId: input.userId,
        userRole: input.userRole,
      }),
      runChat: async (context) => {
        observed.push(context);
        if (context.openWebUi.utilityTask !== undefined) {
          return "Single SDAR chat";
        }
        if (context.userText === "stream") {
          return fragments("fixture", "stream");
        }
        return "fixture ordinary response";
      },
    });

    const models = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: identityHeaders("user-a"),
    });
    expect(models.statusCode).toBe(200);
    expect(models.json().data[0].id).toBe("sdar-single-agent");

    const ordinary = await completion("user-a", "shared-chat", "ordinary");
    expect(ordinary.statusCode).toBe(200);
    expect(ordinary.json().choices[0].message.content).toBe(
      "fixture ordinary response",
    );

    const isolated = await completion("user-b", "shared-chat", "ordinary");
    expect(isolated.statusCode).toBe(200);

    const utility = await completion("user-a", "utility-chat", "title", {
      "x-openwebui-task": "title_generation",
    });
    expect(utility.json().choices[0].message.content).toBe("Single SDAR chat");

    const streaming = await completion(
      "user-a",
      "stream-chat",
      "stream",
      {},
      true,
    );
    expect(streaming.statusCode).toBe(200);
    expect(streaming.headers["content-type"]).toMatch(/^text\/event-stream/u);
    expect(streaming.body).toContain('"content":"fixture"');
    expect(streaming.body).toContain('"content":"stream"');
    expect(streaming.body).toMatch(/data: \[DONE\]\n\n$/u);

    expect(observed.map((context) => context.threadId)).toEqual([
      "user-a:shared-chat",
      "user-b:shared-chat",
      "user-a:utility-chat",
      "user-a:stream-chat",
    ]);
    expect(observed[2]?.openWebUi.utilityTask).toBe("title_generation");
  });
});

async function completion(
  userId: string,
  chatId: string,
  content: string,
  additionalHeaders: Record<string, string> = {},
  stream = false,
) {
  if (server === undefined) throw new Error("fixture server was not started");
  return server.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      ...identityHeaders(userId),
      "x-openwebui-chat-id": chatId,
      "x-openwebui-message-id": chatId + "-assistant",
      "x-openwebui-user-message-id": chatId + "-user",
      ...additionalHeaders,
    },
    payload: {
      model: "sdar-single-agent",
      messages: [{ role: "user", content }],
      stream,
    },
  });
}

function identityHeaders(userId: string): Record<string, string> {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "open-webui",
    sub: userId,
    role: "user",
    iat: nowSeconds - 1,
    exp: nowSeconds + 299,
  });
  const signature = createHmac("sha256", jwtSecret)
    .update(header + "." + payload, "ascii")
    .digest("base64url");
  return {
    authorization: "Bearer " + serviceKey,
    "x-openwebui-user-jwt": header + "." + payload + "." + signature,
  };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function* fragments(...values: string[]): AsyncGenerator<string> {
  for (const value of values) yield value;
}
