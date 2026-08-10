import type { Meter, Tracer } from "@opentelemetry/api";
import { describe, expect, it } from "@jest/globals";

import { instrumentChatModel } from "../apps/server/src/observability/instrumented-chat-model.js";
import { createSecureLoggerOptions } from "../apps/server/src/observability/logging.js";
import {
  lowCardinalityAttributes,
  SecureTelemetry,
} from "../apps/server/src/observability/telemetry.js";
import { FixedWindowRateLimiter } from "../apps/server/src/operations/rate-limiter.js";
import { parsePersistenceConfig } from "../packages/persistence/src/index.js";

describe("secure operational controls", () => {
  it("bounds PostgreSQL connection and query timeouts", () => {
    expect(
      parsePersistenceConfig({
        DATABASE_URL: "postgresql://user:password@127.0.0.1:5432/chat",
      }).operationTimeoutMs,
    ).toBe(5_000);
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
        classify: async () => ({ requestKind: "general_chat" }),
        answer: async () => "safe answer",
      },
      telemetry,
    );

    await model.classify({ userText: "private prompt", hasActiveTask: false });
    await model.answer({ userText: "private prompt" });

    expect(records).toEqual([
      {
        name: "chat_server.llm.duration",
        attributes: { operation: "classify", outcome: "ok" },
      },
      {
        name: "chat_server.llm.duration",
        attributes: { operation: "answer", outcome: "ok" },
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("private prompt");
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
        "token",
        "prompt",
        "artifact",
        "body",
      ]),
    );
    expect(options.redact.censor).toBe("[REDACTED]");
  });
});
