import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { FastifyPluginAsync } from "fastify";

import {
  chatCompletionRequestSchema,
  createChatCompletionResponse,
  createModelsResponse,
  emptyUsage,
  encodeSseData,
  openAiError,
  SSE_CONTENT_TYPE,
} from "../../../../packages/openai-api-contract/src/index.js";
import type { ThreadBinding } from "../../../../packages/persistence/src/index.js";
import { createSingleAgentChatGraph } from "../../../../src/agent/graph.js";
import {
  createOpenWebUiUserAuthenticator,
  requireOpenWebUiIdentity,
  type OpenWebUiIdentity,
} from "../auth/openwebui-user.js";
import { createServiceKeyAuthenticator } from "../auth/service-key.js";
import type { ServerConfig } from "../config.js";
import type {
  SecureTelemetry,
  TimedOperation,
} from "../observability/telemetry.js";
import {
  parseOpenWebUiRequestContext,
  type OpenWebUiRequestContext,
} from "../openwebui/request-context.js";
import type { FixedWindowRateLimiter } from "../operations/rate-limiter.js";

export interface ChatRunnerContext {
  readonly userText: string;
  readonly identity: OpenWebUiIdentity;
  readonly openWebUi: OpenWebUiRequestContext;
  readonly threadId: string;
  readonly signal?: AbortSignal;
}

export type ChatRunnerResult = string | AsyncIterable<string>;
export type ChatRunner = (
  context: ChatRunnerContext,
) => Promise<ChatRunnerResult> | ChatRunnerResult;
export type ResolveChatThread = (input: {
  readonly openWebUiChatId: string;
  readonly userId: string;
  readonly userRole: string;
}) => Promise<ThreadBinding>;

export interface OpenAiRoutesOptions {
  readonly config: ServerConfig;
  readonly telemetry: SecureTelemetry;
  readonly rateLimiter: FixedWindowRateLimiter;
  readonly resolveChatThread: ResolveChatThread;
  readonly checkpointer?: BaseCheckpointSaver;
  readonly now?: () => number;
  readonly nextId?: () => string;
  readonly runChat?: ChatRunner;
}

export const registerOpenAiRoutes: FastifyPluginAsync<
  OpenAiRoutesOptions
> = async (server, options) => {
  const now = options.now ?? Date.now;
  const nextId = options.nextId ?? randomUUID;
  const chatGraph =
    options.runChat === undefined
      ? createSingleAgentChatGraph(undefined, options.checkpointer)
      : undefined;
  const runChat =
    options.runChat ??
    (async (context: ChatRunnerContext) => {
      if (chatGraph === undefined) {
        throw new Error("Chat graph is unavailable");
      }
      const result = await chatGraph.invoke(
        {
          messages: [{ role: "user", content: context.userText }],
          threadId: context.threadId,
          userId: context.identity.userId,
          openWebUiChatId: context.openWebUi.chatId,
          utilityRequest: context.openWebUi.utilityTask !== undefined,
        },
        { configurable: { thread_id: context.threadId } },
      );
      const content = result.messages.at(-1)?.content;
      return typeof content === "string"
        ? content
        : "The response could not be rendered as conversational text.";
    });

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
      requireOpenWebUiIdentity(request).userId,
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
                  (issue.path.join(".") || "body") + ": " + issue.message,
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
            "The model '" + parsed.data.model + "' does not exist.",
            "invalid_request_error",
            "model",
          ),
        );
    }

    if (
      parsed.data.messages.length > options.config.maxMessages ||
      parsed.data.messages.some(
        (message) =>
          messageContentLength(message.content) >
          options.config.maxMessageChars,
      )
    ) {
      return reply
        .code(400)
        .send(openAiError("invalid_request", "Message limits were exceeded."));
    }

    const identity = requireOpenWebUiIdentity(request);
    const openWebUi = parseOpenWebUiRequestContext(request);
    const thread = await options.resolveChatThread({
      openWebUiChatId: openWebUi.chatId,
      userId: identity.userId,
      userRole: identity.role,
    });

    const id = "chatcmpl-" + nextId();
    const created = Math.floor(now() / 1000);
    const lastUserMessage = [...parsed.data.messages]
      .reverse()
      .find((message) => message.role === "user");
    const userText =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : "";
    const abortController = new AbortController();
    request.raw.once("aborted", () => abortController.abort());
    reply.raw.once("close", () => abortController.abort());
    const timedChat = options.telemetry.beginChat();
    let result: ChatRunnerResult;
    try {
      result = await runChat({
        userText,
        identity,
        openWebUi,
        threadId: thread.threadId,
        signal: abortController.signal,
      });
    } catch (error) {
      timedChat.end(abortController.signal.aborted ? "aborted" : "error");
      throw error;
    }
    const fragments = limitFragments(
      observeFragments(result, timedChat, abortController.signal),
      options.config.maxResponseChars,
    );
    if (parsed.data.stream) {
      return reply
        .type(SSE_CONTENT_TYPE)
        .header("cache-control", "no-cache, no-transform")
        .header("connection", "keep-alive")
        .send(
          Readable.from(
            observeOpenAiStream(
              streamChatCompletion({
                id,
                created,
                model: options.config.modelId,
                fragments,
                signal: abortController.signal,
                includeUsage:
                  parsed.data.stream_options?.include_usage === true,
              }),
              options.telemetry,
            ),
          ),
        );
    }

    const content = await collectFragments(fragments);
    return createChatCompletionResponse({
      id,
      created,
      model: options.config.modelId,
      content,
    });
  });
};

async function* streamChatCompletion(input: {
  readonly id: string;
  readonly created: number;
  readonly model: string;
  readonly fragments: AsyncIterable<string>;
  readonly signal: AbortSignal;
  readonly includeUsage: boolean;
}): AsyncGenerator<string> {
  const common = {
    id: input.id,
    object: "chat.completion.chunk" as const,
    created: input.created,
    model: input.model,
  };
  yield encodeSseData({
    ...common,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  });
  try {
    for await (const content of input.fragments) {
      if (content.length === 0) continue;
      yield encodeSseData({
        ...common,
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      });
    }
  } catch {
    if (!input.signal.aborted) {
      yield encodeSseData({
        ...common,
        choices: [
          {
            index: 0,
            delta: {
              content:
                "The SDAR operation failed safely. No internal protocol details were exposed.",
            },
            finish_reason: null,
          },
        ],
      });
    }
  }
  yield encodeSseData({
    ...common,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  if (input.includeUsage) {
    yield encodeSseData({ ...common, choices: [], usage: emptyUsage });
  }
  yield "data: [DONE]\n\n";
}

async function* toFragments(result: ChatRunnerResult): AsyncGenerator<string> {
  if (typeof result === "string") {
    yield result;
    return;
  }
  yield* result;
}

async function* observeFragments(
  result: ChatRunnerResult,
  timed: TimedOperation,
  signal: AbortSignal,
): AsyncGenerator<string> {
  try {
    yield* toFragments(result);
    timed.end(signal.aborted ? "aborted" : "ok");
  } catch (error) {
    timed.end(signal.aborted ? "aborted" : "error");
    throw error;
  } finally {
    timed.end(signal.aborted ? "aborted" : "ok");
  }
}

async function* observeOpenAiStream(
  source: AsyncIterable<string>,
  telemetry: SecureTelemetry,
): AsyncGenerator<string> {
  telemetry.streamStarted("openai");
  try {
    yield* source;
  } finally {
    telemetry.streamEnded("openai");
  }
}

function messageContentLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (content === null) return 0;
  return JSON.stringify(content).length;
}

async function collectFragments(
  fragments: AsyncIterable<string>,
): Promise<string> {
  const collected: string[] = [];
  for await (const fragment of fragments) collected.push(fragment);
  return collected.join("\n\n");
}

async function* limitFragments(
  fragments: AsyncIterable<string>,
  maximumCharacters: number,
): AsyncGenerator<string> {
  let emittedCharacters = 0;
  let emittedFragments = 0;
  for await (const fragment of fragments) {
    emittedFragments += 1;
    const remaining = maximumCharacters - emittedCharacters;
    if (emittedFragments > 512 || remaining <= 0) {
      yield "The response was truncated at the configured safety limit.";
      return;
    }
    if (fragment.length > remaining) {
      yield fragment.slice(0, remaining) +
        "\n\nThe response was truncated at the configured safety limit.";
      return;
    }
    emittedCharacters += fragment.length;
    yield fragment;
  }
}
