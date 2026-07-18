import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";

import {
  chatCompletionRequestSchema,
  createChatCompletionChunks,
  createChatCompletionResponse,
  createModelsResponse,
  encodeChatCompletionStream,
  openAiError,
  SSE_CONTENT_TYPE,
} from "../../../../packages/openai-api-contract/src/index.js";
import { createServiceKeyAuthenticator } from "../auth/service-key.js";
import type { ServerConfig } from "../config.js";

export const PHASE_1_PLACEHOLDER_RESPONSE =
  "The OpenAI-compatible API baseline is ready. Conversation routing is introduced in Phase 2.";

export interface OpenAiRoutesOptions {
  readonly config: ServerConfig;
  readonly now?: () => number;
  readonly nextId?: () => string;
}

export const registerOpenAiRoutes: FastifyPluginAsync<
  OpenAiRoutesOptions
> = async (server, options) => {
  const now = options.now ?? Date.now;
  const nextId = options.nextId ?? randomUUID;
  server.addHook(
    "preHandler",
    createServiceKeyAuthenticator(options.config.serviceKey),
  );

  server.get("/models", async () =>
    createModelsResponse(options.config.modelId, Math.floor(now() / 1000)),
  );

  server.post("/chat/completions", async (request, reply) => {
    const parsed = chatCompletionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          openAiError(
            "invalid_request",
            parsed.error.issues
              .map(
                (issue) =>
                  `${issue.path.join(".") || "body"}: ${issue.message}`,
              )
              .join("; "),
          ),
        );
    }
    if (parsed.data.model !== options.config.modelId) {
      return reply
        .code(404)
        .send(
          openAiError(
            "model_not_found",
            `The model '${parsed.data.model}' does not exist.`,
            "invalid_request_error",
            "model",
          ),
        );
    }

    const id = `chatcmpl-${nextId()}`;
    const created = Math.floor(now() / 1000);
    if (parsed.data.stream) {
      const chunks = createChatCompletionChunks({
        id,
        created,
        model: options.config.modelId,
        content: PHASE_1_PLACEHOLDER_RESPONSE,
        includeUsage: parsed.data.stream_options?.include_usage === true,
      });
      return reply
        .type(SSE_CONTENT_TYPE)
        .header("cache-control", "no-cache, no-transform")
        .header("connection", "keep-alive")
        .send(encodeChatCompletionStream(chunks));
    }

    return createChatCompletionResponse({
      id,
      created,
      model: options.config.modelId,
      content: PHASE_1_PLACEHOLDER_RESPONSE,
    });
  });
};
