import Fastify, { LogController, type FastifyInstance } from "fastify";

import { openAiError } from "../../../packages/openai-api-contract/src/index.js";
import { registerHealthRoutes } from "./api/health-routes.js";
import {
  registerOpenAiRoutes,
  type OpenAiRoutesOptions,
} from "./api/openai-routes.js";
import type { ServerConfig } from "./config.js";

export interface BuildServerOptions extends Pick<
  OpenAiRoutesOptions,
  "now" | "nextId"
> {
  readonly config: ServerConfig;
  readonly logger?: boolean;
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const server = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.config.bodyLimitBytes,
    requestTimeout: options.config.requestTimeoutMs,
    logController: new LogController({ disableRequestLogging: true }),
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

  void server.register(registerHealthRoutes);
  void server.register(registerOpenAiRoutes, {
    prefix: "/v1",
    config: options.config,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.nextId === undefined ? {} : { nextId: options.nextId }),
  });
  return server;
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
