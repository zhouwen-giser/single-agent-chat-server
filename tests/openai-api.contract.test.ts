import { afterEach, describe, expect, it } from "@jest/globals";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../apps/server/src/bootstrap.js";
import { PHASE_1_PLACEHOLDER_RESPONSE } from "../apps/server/src/api/openai-routes.js";
import type { ServerConfig } from "../apps/server/src/config.js";

const serviceKey = "phase-1-test-service-key-32-bytes-minimum";
const authorization = { authorization: `Bearer ${serviceKey}` };
const config: ServerConfig = {
  serviceKey,
  host: "127.0.0.1",
  port: 3000,
  bodyLimitBytes: 1024,
  requestTimeoutMs: 5000,
  modelId: "sdar-single-agent",
};

const servers: FastifyInstance[] = [];

function createServer(): FastifyInstance {
  const server = buildServer({
    config,
    now: () => 1_700_000_000_000,
    nextId: () => "fixed-id",
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

  it("requires the exact service bearer key for OpenAI routes", async () => {
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
  });

  it("returns stable model discovery for Open WebUI", async () => {
    const response = await createServer().inject({
      method: "GET",
      url: "/v1/models",
      headers: authorization,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      object: "list",
      data: [
        {
          id: "sdar-single-agent",
          object: "model",
          created: 1_700_000_000,
          owned_by: "single-agent-chat-server",
        },
      ],
    });
  });

  it("returns an OpenAI chat completion without invoking SDAR", async () => {
    const response = await createServer().inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: authorization,
      payload: {
        model: "sdar-single-agent",
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.2,
        top_p: 0.9,
        max_completion_tokens: 128,
        user: "opaque-user",
        unsupported_but_ignored: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: "chatcmpl-fixed-id",
      object: "chat.completion",
      created: 1_700_000_000,
      model: "sdar-single-agent",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: PHASE_1_PLACEHOLDER_RESPONSE,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
  });

  it("returns standard SSE chunks, optional usage, and DONE", async () => {
    const response = await createServer().inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: authorization,
      payload: {
        model: "sdar-single-agent",
        messages: [{ role: "user", content: "hello" }],
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
      choices: [{ delta: { content: PHASE_1_PLACEHOLDER_RESPONSE } }],
    });
    expect(chunks[2]).toMatchObject({
      choices: [{ finish_reason: "stop" }],
    });
    expect(chunks[3]).toMatchObject({
      choices: [],
      usage: { total_tokens: 0 },
    });
  });

  it("rejects invalid bodies and conflicting token limits", async () => {
    const server = createServer();
    const emptyMessages = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: authorization,
      payload: { model: "sdar-single-agent", messages: [] },
    });
    const conflictingLimits = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: authorization,
      payload: {
        model: "sdar-single-agent",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 10,
        max_completion_tokens: 10,
      },
    });

    expect(emptyMessages.statusCode).toBe(400);
    expect(emptyMessages.json().error.code).toBe("invalid_request");
    expect(conflictingLimits.statusCode).toBe(400);
  });

  it("rejects an unknown model with an OpenAI error", async () => {
    const response = await createServer().inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: authorization,
      payload: {
        model: "another-model",
        messages: [{ role: "user", content: "hello" }],
      },
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
        ...authorization,
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        model: "sdar-single-agent",
        messages: [{ role: "user", content: "x".repeat(2000) }],
      }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("request_too_large");
  });
});
