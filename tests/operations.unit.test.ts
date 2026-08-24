import type { Meter, Tracer } from "@opentelemetry/api";
import { describe, expect, it } from "@jest/globals";

import { instrumentChatModel } from "../apps/server/src/observability/instrumented-chat-model.js";
import { instrumentSdarClient } from "../apps/server/src/observability/instrumented-sdar-client.js";
import { createSecureLoggerOptions } from "../apps/server/src/observability/logging.js";
import {
  lowCardinalityAttributes,
  SecureTelemetry,
} from "../apps/server/src/observability/telemetry.js";
import { FixedWindowRateLimiter } from "../apps/server/src/operations/rate-limiter.js";
import { ConversationModelError } from "../packages/conversation-model/src/index.js";
import { parsePersistenceConfig } from "../packages/persistence/src/index.js";
import {
  UnexpectedA2aAuthenticationStateError,
  type SdarA2aClient,
} from "../packages/sdar-a2a-adapter/src/index.js";

describe("secure operational controls", () => {
  it("bounds PostgreSQL connection and query timeouts", () => {
    const defaults = parsePersistenceConfig({
      DATABASE_URL: "postgresql://user:password@127.0.0.1:5432/chat",
    });
    expect(defaults.operationTimeoutMs).toBe(5_000);
    expect(defaults.maxActiveTasksPerChat).toBe(8);
    expect(
      parsePersistenceConfig({
        DATABASE_URL: "postgresql://user:password@127.0.0.1:5432/chat",
        CHAT_MAX_ACTIVE_TASKS_PER_CHAT: "3",
      }).maxActiveTasksPerChat,
    ).toBe(3);
    expect(() =>
      parsePersistenceConfig({
        DATABASE_URL: "postgresql://user:password@127.0.0.1:5432/chat",
        DATABASE_OPERATION_TIMEOUT_MS: "60000",
      }),
    ).toThrow();
  });

  it("drops high-cardinality and identity attributes", () => {
    expect(
      lowCardinalityAttributes({
        operation: "get_task",
        route: "/v1/chat/completions",
        outcome: "ok",
        user_id: "user-secret",
        chat_id: "chat-secret",
        task_id: "task-secret",
        request_id: "request-secret",
      }),
    ).toEqual({
      operation: "get_task",
      route: "/v1/chat/completions",
      outcome: "ok",
    });
  });

  it("does not affect requests when telemetry providers throw", () => {
    const throwingProvider = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("telemetry unavailable");
        },
      },
    );
    expect(() => {
      const telemetry = new SecureTelemetry({
        meter: throwingProvider as Meter,
        tracer: throwingProvider as Tracer,
      });
      telemetry.recordApi({
        route: "/v1/chat/completions",
        statusCode: 200,
        durationMs: 12,
      });
      telemetry.beginA2a("get_task").end("ok");
      telemetry.streamStarted("a2a");
      telemetry.streamEnded("a2a");
      telemetry.setActiveTasks(3);
      telemetry.recordContext({
        messageCount: 2,
        characterCount: 128,
        activeTaskCount: 1,
        terminalTaskCount: 0,
        summaryPresent: true,
        budgetTruncated: false,
      });
    }).not.toThrow();
  });

  it("measures model calls without input or identity attributes", async () => {
    const records: {
      readonly name: string;
      readonly attributes?: Readonly<Record<string, unknown>>;
    }[] = [];
    const meter = {
      createHistogram: (name: string) => ({
        record: (_value: number, attributes?: Record<string, unknown>) =>
          records.push({
            name,
            ...(attributes === undefined ? {} : { attributes }),
          }),
      }),
      createCounter: () => ({ add: () => undefined }),
      createUpDownCounter: () => ({ add: () => undefined }),
      createObservableGauge: () => ({ addCallback: () => undefined }),
    } as unknown as Meter;
    const telemetry = new SecureTelemetry({ meter });
    const model = instrumentChatModel(
      {
        decideTurn: async () => ({ kind: "general_chat" }),
        answerGeneral: async () => "safe answer",
        summarize: async () => "safe summary",
      },
      telemetry,
    );

    const context = {
      threadId: "thread-a",
      messages: [],
      activeTasks: [],
      recentTerminalTasks: [],
    } as const;
    await model.decideTurn({ context, currentUserText: "private prompt" });
    await model.answerGeneral({
      context,
      currentUserText: "private prompt",
    });

    expect(records).toEqual([
      {
        name: "chat_server.llm.duration",
        attributes: { operation: "decide_turn", outcome: "ok" },
      },
      {
        name: "chat_server.llm.duration",
        attributes: { operation: "answer_general", outcome: "ok" },
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("private prompt");
  });
  it("records only bounded-context counts and low-cardinality flags", () => {
    const records: {
      readonly name: string;
      readonly value: number;
      readonly attributes?: Readonly<Record<string, unknown>>;
    }[] = [];
    const meter = {
      createHistogram: (name: string) => ({
        record: (value: number, attributes?: Record<string, unknown>) =>
          records.push({
            name,
            value,
            ...(attributes === undefined ? {} : { attributes }),
          }),
      }),
      createCounter: () => ({ add: () => undefined }),
      createUpDownCounter: () => ({ add: () => undefined }),
      createObservableGauge: () => ({ addCallback: () => undefined }),
    } as unknown as Meter;
    new SecureTelemetry({ meter }).recordContext({
      messageCount: 4,
      characterCount: 512,
      activeTaskCount: 2,
      terminalTaskCount: 1,
      summaryPresent: true,
      budgetTruncated: false,
    });

    expect(records).toEqual([
      {
        name: "chat_server.context.characters",
        value: 512,
        attributes: {
          budget_truncated: "false",
          summary_present: "true",
        },
      },
      {
        name: "chat_server.context.messages",
        value: 4,
        attributes: {
          budget_truncated: "false",
          summary_present: "true",
        },
      },
    ]);
  });
  it("records ambiguous Task references without identity attributes", () => {
    const counters: Array<{ readonly name: string; readonly value: number }> =
      [];
    const meter = {
      createHistogram: () => ({ record: () => undefined }),
      createCounter: (name: string) => ({
        add: (value: number) => counters.push({ name, value }),
      }),
      createUpDownCounter: () => ({ add: () => undefined }),
      createObservableGauge: () => ({ addCallback: () => undefined }),
    } as unknown as Meter;

    new SecureTelemetry({ meter }).recordAmbiguousTaskReference();

    expect(counters).toEqual([
      { name: "chat_server.ambiguous_task_reference", value: 1 },
    ]);
  });
  it("classifies model, result, replay, and message-dedup outcomes without content", async () => {
    const counters: Array<{
      readonly name: string;
      readonly value: number;
      readonly attributes?: Readonly<Record<string, unknown>>;
    }> = [];
    const meter = {
      createHistogram: () => ({ record: () => undefined }),
      createCounter: (name: string) => ({
        add: (value: number, attributes?: Record<string, unknown>) =>
          counters.push({
            name,
            value,
            ...(attributes === undefined ? {} : { attributes }),
          }),
      }),
      createUpDownCounter: () => ({ add: () => undefined }),
      createObservableGauge: () => ({ addCallback: () => undefined }),
    } as unknown as Meter;
    const telemetry = new SecureTelemetry({ meter });
    const failingModel = instrumentChatModel(
      {
        decideTurn: async () => {
          throw new ConversationModelError(
            "CONVERSATION_MODEL_TIMEOUT",
            "private model response",
            true,
          );
        },
        answerGeneral: async () => "unused",
        summarize: async () => "unused",
      },
      telemetry,
    );

    await expect(
      failingModel.decideTurn({
        context: {
          threadId: "private-thread",
          messages: [],
          activeTasks: [],
          recentTerminalTasks: [],
        },
        currentUserText: "private prompt",
      }),
    ).rejects.toBeInstanceOf(ConversationModelError);
    telemetry.recordConversationModelRequest(
      "answer_general",
      "invalid_output",
    );
    telemetry.recordRequestResult({ kind: "task", replay: false });
    telemetry.recordRequestResult({ kind: "message", replay: true });
    telemetry.recordConversationMessageDedup({
      protocol: "ag_ui",
      role: "assistant",
    });

    expect(counters).toEqual([
      {
        name: "conversation_model_requests_total",
        value: 1,
        attributes: { operation: "decide_turn", outcome: "timeout" },
      },
      {
        name: "conversation_model_requests_total",
        value: 1,
        attributes: { operation: "answer_general", outcome: "invalid_output" },
      },
      {
        name: "request_result_total",
        value: 1,
        attributes: { kind: "task" },
      },
      {
        name: "request_replay_total",
        value: 1,
        attributes: { kind: "message" },
      },
      {
        name: "conversation_message_dedup_total",
        value: 1,
        attributes: { protocol: "ag_ui", role: "assistant" },
      },
    ]);
    expect(JSON.stringify(counters)).not.toMatch(
      /private|thread|prompt|response/u,
    );
  });
  it("counts unexpected southbound authentication without attributes", async () => {
    const counters: Array<{
      readonly name: string;
      readonly value: number;
      readonly attributes?: Readonly<Record<string, unknown>>;
    }> = [];
    const meter = {
      createHistogram: () => ({ record: () => undefined }),
      createCounter: (name: string) => ({
        add: (value: number, attributes?: Record<string, unknown>) =>
          counters.push({
            name,
            value,
            ...(attributes === undefined ? {} : { attributes }),
          }),
      }),
      createUpDownCounter: () => ({ add: () => undefined }),
      createObservableGauge: () => ({ addCallback: () => undefined }),
    } as unknown as Meter;
    const telemetry = new SecureTelemetry({ meter });
    const rawClient = {
      protocolBinding: "HTTP+JSON",
      protocolVersion: "1.0",
      endpoint: "http://sdar.test/a2a",
      getTask: async () => {
        throw new UnexpectedA2aAuthenticationStateError();
      },
    } as unknown as SdarA2aClient;

    await expect(
      instrumentSdarClient(rawClient, telemetry).getTask("task-a"),
    ).rejects.toBeInstanceOf(UnexpectedA2aAuthenticationStateError);

    expect(counters).toEqual([
      { name: "a2a_unexpected_auth_required_total", value: 1 },
    ]);
  });
  it("enforces a fixed per-identity window and resets it", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(2, 10_000, () => now);
    expect(limiter.consume("user-a").allowed).toBe(true);
    expect(limiter.consume("user-a").allowed).toBe(true);
    expect(limiter.consume("user-b").allowed).toBe(true);
    const blocked = limiter.consume("user-a");
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 10 });
    now += 10_000;
    expect(limiter.consume("user-a").allowed).toBe(true);
  });

  it("bounds identity-bucket memory and recovers capacity after expiry", () => {
    let now = 5_000;
    const limiter = new FixedWindowRateLimiter(2, 10_000, () => now, 2);
    expect(limiter.consume("user-a").allowed).toBe(true);
    expect(limiter.consume("user-b").allowed).toBe(true);
    expect(limiter.consume("user-c")).toEqual({
      allowed: false,
      retryAfterSeconds: 10,
    });
    now += 10_000;
    expect(limiter.consume("user-c").allowed).toBe(true);
  });
  it("configures Pino to redact credentials and content-bearing fields", () => {
    const options = createSecureLoggerOptions("info");
    expect(options.redact.paths).toEqual(
      expect.arrayContaining([
        "req.headers.authorization",
        "req.headers.x-openwebui-user-jwt",
        "req.headers.cookie",
        "apiKey",
        "connectionString",
        "databaseUrl",
        "token",
        "prompt",
        "response",
        "messages",
        "userText",
        "contentText",
        "artifact",
        "body",
      ]),
    );
    expect(options.redact.censor).toBe("[REDACTED]");
  });
});
