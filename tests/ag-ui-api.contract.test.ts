import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  AgentCapabilitiesSchema,
  EventSchemas,
  EventType,
  type AGUIEvent,
  type RunAgentInput,
} from "@ag-ui/core";
import { HttpAgent } from "@ag-ui/client";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../apps/server/src/bootstrap.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import {
  createInteractionAgUiRunHandler,
  createTextAgUiRunHandler,
  type AgUiRunHandler,
} from "../packages/ag-ui-interaction-adapter/src/index.js";
import { legacyChatResultToInteractionEvents } from "../packages/interaction-runtime/src/index.js";
import { assembleWorldExplanation } from "../packages/world-explanation-runtime/src/index.js";
import { assemblyInput } from "./world-explanation-fixtures.js";

const openAiServiceKey = "phase-5-openai-service-key-at-least-32-characters";
const agUiServiceKey = "phase-5-ag-ui-service-key-at-least-32-characters";
const jwtSecret = "phase-5-ag-ui-principal-jwt-secret-at-least-32-chars";
const nowMilliseconds = 1_700_000_000_000;
const nowSeconds = Math.floor(nowMilliseconds / 1_000);
const config: ServerConfig = {
  serviceKey: openAiServiceKey,
  agUiServiceKey,
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
const principalJwt = signPrincipal("principal-1");
const headers = {
  authorization: `Bearer ${agUiServiceKey}`,
  "x-openwebui-user-jwt": principalJwt,
};
const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("AG-UI HTTP/SSE endpoint", () => {
  it("requires its independent service key and signed principal", async () => {
    const server = createServer();
    const wrongService = await server.inject({
      method: "GET",
      url: "/ag-ui/capabilities",
      headers: {
        authorization: `Bearer ${openAiServiceKey}`,
        "x-openwebui-user-jwt": principalJwt,
      },
    });
    const missingPrincipal = await server.inject({
      method: "GET",
      url: "/ag-ui/capabilities",
      headers: { authorization: `Bearer ${agUiServiceKey}` },
    });
    const forgedPlainIdentity = await server.inject({
      method: "GET",
      url: "/ag-ui/capabilities",
      headers: {
        authorization: "Bearer " + agUiServiceKey,
        "x-user-id": "attacker",
      },
    });
    const accepted = await server.inject({
      method: "GET",
      url: "/ag-ui/capabilities",
      headers,
    });

    expect(wrongService.statusCode).toBe(401);
    expect(missingPrincipal.statusCode).toBe(401);
    expect(forgedPlainIdentity.statusCode).toBe(401);
    expect(accepted.statusCode).toBe(200);
    expect(AgentCapabilitiesSchema.parse(accepted.json())).toMatchObject({
      transport: { streaming: true, resumable: false },
      tools: { supported: false, clientProvided: false },
      multiAgent: { supported: false },
      custom: { rawEvents: false, eventCursor: false },
    });
  });

  it("fails closed on content negotiation, malformed input, and tools", async () => {
    const server = createServer();
    const wrongAccept = await server.inject({
      method: "POST",
      url: "/ag-ui",
      headers: { ...headers, accept: "application/json" },
      payload: runInput(),
    });
    const malformed = await server.inject({
      method: "POST",
      url: "/ag-ui",
      headers: { ...headers, accept: "text/event-stream" },
      payload: {},
    });
    const tools = await server.inject({
      method: "POST",
      url: "/ag-ui",
      headers: { ...headers, accept: "text/event-stream" },
      payload: {
        ...runInput(),
        tools: [
          { name: "internal_mcp", description: "forbidden", parameters: {} },
        ],
      },
    });

    expect(wrongAccept.statusCode).toBe(406);
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("invalid_run_input");
    expect(tools.statusCode).toBe(400);
    expect(tools.json().error.code).toBe("tools_not_supported");
  });

  it("maps the signed principal to an internal thread and emits official SSE", async () => {
    const resolved: Array<Record<string, string>> = [];
    const server = createServer("hello from SACS", resolved);
    const response = await server.inject({
      method: "POST",
      url: "/ag-ui",
      headers: { ...headers, accept: "text/event-stream" },
      payload: runInput(),
    });
    const events = decodeEvents(response.body);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    expect(events[2]).toMatchObject({ delta: "hello from SACS" });
    expect(resolved).toEqual([
      {
        externalThreadId: "external-thread-1",
        userId: "principal-1",
        userRole: "user",
      },
    ]);
  });

  it("publishes schema-valid persisted world explanation, map, and source events before completion", async () => {
    const explanation = assembleWorldExplanation(assemblyInput());
    const runAgUi = createInteractionAgUiRunHandler((context) =>
      legacyChatResultToInteractionEvents(
        { kind: "world_explanation", explanation },
        {
          runId: context.input.runId,
          threadId: context.internalThreadId,
        },
      ),
    );
    const response = await createServer(
      "unused",
      [],
      undefined,
      runAgUi,
    ).inject({
      method: "POST",
      url: "/ag-ui",
      headers: { ...headers, accept: "text/event-stream" },
      payload: runInput(),
    });
    const events = decodeEvents(response.body);
    const custom = events.filter(
      (event): event is AGUIEvent & { name: string; value: unknown } =>
        event.type === EventType.CUSTOM &&
        "name" in event &&
        typeof event.name === "string" &&
        "value" in event,
    );

    expect(response.statusCode).toBe(200);
    expect(custom.map(({ name }) => name)).toEqual([
      "sacs.world-explanation.v1",
      "sacs.map-projection.v1",
      "sacs.world-source-products.v1",
    ]);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    for (const event of custom) {
      expect(event.value).toEqual(
        expect.objectContaining({
          explanationId: explanation.explanationId,
          explanationHash: explanation.explanationHash,
          groundingId: explanation.grounding.groundingId,
          groundingResultHash: explanation.grounding.resultHash,
        }),
      );
    }
  });

  it("is consumed by the exact pinned official HttpAgent", async () => {
    const server = createServer("official client response");
    const eventTypes: string[] = [];
    const agent = new HttpAgent({
      url: "http://sacs.test/ag-ui",
      headers,
      threadId: "official-thread",
      initialMessages: [{ id: "user-1", role: "user", content: "hello" }],
      fetch: createInjectFetch(server),
    });

    const result = await agent.runAgent(
      { runId: "official-run" },
      {
        onEvent({ event }) {
          eventTypes.push(event.type);
        },
      },
    );

    expect(eventTypes).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    expect(result.newMessages).toMatchObject([
      { role: "assistant", content: "official client response" },
    ]);
  });

  it("turns handler failures into a bounded safe RUN_ERROR event", async () => {
    const server = createServer(async () => {
      throw new Error("password=private stack=hidden");
    });
    const response = await server.inject({
      method: "POST",
      url: "/ag-ui",
      headers: { ...headers, accept: "text/event-stream" },
      payload: runInput(),
    });
    const events = decodeEvents(response.body);

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_ERROR,
    ]);
    expect(response.body).not.toContain("private");
    expect(response.body).not.toContain("stack");
  });

  it("persists exactly the assistant deltas published through official SSE", async () => {
    const persist = jest.fn(async () => undefined);
    const server = createServer("published AG-UI answer", [], persist);

    const response = await server.inject({
      method: "POST",
      url: "/ag-ui",
      headers: { ...headers, accept: "text/event-stream" },
      payload: runInput(),
    });

    expect(response.statusCode).toBe(200);
    expect(persist).toHaveBeenCalledWith({
      principalId: "principal-1",
      internalThreadId: "internal-thread-1",
      runInput: runInput(),
      messages: [
        {
          externalMessageId: "run-1:assistant",
          contentText: "published AG-UI answer",
        },
      ],
      truncated: false,
    });
  });

  it("marks already published assistant deltas truncated after a safe failure", async () => {
    const persist = jest.fn(async () => undefined);
    const partialRun: AgUiRunHandler = async function* (context) {
      yield EventSchemas.parse({
        type: EventType.RUN_STARTED,
        threadId: context.input.threadId,
        runId: context.input.runId,
      });
      yield EventSchemas.parse({
        type: EventType.TEXT_MESSAGE_START,
        messageId: "partial-assistant",
        role: "assistant",
      });
      yield EventSchemas.parse({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "partial-assistant",
        delta: "published before failure",
      });
      throw new Error("private failure detail");
    };
    const server = createServer("unused", [], persist, partialRun);

    const response = await server.inject({
      method: "POST",
      url: "/ag-ui",
      headers: { ...headers, accept: "text/event-stream" },
      payload: runInput(),
    });

    expect(decodeEvents(response.body).map(({ type }) => type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.RUN_ERROR,
    ]);
    expect(response.body).not.toContain("private failure detail");
    expect(persist).toHaveBeenCalledWith({
      principalId: "principal-1",
      internalThreadId: "internal-thread-1",
      runInput: runInput(),
      messages: [
        {
          externalMessageId: "partial-assistant",
          contentText: "published before failure",
        },
      ],
      truncated: true,
    });
  });
});

function createServer(
  answer:
    string | ((input: { readonly userText: string }) => Promise<string>) = "ok",
  resolved: Array<Record<string, string>> = [],
  persistAgUiAssistantMessages?: Parameters<
    typeof buildServer
  >[0]["persistAgUiAssistantMessages"],
  runAgUiOverride?: AgUiRunHandler,
): FastifyInstance {
  const answerFunction =
    typeof answer === "string" ? async () => answer : answer;
  const server = buildServer({
    config,
    now: () => nowMilliseconds,
    resolveChatThread: async (input) => ({
      threadId: `${input.userId}:${input.openWebUiChatId}`,
      openWebUiChatId: input.openWebUiChatId,
      userId: input.userId,
      userRole: input.userRole,
    }),
    resolveAgUiThread: async (input) => {
      resolved.push(input);
      return {
        bindingId: "binding-1",
        clientType: "ag_ui",
        externalThreadId: input.externalThreadId,
        principalId: input.userId,
        threadId: "internal-thread-1",
      };
    },
    runChat: async () => "openai remains isolated",
    runAgUi: runAgUiOverride ?? createTextAgUiRunHandler(answerFunction),
    ...(persistAgUiAssistantMessages === undefined
      ? {}
      : { persistAgUiAssistantMessages }),
  });
  servers.push(server);
  return server;
}

function runInput(): RunAgentInput {
  return {
    threadId: "external-thread-1",
    runId: "run-1",
    state: {},
    messages: [{ id: "user-1", role: "user", content: "hello" }],
    tools: [],
    context: [],
    forwardedProps: {},
  };
}

function decodeEvents(body: string): AGUIEvent[] {
  return body.split("\n\n").flatMap((record) => {
    const data = record
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice(6);
    return data === undefined
      ? []
      : [EventSchemas.parse(JSON.parse(data) as unknown)];
  });
}

function createInjectFetch(server: FastifyInstance) {
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

function signPrincipal(subject: string): string {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "open-webui",
    sub: subject,
    role: "user",
    iat: nowSeconds - 1,
    exp: nowSeconds + 299,
  });
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${payload}`, "ascii")
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
