import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { openAiError } from "../../../../packages/openai-api-contract/src/index.js";

export type ServiceKeyAuthenticator = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export function createServiceKeyAuthenticator(
  expectedServiceKey: string,
): ServiceKeyAuthenticator {
  const expectedDigest = digest(expectedServiceKey);
  return async (request, reply) => {
    const authorization = request.headers.authorization;
    const provided = parseBearerToken(authorization);
    if (
      provided === undefined ||
      !timingSafeEqual(digest(provided), expectedDigest)
    ) {
      await reply
        .code(401)
        .header("www-authenticate", "Bearer")
        .send(
          openAiError(
            "invalid_api_key",
            "Invalid or missing service API key.",
            "authentication_error",
          ),
        );
    }
  };
}

function parseBearerToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^Bearer ([^\s]+)$/u.exec(value);
  return match?.[1];
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
