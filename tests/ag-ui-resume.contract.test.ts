import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it } from "@jest/globals";
import { EventType, type AGUIEvent, type RunAgentInput } from "@ag-ui/core";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../apps/server/src/bootstrap.js";
import type { ServerConfig } from "../apps/server/src/config.js";

const agUiServiceKey = "phase-7-ag-ui-service-key-at-least-32-characters";
const jwtSecret = "phase-7-ag-ui-principal-jwt-secret-at-least-32-chars";
const nowMilliseconds = 1_700_000_000_000;
const nowSeconds = Math.floor(nowMilliseconds / 1_000);
const config: ServerConfig = {
  serviceKey: "phase-7-openai-service-key-at-least-32-characters",
  agUiServiceKey,
  openWebUiUserJwtSecret: jwtSecret,
  host: "127.0.0.1",
  port: 3000,
  bodyLimitBytes: 16_384,
  requestTimeoutMs: 5_000,
  modelId: "sdar-single-agent",
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
const headers = {
  authorization: `Bearer ${agUiServiceKey}`,
  "x-openwebui-user-jwt": signPrincipal("principal-1"),
  accept: "text/event-stream",
};
const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("official AG-UI ResumeEntry contract", () => {
  it("passes an official resolved ResumeEntry to the authenticated handler", async () => {
    const captured: RunAgentInput[] = [];
    const server = createServer(captured);
    const input = runInput([
      {
        interruptId: "run-previous:input-required",
        status: "resolved",
        payload: {
          action: "provide_input",
          text: "published answer",
          inputRequestId: "input-1",
        },
      },
    ]);

    const response = await server.inject({
      method: "POST",
      url: "/ag-ui",
      headers,
      payload: input,
    });

    expect(response.statusCode).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.resume).toEqual(input.resume);
    expect(decodeTypes(response.body)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
  });

  it("rejects malformed ResumeEntry status before principal thread execution", async () => {
    const captured: RunAgentInput[] = [];
    const server = createServer(captured);
    const response = await server.inject({
      method: "POST",
      url: "/ag-ui",
      headers,
      payload: {
        ...runInput(),
        resume: [
          {
            interruptId: "run-previous:input-required",
            status: "done",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_run_input");
    expect(captured).toHaveLength(0);
  });
});

function createServer(captured: RunAgentInput[]): FastifyInstance {
  const server = buildServer({
    config,
    now: () => nowMilliseconds,
    resolveChatThread: async (input) => ({
      threadId: `${input.userId}:${input.openWebUiChatId}`,
      openWebUiChatId: input.openWebUiChatId,
      userId: input.userId,
      userRole: input.userRole,
    }),
    resolveAgUiThread: async (input) => ({
      bindingId: "binding-1",
      clientType: "ag_ui",
      externalThreadId: input.externalThreadId,
      principalId: input.userId,
      threadId: "internal-thread-1",
    }),
    runChat: async () => "openai remains isolated",
    runAgUi: async function* (context) {
      captured.push(context.input);
      yield event({
        type: EventType.RUN_STARTED,
        threadId: context.input.threadId,
        runId: context.input.runId,
      });
      yield event({
        type: EventType.RUN_FINISHED,
        threadId: context.input.threadId,
        runId: context.input.runId,
        outcome: { type: "success" },
      });
    },
  });
  servers.push(server);
  return server;
}

function runInput(resume?: RunAgentInput["resume"]): RunAgentInput {
  return {
    threadId: "external-thread-1",
    runId: "resume-run-1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
    ...(resume === undefined ? {} : { resume }),
  };
}

function event(value: AGUIEvent): AGUIEvent {
  return value;
}

function decodeTypes(body: string): string[] {
  return body.split("\n\n").flatMap((record) => {
    const data = record
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice(6);
    return data === undefined
      ? []
      : [(JSON.parse(data) as { readonly type: string }).type];
  });
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
