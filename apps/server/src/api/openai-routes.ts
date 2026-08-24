import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { FastifyPluginAsync } from "fastify";

import {
  chatCompletionRequestSchema,
  type ChatCompletionRequest,
  createChatCompletionResponse,
  createModelsResponse,
  emptyUsage,
  encodeSseData,
  openAiError,
  SSE_CONTENT_TYPE,
} from "../../../../packages/openai-api-contract/src/index.js";
import type { ClientHistoryMessage } from "../../../../packages/conversation-context/src/index.js";
import {
  isSdarInteractionEvent,
  type SdarInteractionEvent,
} from "../../../../packages/interaction-contract/src/index.js";
import { renderInteractionEventForOpenAi } from "../../../../packages/openai-interaction-adapter/src/index.js";
import type { ThreadBinding } from "../../../../packages/persistence/src/index.js";
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
  readonly clientMessages: readonly ClientHistoryMessage[];
  readonly identity: OpenWebUiIdentity;
  readonly openWebUi: OpenWebUiRequestContext;
  readonly threadId: string;
  readonly runId: string;
  readonly signal?: AbortSignal;
}

export interface PersistOpenAiAssistantMessageInput {
  readonly principalId: string;
  readonly threadId: string;
  readonly externalMessageId: string;
  readonly requestId: string;
  readonly contentText: string;
  readonly taskId?: string;
  readonly truncated: boolean;
}

export type ChatRunnerResult =
  string | AsyncIterable<string | SdarInteractionEvent>;
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
  readonly persistAssistantMessage?: (
    input: PersistOpenAiAssistantMessageInput,
  ) => Promise<void>;
}

export const registerOpenAiRoutes: FastifyPluginAsync<
  OpenAiRoutesOptions
> = async (server, options) => {
  const now = options.now ?? Date.now;
  const nextId = options.nextId ?? randomUUID;
  const runChat =
    options.runChat ??
    (async (context: ChatRunnerContext) => {
      return context.openWebUi.utilityTask === undefined
        ? "The conversation application service is unavailable; no SDAR operation was started."
        : "Single SDAR chat";
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
      `openai:${requireOpenWebUiIdentity(request).userId}`,
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
        : messageContentText(lastUserMessage?.content);
    if (lastUserMessage === undefined || userText.length === 0) {
      return reply
        .code(400)
        .send(
          openAiError(
            "invalid_request",
            "A non-empty textual user message is required.",
          ),
        );
    }
    const clientMessages = toClientHistoryMessages(
      parsed.data.messages,
      openWebUi,
    );
    const abortController = new AbortController();
    request.raw.once("aborted", () => abortController.abort());
    reply.raw.once("close", () => abortController.abort());
    const timedChat = options.telemetry.beginChat();
    let result: ChatRunnerResult;
    try {
      result = await runChat({
        userText,
        clientMessages,
        identity,
        openWebUi,
        threadId: thread.threadId,
        runId: id,
        signal: abortController.signal,
      });
    } catch (error) {
      timedChat.end(abortController.signal.aborted ? "aborted" : "error");
      throw error;
    }
    let taskId: string | undefined;
    let responseTruncated = false;
    const fragments = limitFragments(
      observeFragments(
        result,
        timedChat,
        abortController.signal,
        (observedTaskId) => {
          taskId = observedTaskId;
        },
      ),
      options.config.maxResponseChars,
      () => {
        responseTruncated = true;
      },
    );
    const persistAssistant = async (
      contentText: string,
      truncated: boolean,
    ): Promise<void> => {
      if (
        openWebUi.utilityTask !== undefined ||
        options.persistAssistantMessage === undefined ||
        contentText.length === 0
      ) {
        return;
      }
      await options.persistAssistantMessage({
        principalId: identity.userId,
        threadId: thread.threadId,
        externalMessageId: openWebUi.messageId,
        requestId: openWebUi.userMessageId,
        contentText,
        ...(taskId === undefined ? {} : { taskId }),
        truncated,
      });
    };
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
                persistAssistant,
                responseWasTruncated: () => responseTruncated,
              }),
              options.telemetry,
            ),
          ),
        );
    }

    const content = await collectFragments(fragments);
    await persistAssistant(content, responseTruncated);
    return createChatCompletionResponse({
      id,
      created,
      model: options.config.modelId,
      content,
    });
  });
};

export async function* streamChatCompletion(input: {
  readonly id: string;
  readonly created: number;
  readonly model: string;
  readonly fragments: AsyncIterable<string>;
  readonly signal: AbortSignal;
  readonly includeUsage: boolean;
  readonly persistAssistant: (
    contentText: string,
    truncated: boolean,
  ) => Promise<void>;
  readonly responseWasTruncated: () => boolean;
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
  const published: string[] = [];
  let failed = false;
  try {
    for await (const content of input.fragments) {
      if (content.length === 0) continue;
      published.push(content);
      yield encodeSseData({
        ...common,
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      });
    }
  } catch {
    failed = true;
    if (!input.signal.aborted) {
      const fallback =
        "The SDAR operation failed safely. No internal protocol details were exposed.";
      published.push(fallback);
      yield encodeSseData({
        ...common,
        choices: [
          {
            index: 0,
            delta: {
              content: fallback,
            },
            finish_reason: null,
          },
        ],
      });
    }
  } finally {
    await input.persistAssistant(
      published.join(""),
      input.signal.aborted || failed || input.responseWasTruncated(),
    );
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

async function* toFragments(
  result: ChatRunnerResult,
  observeTaskId: (taskId: string) => void,
): AsyncGenerator<string> {
  if (typeof result === "string") {
    yield result;
    return;
  }
  for await (const value of result as AsyncIterable<unknown>) {
    if (typeof value === "string") {
      yield value;
      continue;
    }
    if (!isSdarInteractionEvent(value)) {
      throw new Error("Chat runner emitted an invalid interaction event");
    }
    if (value.taskId !== undefined) observeTaskId(value.taskId);
    const fragment = renderInteractionEventForOpenAi(value);
    if (fragment !== undefined) yield fragment;
  }
}

async function* observeFragments(
  result: ChatRunnerResult,
  timed: TimedOperation,
  signal: AbortSignal,
  observeTaskId: (taskId: string) => void,
): AsyncGenerator<string> {
  try {
    yield* toFragments(result, observeTaskId);
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
  onTruncated: () => void,
): AsyncGenerator<string> {
  let emittedCharacters = 0;
  let emittedFragments = 0;
  for await (const fragment of fragments) {
    emittedFragments += 1;
    const remaining = maximumCharacters - emittedCharacters;
    if (emittedFragments > 512 || remaining <= 0) {
      onTruncated();
      yield "The response was truncated at the configured safety limit.";
      return;
    }
    if (fragment.length > remaining) {
      onTruncated();
      yield fragment.slice(0, remaining) +
        "\n\nThe response was truncated at the configured safety limit.";
      return;
    }
    emittedCharacters += fragment.length;
    yield fragment;
  }
}

function toClientHistoryMessages(
  messages: ChatCompletionRequest["messages"],
  openWebUi: OpenWebUiRequestContext,
): readonly ClientHistoryMessage[] {
  const currentUserIndex = findLastUserIndex(messages);
  const parentAssistantIndex = findPreviousAssistantIndex(
    messages,
    currentUserIndex,
  );
  const imported: ClientHistoryMessage[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role === "tool") continue;
    const contentText = messageContentText(message.content);
    if (contentText.length === 0) continue;
    const externalMessageId =
      message.role === "user" && index === currentUserIndex
        ? openWebUi.userMessageId
        : message.role === "assistant" && index === parentAssistantIndex
          ? (openWebUi.userMessageParentId ?? explicitMessageId(message))
          : explicitMessageId(message);
    imported.push({
      role: message.role,
      contentText,
      ...(externalMessageId === undefined ? {} : { externalMessageId }),
    });
  }
  return imported;
}

function findPreviousAssistantIndex(
  messages: ChatCompletionRequest["messages"],
  beforeIndex: number,
): number {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return index;
  }
  return -1;
}

function findLastUserIndex(
  messages: ChatCompletionRequest["messages"],
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function explicitMessageId(
  message: ChatCompletionRequest["messages"][number],
): string | undefined {
  return message.id ?? message.message_id;
}

function messageContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (part === null || typeof part !== "object") return [];
      const record = part as Readonly<Record<string, unknown>>;
      if (typeof record.text === "string") return [record.text];
      if (typeof record.input_text === "string") return [record.input_text];
      return [];
    })
    .join("\n");
}
