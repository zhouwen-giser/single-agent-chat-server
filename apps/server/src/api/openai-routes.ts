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
import { graph } from "../../../../src/agent/graph.js";
import { createServiceKeyAuthenticator } from "../auth/service-key.js";
import type { ServerConfig } from "../config.js";

export type ChatRunner = (userText: string) => Promise<string>;

export interface OpenAiRoutesOptions {
  readonly config: ServerConfig;
  readonly now?: () => number;
  readonly nextId?: () => string;
  readonly runChat?: ChatRunner;
}

export const registerOpenAiRoutes: FastifyPluginAsync<
  OpenAiRoutesOptions
> = async (server, options) => {
  const now = options.now ?? Date.now;
  const nextId = options.nextId ?? randomUUID;
  const runChat = options.runChat ?? runThinChatGraph;
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
    const lastUserMessage = [...parsed.data.messages]
      .reverse()
      .find((message) => message.role === "user");
    const userText =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : "";
    const content = await runChat(userText);
    if (parsed.data.stream) {
      const chunks = createChatCompletionChunks({
        id,
        created,
        model: options.config.modelId,
        content,
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
      content,
    });
  });
};

const runThinChatGraph: ChatRunner = async (userText) => {
  const result = await graph.invoke({
    messages: [{ role: "user", content: userText }],
    utilityRequest: false,
  });
  const content = result.messages.at(-1)?.content;
  return typeof content === "string"
    ? content
    : "The response could not be rendered as conversational text.";
};
