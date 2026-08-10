import { randomUUID } from "node:crypto";

import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import type { AgUiRunHandler } from "../../../packages/ag-ui-interaction-adapter/src/index.js";
import { openAiError } from "../../../packages/openai-api-contract/src/index.js";
import {
  registerAgUiRoutes,
  type ResolveAgUiThread,
} from "./api/ag-ui-routes.js";
import { registerHealthRoutes } from "./api/health-routes.js";
import {
  registerOpenAiRoutes,
  type OpenAiRoutesOptions,
} from "./api/openai-routes.js";
import type { ServerConfig } from "./config.js";
import { SecureTelemetry } from "./observability/telemetry.js";
import { FixedWindowRateLimiter } from "./operations/rate-limiter.js";
import { registerCorsPolicy } from "./security/cors.js";

export interface BuildServerOptions extends Pick<
  OpenAiRoutesOptions,
  "now" | "nextId" | "runChat" | "resolveChatThread" | "checkpointer"
> {
  readonly config: ServerConfig;
  readonly logger?: FastifyServerOptions["logger"];
  readonly readinessCheck?: () => Promise<boolean>;
  readonly telemetry?: SecureTelemetry;
  readonly resolveAgUiThread?: ResolveAgUiThread;
  readonly runAgUi?: AgUiRunHandler;
  readonly rateLimiter?: FixedWindowRateLimiter;
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const telemetry = options.telemetry ?? new SecureTelemetry();
  const rateLimiter =
    options.rateLimiter ??
    new FixedWindowRateLimiter(
      options.config.rateLimitMax,
      options.config.rateLimitWindowMs,
    );
  const requestStartedAt = new WeakMap<object, number>();
  const server = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.config.bodyLimitBytes,
    requestTimeout: options.config.requestTimeoutMs,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: (request) => {
      const proposed = request.headers["x-request-id"];
      return typeof proposed === "string" &&
        /^[A-Za-z0-9._:-]{1,128}$/u.test(proposed)
        ? proposed
        : randomUUID();
    },
  });

  registerCorsPolicy(server, options.config.corsAllowedOrigins);

  server.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, Date.now());
    void reply.header("x-request-id", request.id);
  });
  server.addHook("onResponse", async (request, reply) => {
    const durationMs = Math.max(
      0,
      Date.now() - (requestStartedAt.get(request) ?? Date.now()),
    );
    const route = request.routeOptions.url ?? "other";
    telemetry.recordApi({ route, statusCode: reply.statusCode, durationMs });
    server.log.info(
      {
        requestId: request.id,
        route,
        method: request.method,
        statusCode: reply.statusCode,
        durationMs,
      },
      "request completed",
    );
  });

  server.setErrorHandler(async (error, _request, reply) => {
    const normalized = normalizeError(error);
    if (normalized.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply
        .code(413)
        .send(openAiError("request_too_large", "Request body is too large."));
    }
    const statusCode =
      normalized.statusCode !== undefined && normalized.statusCode >= 400
        ? normalized.statusCode
        : 500;
    return reply
      .code(statusCode)
      .send(
        openAiError(
          statusCode >= 500 ? "internal_error" : "invalid_request",
          statusCode >= 500 ? "Internal server error." : normalized.message,
          statusCode >= 500 ? "server_error" : "invalid_request_error",
        ),
      );
  });

  void server.register(registerAgUiRoutes, {
    config: options.config,
    telemetry,
    rateLimiter,
    resolveThread: options.resolveAgUiThread ?? unavailableAgUiThread,
    ...(options.runAgUi === undefined ? {} : { runAgUi: options.runAgUi }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  void server.register(registerHealthRoutes, {
    ...(options.readinessCheck === undefined
      ? {}
      : { readinessCheck: options.readinessCheck }),
  });
  void server.register(registerOpenAiRoutes, {
    prefix: "/v1",
    config: options.config,
    telemetry,
    rateLimiter,
    resolveChatThread: options.resolveChatThread,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.nextId === undefined ? {} : { nextId: options.nextId }),
    ...(options.runChat === undefined ? {} : { runChat: options.runChat }),
    ...(options.checkpointer === undefined
      ? {}
      : { checkpointer: options.checkpointer }),
  });
  return server;
}

async function unavailableAgUiThread(): Promise<never> {
  const error = new Error("AG-UI persistence is unavailable.") as Error & {
    statusCode: number;
  };
  error.statusCode = 503;
  throw error;
}
function normalizeError(error: unknown): {
  readonly code?: string;
  readonly statusCode?: number;
  readonly message: string;
} {
  if (!(error instanceof Error)) return { message: "Unknown request error." };
  const record = error as Error & { code?: unknown; statusCode?: unknown };
  return {
    message: error.message,
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    ...(typeof record.statusCode === "number"
      ? { statusCode: record.statusCode }
      : {}),
  };
}
