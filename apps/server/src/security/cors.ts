import type { FastifyInstance } from "fastify";

import { openAiError } from "../../../../packages/openai-api-contract/src/index.js";

const allowedMethods = new Set(["GET", "POST"]);
const allowedHeaders = new Set([
  "accept",
  "authorization",
  "content-type",
  "x-openwebui-user-jwt",
  "x-request-id",
]);

export function registerCorsPolicy(
  server: FastifyInstance,
  allowedOrigins: readonly string[],
): void {
  const origins = new Set(allowedOrigins);
  server.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin === undefined) return;
    if (!origins.has(origin)) {
      await reply
        .code(403)
        .send(
          openAiError(
            "cors_origin_denied",
            "The request Origin is not allowed.",
            "authentication_error",
          ),
        );
      return;
    }
    void reply.header("access-control-allow-origin", origin);
    void reply.header("vary", "Origin");
  });

  server.options("/*", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin === undefined || !origins.has(origin)) {
      return reply
        .code(403)
        .send(
          openAiError(
            "cors_origin_denied",
            "The request Origin is not allowed.",
            "authentication_error",
          ),
        );
    }
    const requestedMethod =
      request.headers["access-control-request-method"]?.toUpperCase();
    if (requestedMethod === undefined || !allowedMethods.has(requestedMethod)) {
      return reply
        .code(403)
        .send(
          openAiError(
            "cors_method_denied",
            "The requested CORS method is not allowed.",
            "authentication_error",
          ),
        );
    }
    const requestedHeaders = parseRequestedHeaders(
      request.headers["access-control-request-headers"],
    );
    if (
      requestedHeaders === undefined ||
      requestedHeaders.some((header) => !allowedHeaders.has(header))
    ) {
      return reply
        .code(403)
        .send(
          openAiError(
            "cors_headers_denied",
            "One or more requested CORS headers are not allowed.",
            "authentication_error",
          ),
        );
    }
    return reply
      .header("access-control-allow-methods", [...allowedMethods].join(", "))
      .header("access-control-allow-headers", [...allowedHeaders].join(", "))
      .header("access-control-max-age", "600")
      .code(204)
      .send();
  });
}

export function parseCorsAllowedOrigins(value: string): readonly string[] {
  if (value.trim().length === 0) return [];
  const candidates = value.split(",").map((item) => item.trim());
  if (candidates.length > 32 || candidates.some((item) => item.length === 0)) {
    throw new Error("CHAT_CORS_ALLOW_ORIGINS must contain 1 to 32 origins");
  }
  const origins = candidates.map((candidate) => {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error("CHAT_CORS_ALLOW_ORIGINS contains an invalid origin");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.origin !== candidate
    ) {
      throw new Error(
        "CHAT_CORS_ALLOW_ORIGINS entries must be exact HTTP(S) origins",
      );
    }
    return parsed.origin;
  });
  if (new Set(origins).size !== origins.length) {
    throw new Error("CHAT_CORS_ALLOW_ORIGINS contains duplicate origins");
  }
  return origins;
}

function parseRequestedHeaders(
  value: string | undefined,
): string[] | undefined {
  if (value === undefined || value.trim().length === 0) return [];
  const headers = value.split(",").map((header) => header.trim().toLowerCase());
  return headers.every((header) => /^[a-z0-9-]{1,64}$/u.test(header))
    ? headers
    : undefined;
}
