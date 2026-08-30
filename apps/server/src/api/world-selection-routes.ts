import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { openAiError } from "../../../../packages/openai-api-contract/src/index.js";
import {
  PersistenceAuthorizationError,
  PersistenceConflictError,
  type StructuredWorldSelectionScope,
} from "../../../../packages/persistence/src/index.js";
import {
  structuredWorldSelectionSchema,
  type StructuredWorldSelection,
} from "../../../../packages/world-explanation-contract/src/index.js";
import {
  createOpenWebUiUserAuthenticator,
  requireOpenWebUiIdentity,
} from "../auth/openwebui-user.js";
import { createServiceKeyAuthenticator } from "../auth/service-key.js";
import type { ServerConfig } from "../config.js";
import type { SecureTelemetry } from "../observability/telemetry.js";
import type { FixedWindowRateLimiter } from "../operations/rate-limiter.js";

import type { ResolveChatThread } from "./openai-routes.js";

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export interface WorldSelectionWriteResult {
  readonly created: boolean;
  readonly selection: StructuredWorldSelection;
}

export interface WorldSelectionRoutesOptions {
  readonly config: ServerConfig;
  readonly telemetry: SecureTelemetry;
  readonly rateLimiter: FixedWindowRateLimiter;
  readonly resolveChatThread: ResolveChatThread;
  readonly now?: () => number;
  readonly saveSelection?: (
    selection: StructuredWorldSelection,
    now: string,
  ) => Promise<WorldSelectionWriteResult>;
  readonly findSelection?: (
    scope: StructuredWorldSelectionScope,
    selectionId: string,
    now: string,
  ) => Promise<StructuredWorldSelection | undefined>;
}

export const registerWorldSelectionRoutes: FastifyPluginAsync<
  WorldSelectionRoutesOptions
> = async (server, options) => {
  const now = options.now ?? Date.now;
  server.addHook(
    "preHandler",
    createServiceKeyAuthenticator(options.config.serviceKey),
  );
  server.addHook(
    "preHandler",
    createOpenWebUiUserAuthenticator({
      secret: options.config.openWebUiUserJwtSecret,
      now,
    }),
  );
  server.addHook("preHandler", async (request, reply) => {
    if (reply.sent) return;
    const decision = options.rateLimiter.consume(
      "world-selection:" + requireOpenWebUiIdentity(request).userId,
    );
    if (!decision.allowed) {
      await reply
        .header("retry-after", decision.retryAfterSeconds)
        .code(429)
        .send(
          openAiError(
            "rate_limit_exceeded",
            "Rate limit exceeded. Retry later.",
            "rate_limit_error",
          ),
        );
    }
  });

  server.post("/world-selections", async (request, reply) => {
    if (options.saveSelection === undefined) {
      return reply
        .code(503)
        .send(
          openAiError(
            "world_selection_unavailable",
            "Structured world selection ingress is unavailable.",
          ),
        );
    }
    const parsed = structuredWorldSelectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          openAiError(
            "invalid_world_selection",
            "Structured world selection is invalid.",
          ),
        );
    }
    const scoped = await resolveScope(request, options.resolveChatThread);
    if (
      parsed.data.principalId !== scoped.principalId ||
      parsed.data.threadId !== scoped.threadId
    ) {
      return unavailable(reply);
    }
    const selection = structuredWorldSelectionSchema.parse({
      ...parsed.data,
      principalId: scoped.principalId,
      threadId: scoped.threadId,
    });
    try {
      const result = await options.saveSelection(
        selection,
        new Date(now()).toISOString(),
      );
      return reply
        .code(result.created ? 201 : 200)
        .send(selectionReceipt(result.selection, result.created));
    } catch (error) {
      if (error instanceof PersistenceAuthorizationError) {
        return unavailable(reply);
      }
      if (error instanceof PersistenceConflictError) {
        return reply
          .code(409)
          .send(
            openAiError(
              "world_selection_conflict",
              "Structured world selection is stale or conflicts with stored state.",
            ),
          );
      }
      throw error;
    }
  });

  server.get<{ Params: { selectionId: string } }>(
    "/world-selections/:selectionId",
    async (request, reply) => {
      if (options.findSelection === undefined) return unavailable(reply);
      const selectionId = identifier.safeParse(request.params.selectionId);
      if (!selectionId.success) return unavailable(reply);
      const scoped = await resolveScope(request, options.resolveChatThread);
      const selection = await options.findSelection(
        scoped,
        selectionId.data,
        new Date(now()).toISOString(),
      );
      return selection === undefined
        ? unavailable(reply)
        : reply.send(selectionReceipt(selection, false));
    },
  );
};

async function resolveScope(
  request: FastifyRequest,
  resolveChatThread: ResolveChatThread,
): Promise<StructuredWorldSelectionScope> {
  const chatId = identifier.safeParse(request.headers["x-openwebui-chat-id"]);
  if (!chatId.success) {
    const error = new Error(
      "Open WebUI chat identity is required.",
    ) as Error & {
      statusCode: number;
    };
    error.statusCode = 400;
    throw error;
  }
  const identity = requireOpenWebUiIdentity(request);
  const thread = await resolveChatThread({
    openWebUiChatId: chatId.data,
    userId: identity.userId,
    userRole: identity.role,
  });
  return { principalId: identity.userId, threadId: thread.threadId };
}

function selectionReceipt(
  selection: StructuredWorldSelection,
  created: boolean,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: "sacs-structured-world-selection-receipt/1.0",
    selectionId: selection.selectionId,
    selectionRevision: selection.selectionRevision,
    sourceHash: selection.sourceHash,
    expiresAt: selection.expiresAt,
    created,
  };
}

function unavailable(reply: {
  code(statusCode: number): { send(payload: unknown): unknown };
}): unknown {
  return reply
    .code(404)
    .send(
      openAiError(
        "world_selection_not_found",
        "Structured world selection is unavailable.",
      ),
    );
}
