import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { openAiError } from "../../../../packages/openai-api-contract/src/index.js";

const jwtHeaderSchema = z
  .object({
    alg: z.literal("HS256"),
    typ: z.literal("JWT").optional(),
  })
  .strict();

const jwtPayloadSchema = z
  .object({
    iss: z.literal("open-webui"),
    sub: z.string().min(1).max(256),
    exp: z.number().int().positive(),
    iat: z.number().int().positive(),
    role: z.enum(["user", "admin"]),
    email: z.string().email().max(320).optional(),
    name: z.string().min(1).max(256).optional(),
  })
  .passthrough();

export interface OpenWebUiIdentity {
  readonly userId: string;
  readonly role: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly email?: string;
  readonly name?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    openWebUiIdentity?: OpenWebUiIdentity;
  }
}

export function createOpenWebUiUserAuthenticator(input: {
  readonly secret: string;
  readonly now?: () => number;
  readonly maximumLifetimeSeconds?: number;
  readonly futureIatToleranceSeconds?: number;
}) {
  const now = input.now ?? (() => Date.now());
  const maximumLifetimeSeconds = input.maximumLifetimeSeconds ?? 600;
  const futureIatToleranceSeconds = input.futureIatToleranceSeconds ?? 30;
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const token = request.headers["x-openwebui-user-jwt"];
    const identity =
      typeof token === "string"
        ? verifyOpenWebUiUserJwt({
            token,
            secret: input.secret,
            nowSeconds: Math.floor(now() / 1000),
            maximumLifetimeSeconds,
            futureIatToleranceSeconds,
          })
        : undefined;
    if (identity === undefined) {
      await reply
        .code(401)
        .send(
          openAiError(
            "invalid_user_identity",
            "Invalid or missing signed Open WebUI user identity.",
            "authentication_error",
          ),
        );
      return;
    }
    request.openWebUiIdentity = identity;
  };
}

export function requireOpenWebUiIdentity(
  request: FastifyRequest,
): OpenWebUiIdentity {
  if (request.openWebUiIdentity === undefined) {
    throw new Error("Signed Open WebUI identity was not authenticated");
  }
  return request.openWebUiIdentity;
}

function verifyOpenWebUiUserJwt(input: {
  readonly token: string;
  readonly secret: string;
  readonly nowSeconds: number;
  readonly maximumLifetimeSeconds: number;
  readonly futureIatToleranceSeconds: number;
}): OpenWebUiIdentity | undefined {
  const parts = input.token.split(".");
  if (parts.length !== 3) return undefined;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (
    encodedHeader === undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined
  ) {
    return undefined;
  }

  const header = parseJwtPart(encodedHeader, jwtHeaderSchema);
  const payload = parseJwtPart(encodedPayload, jwtPayloadSchema);
  const signature = decodeBase64Url(encodedSignature);
  if (
    header === undefined ||
    payload === undefined ||
    signature === undefined
  ) {
    return undefined;
  }

  const expected = createHmac("sha256", input.secret)
    .update(`${encodedHeader}.${encodedPayload}`, "ascii")
    .digest();
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(signature, expected)
  ) {
    return undefined;
  }
  if (
    payload.exp <= input.nowSeconds ||
    payload.iat > input.nowSeconds + input.futureIatToleranceSeconds ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > input.maximumLifetimeSeconds
  ) {
    return undefined;
  }

  return {
    userId: payload.sub,
    role: payload.role,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    ...(payload.email === undefined ? {} : { email: payload.email }),
    ...(payload.name === undefined ? {} : { name: payload.name }),
  };
}

function parseJwtPart<T>(value: string, schema: z.ZodType<T>): T | undefined {
  const decoded = decodeBase64Url(value);
  if (decoded === undefined) return undefined;
  try {
    const parsedJson: unknown = JSON.parse(decoded.toString("utf8"));
    const parsed = schema.safeParse(parsedJson);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded : undefined;
  } catch {
    return undefined;
  }
}
