import { createHmac } from "node:crypto";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "@jest/globals";
import type { FastifyInstance } from "fastify";

import {
  buildServer,
  type BuildServerOptions,
} from "../apps/server/src/bootstrap.js";
import type { ChatRunnerContext } from "../apps/server/src/api/openai-routes.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import { createSecureLoggerOptions } from "../apps/server/src/observability/logging.js";

const serviceKey = "phase-1-test-service-key-32-bytes-minimum";
const jwtSecret = "phase-5-openwebui-jwt-secret-32-bytes-minimum";
const nowMilliseconds = 1_700_000_000_000;
const nowSeconds = Math.floor(nowMilliseconds / 1000);
const authorization = { authorization: "Bearer " + serviceKey };
const signedIdentity = signIdentity({ sub: "user-a" });
const identityHeaders = {
  ...authorization,
  "x-openwebui-user-jwt": signedIdentity,
};
const chatHeaders = {
  ...identityHeaders,
  "x-openwebui-chat-id": "chat-a",
  "x-openwebui-message-id": "assistant-message-a",
  "x-openwebui-user-message-id": "user-message-a",
};
const chatResponse = "thin graph response";
const config: ServerConfig = {
  serviceKey,
  openWebUiUserJwtSecret: jwtSecret,
  host: "127.0.0.1",
  port: 3000,
  bodyLimitBytes: 1024,
  requestTimeoutMs: 5000,
  modelId: "sdar-single-agent",
  rateLimitMax: 60,
  rateLimitWindowMs: 60_000,
  maxMessages: 64,
  maxMessageChars: 32_768,
  logLevel: "silent",
  streamBudgetMs: 30_000,
  pollingBudgetMs: 5_000,
  pollingIntervalMs: 1_000,
};

const servers: FastifyInstance[] = [];

function createServer(
  overrides: Partial<
    Pick<
      BuildServerOptions,
      | "config"
      | "logger"
      | "rateLimiter"
      | "readinessCheck"
      | "runChat"
      | "resolveChatThread"
    >
  > = {},
): FastifyInstance {
  const server = buildServer({
    config: overrides.config ?? config,
    ...(overrides.logger === undefined ? {} : { logger: overrides.logger }),
    ...(overrides.rateLimiter === undefined
      ? {}
      : { rateLimiter: overrides.rateLimiter }),
    ...(overrides.readinessCheck === undefined
      ? {}
      : { readinessCheck: overrides.readinessCheck }),
    now: () => nowMilliseconds,
    nextId: () => "fixed-id",
    runChat: overrides.runChat ?? (async () => chatResponse),
    resolveChatThread:
      overrides.resolveChatThread ??
      (async (input) => ({
        threadId: input.userId + ":" + input.openWebUiChatId,
        openWebUiChatId: input.openWebUiChatId,
        userId: input.userId,
        userRole: input.userRole,
      })),
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("OpenAI-compatible HTTP contracts", () => {
  it("exposes unauthenticated liveness and readiness", async () => {
    const server = createServer();
    const health = await server.inject({ method: "GET", url: "/health" });
    const ready = await server.inject({ method: "GET", url: "/ready" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: "ready",
      checks: { configuration: "ok" },
    });
  });

  it("reports dependency readiness without affecting liveness", async () => {
    const server = createServer({ readinessCheck: async () => false });
    const health = await server.inject({ method: "GET", url: "/health" });
    const ready = await server.inject({ method: "GET", url: "/ready" });

    expect(health.statusCode).toBe(200);
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      status: "not_ready",
      checks: { configuration: "ok", postgres: "unavailable" },
    });
  });

  it("propagates only a bounded safe correlation ID", async () => {
    const server = createServer();
    const accepted = await server.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "owui-request-123" },
    });
    const replaced = await server.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "unsafe request id with spaces" },
    });

    expect(accepted.headers["x-request-id"]).toBe("owui-request-123");
    expect(replaced.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/u);
  });
  it("requires the exact service bearer key before user identity", async () => {
    const server = createServer();
    const missing = await server.inject({ method: "GET", url: "/v1/models" });
    const invalid = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer incorrect" },
    });

    expect(missing.statusCode).toBe(401);
    expect(missing.headers["www-authenticate"]).toBe("Bearer");
    expect(missing.json().error.code).toBe("invalid_api_key");
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().error.code).toBe("invalid_api_key");
  });

  it("accepts a valid signed Open WebUI identity", async () => {
    const response = await createServer().inject({
      method: "GET",
      url: "/v1/models",
      headers: identityHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      object: "list",
      data: [
        {
          id: "sdar-single-agent",
          object: "model",
          created: nowSeconds,
          owned_by: "single-agent-chat-server",
        },
      ],
    });
  });

  it("rate limits an authenticated identity with a retry hint", async () => {
    const server = createServer({
      config: { ...config, rateLimitMax: 1 },
    });
    const first = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: identityHeaders,
    });
    const second = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: identityHeaders,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBe("60");
    expect(second.json().error.code).toBe("rate_limit_exceeded");
  });

  it("redacts credentials, prompts, bodies, and artifacts in Pino JSON", () => {
    let output = "";
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const server = createServer({
      logger: { ...createSecureLoggerOptions("info"), stream },
    });
    server.log.info(
      {
        authorization: serviceKey,
        token: signedIdentity,
        prompt: "private-prompt-value",
        artifact: "private-artifact-value",
        body: chatPayload(),
      },
      "redaction probe",
    );

    expect(output).toContain("[REDACTED]");
    for (const secret of [
      serviceKey,
      signedIdentity,
      "private-prompt-value",
      "private-artifact-value",
      "hello",
    ]) {
      expect(output).not.toContain(secret);
    }
  });
  it("rejects missing, expired, forged, and plaintext-only identity", async () => {
    const server = createServer();
    const missing = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: authorization,
    });
    const expired = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        ...authorization,
        "x-openwebui-user-jwt": signIdentity({
          sub: "expired-user",
          iat: nowSeconds - 400,
          exp: nowSeconds - 100,
        }),
      },
    });
    const forged = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        ...authorization,
        "x-openwebui-user-jwt": signIdentity(
          { sub: "forged-user" },
          "different-32-character-signing-secret",
        ),
      },
    });
    const plaintextOnly = await server.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        ...authorization,
        "x-openwebui-user-id": "attacker",
        "x-openwebui-user-role": "admin",
      },
    });

    for (const response of [missing, expired, forged, plaintextOnly]) {
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("invalid_user_identity");
    }
  });

  it("requires custom Chat and Message identifiers", async () => {
    const response = await createServer().inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: identityHeaders,
      payload: chatPayload(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain(
      "Open WebUI request headers",
    );
  });

  it("returns an OpenAI chat completion with authenticated context", async () => {
    let observed: ChatRunnerContext | undefined;
    const response = await createServer({
      runChat: async (context) => {
        observed = context;
        return chatResponse;
      },
    }).inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: chatHeaders,
      payload: {
        ...chatPayload(),
        temperature: 0.2,
        top_p: 0.9,
        max_completion_tokens: 128,
        user: "untrusted-opaque-user",
        unsupported_but_ignored: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(observed).toMatchObject({
      userText: "hello",
      identity: { userId: "user-a", role: "user" },
      openWebUi: {
        chatId: "chat-a",
        messageId: "assistant-message-a",
        userMessageId: "user-message-a",
      },
      threadId: "user-a:chat-a",
    });
    expect(response.json().choices[0].message.content).toBe(chatResponse);
  });

  it("isolates two signed users that present the same Chat ID", async () => {
    const contexts: ChatRunnerContext[] = [];
    const server = createServer({
      runChat: async (context) => {
        contexts.push(context);
        return chatResponse;
      },
    });
    for (const userId of ["user-a", "user-b"]) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          ...chatHeaders,
          "x-openwebui-user-jwt": signIdentity({ sub: userId }),
        },
        payload: chatPayload(),
      });
      expect(response.statusCode).toBe(200);
    }

    expect(contexts.map(({ threadId }) => threadId)).toEqual([
      "user-a:chat-a",
      "user-b:chat-a",
    ]);
  });

  it("routes utility requests through the local deterministic graph", async () => {
    const server = buildServer({
      config,
      now: () => nowMilliseconds,
      nextId: () => "utility-id",
      resolveChatThread: async (input) => ({
        threadId: "utility-thread",
        openWebUiChatId: input.openWebUiChatId,
        userId: input.userId,
        userRole: input.userRole,
      }),
    });
    servers.push(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { ...chatHeaders, "x-openwebui-task": "title_generation" },
      payload: chatPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().choices[0].message.content).toBe("Single SDAR chat");
  });

  it("returns standard SSE chunks, optional usage, and DONE", async () => {
    const response = await createServer().inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: chatHeaders,
      payload: {
        ...chatPayload(),
        stream: true,
        stream_options: { include_usage: true },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/event-stream/u);
    const frames = response.body.trim().split("\n\n");
    expect(frames.at(-1)).toBe("data: [DONE]");
    const chunks = frames
      .slice(0, -1)
      .map((frame) => JSON.parse(frame.slice("data: ".length)) as unknown);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toMatchObject({
      object: "chat.completion.chunk",
      choices: [{ delta: { role: "assistant" }, finish_reason: null }],
    });
    expect(chunks[1]).toMatchObject({
      choices: [{ delta: { content: chatResponse } }],
    });
    expect(chunks[2]).toMatchObject({
      choices: [{ finish_reason: "stop" }],
    });
    expect(chunks[3]).toMatchObject({
      choices: [],
      usage: { total_tokens: 0 },
    });
  });

  it("emits async runner fragments as distinct SSE deltas", async () => {
    const response = await createServer({
      runChat: async () =>
        (async function* () {
          yield "first progress";
          yield "second progress";
        })(),
    }).inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: chatHeaders,
      payload: { ...chatPayload(), stream: true },
    });

    const chunks = response.body
      .trim()
      .split("\n\n")
      .slice(0, -1)
      .map(
        (frame) =>
          JSON.parse(frame.slice("data: ".length)) as {
            choices: readonly { delta: { content?: string } }[];
          },
      );
    expect(chunks.map((chunk) => chunk.choices[0]?.delta.content)).toEqual([
      undefined,
      "first progress",
      "second progress",
      undefined,
    ]);
    expect(response.body).toMatch(/data: \[DONE\]\n\n$/u);
  });
  it("redacts streaming protocol failures and still terminates SSE", async () => {
    const response = await createServer({
      runChat: async () =>
        (async function* () {
          yield "published progress";
          throw new Error("Bearer secret-token internal endpoint");
        })(),
    }).inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: chatHeaders,
      payload: { ...chatPayload(), stream: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("failed safely");
    expect(response.body).not.toContain("secret-token");
    expect(response.body).toMatch(/data: \[DONE\]\n\n$/u);
  });
  it("rejects invalid bodies and conflicting token limits", async () => {
    const server = createServer();
    const emptyMessages = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: chatHeaders,
      payload: { model: "sdar-single-agent", messages: [] },
    });
    const conflictingLimits = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: chatHeaders,
      payload: {
        ...chatPayload(),
        max_tokens: 10,
        max_completion_tokens: 10,
      },
    });

    expect(emptyMessages.statusCode).toBe(400);
    expect(emptyMessages.json().error.code).toBe("invalid_request");
    expect(conflictingLimits.statusCode).toBe(400);
  });

  it("enforces configured message count and content limits", async () => {
    const server = createServer({
      config: { ...config, maxMessages: 1, maxMessageChars: 4 },
    });
    const tooLong = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: chatHeaders,
      payload: chatPayload(),
    });
    const tooMany = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: chatHeaders,
      payload: {
        model: "sdar-single-agent",
        messages: [
          { role: "user", content: "one" },
          { role: "assistant", content: "two" },
        ],
      },
    });

    for (const response of [tooLong, tooMany]) {
      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toBe(
        "Message limits were exceeded.",
      );
    }
  });
  it("rejects an unknown model with an OpenAI error", async () => {
    const response = await createServer().inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: chatHeaders,
      payload: { ...chatPayload(), model: "another-model" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({
      code: "model_not_found",
      param: "model",
    });
  });

  it("enforces the configured request body limit", async () => {
    const response = await createServer().inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        ...chatHeaders,
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        ...chatPayload(),
        messages: [{ role: "user", content: "x".repeat(2000) }],
      }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("request_too_large");
  });
});

function chatPayload() {
  return {
    model: "sdar-single-agent",
    messages: [{ role: "user", content: "hello" }],
  };
}

function signIdentity(
  overrides: {
    readonly sub: string;
    readonly iat?: number;
    readonly exp?: number;
    readonly role?: string;
  },
  secret = jwtSecret,
): string {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "open-webui",
    sub: overrides.sub,
    role: overrides.role ?? "user",
    iat: overrides.iat ?? nowSeconds - 1,
    exp: overrides.exp ?? nowSeconds + 299,
    email: overrides.sub + "@example.test",
    name: overrides.sub,
  });
  const signature = createHmac("sha256", secret)
    .update(header + "." + payload, "ascii")
    .digest("base64url");
  return header + "." + payload + "." + signature;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
