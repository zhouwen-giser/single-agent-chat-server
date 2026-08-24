import { Readable } from "node:stream";

import type { FastifyPluginAsync } from "fastify";

import {
  AG_UI_REQUEST_CONTENT_TYPE,
  AG_UI_SSE_CONTENT_TYPE,
  acceptsAgUiJson,
  acceptsAgUiSse,
  parseAgUiRunInput,
  type RunAgentInput,
} from "../../../../packages/ag-ui-api-contract/src/index.js";
import {
  createSafeAgUiRunError,
  createSacsAgUiCapabilities,
  createUnavailableAgUiRunHandler,
  encodeProfileAgUiSse,
  type AgUiRunHandler,
} from "../../../../packages/ag-ui-interaction-adapter/src/index.js";
import type { ClientThreadBinding } from "../../../../packages/persistence/src/index.js";
import {
  createOpenWebUiUserAuthenticator,
  requireOpenWebUiIdentity,
} from "../auth/openwebui-user.js";
import { createServiceKeyAuthenticator } from "../auth/service-key.js";
import type { ServerConfig } from "../config.js";
import type { SecureTelemetry } from "../observability/telemetry.js";
import type { FixedWindowRateLimiter } from "../operations/rate-limiter.js";

export type ResolveAgUiThread = (input: {
  readonly externalThreadId: string;
  readonly userId: string;
  readonly userRole: string;
}) => Promise<ClientThreadBinding>;

export interface AgUiRoutesOptions {
  readonly config: ServerConfig;
  readonly telemetry: SecureTelemetry;
  readonly rateLimiter: FixedWindowRateLimiter;
  readonly resolveThread: ResolveAgUiThread;
  readonly runAgUi?: AgUiRunHandler;
  readonly persistAssistantMessages?: (
    input: PersistAgUiAssistantMessagesInput,
  ) => Promise<void>;
  readonly now?: () => number;
}

export interface PersistAgUiAssistantMessagesInput {
  readonly principalId: string;
  readonly internalThreadId: string;
  readonly runInput: RunAgentInput;
  readonly messages: readonly {
    readonly externalMessageId: string;
    readonly contentText: string;
  }[];
  readonly truncated: boolean;
}

export const registerAgUiRoutes: FastifyPluginAsync<AgUiRoutesOptions> = async (
  server,
  options,
) => {
  const now = options.now ?? Date.now;
  const runAgUi = options.runAgUi ?? createUnavailableAgUiRunHandler();

  server.addHook(
    "preHandler",
    createServiceKeyAuthenticator(options.config.agUiServiceKey),
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
    const identity = requireOpenWebUiIdentity(request);
    const decision = options.rateLimiter.consume(`ag_ui:${identity.userId}`);
    if (!decision.allowed) {
      await reply
        .header("retry-after", decision.retryAfterSeconds)
        .code(429)
        .send(agUiError("rate_limit_exceeded", "Rate limit exceeded."));
    }
  });

  server.get("/ag-ui/capabilities", async (_request, reply) =>
    reply.type(AG_UI_REQUEST_CONTENT_TYPE).send(createSacsAgUiCapabilities()),
  );

  server.post("/ag-ui", async (request, reply) => {
    if (!acceptsAgUiSse(request.headers.accept)) {
      return reply
        .code(406)
        .send(
          agUiError(
            "not_acceptable",
            "AG-UI requires Accept: text/event-stream.",
          ),
        );
    }
    if (!acceptsAgUiJson(request.headers["content-type"])) {
      return reply
        .code(415)
        .send(
          agUiError(
            "unsupported_media_type",
            "AG-UI requires an application/json content type.",
          ),
        );
    }
    let input: RunAgentInput;
    try {
      input = parseAgUiRunInput(request.body);
    } catch {
      return reply
        .code(400)
        .send(agUiError("invalid_run_input", "Invalid AG-UI RunAgentInput."));
    }
    const limitError = validateRunLimits(input, options.config);
    if (limitError !== undefined) {
      return reply.code(400).send(agUiError("run_limits_exceeded", limitError));
    }
    if (input.tools.length > 0) {
      return reply
        .code(400)
        .send(
          agUiError(
            "tools_not_supported",
            "Client-provided tools are disabled by the SACS AG-UI profile.",
          ),
        );
    }

    const identity = requireOpenWebUiIdentity(request);
    const thread = await options.resolveThread({
      externalThreadId: input.threadId,
      userId: identity.userId,
      userRole: identity.role,
    });
    const abortController = new AbortController();
    request.raw.once("aborted", () => abortController.abort());
    reply.raw.once("close", () => abortController.abort());
    let events: AsyncIterable<
      import("../../../../packages/ag-ui-api-contract/src/index.js").AGUIEvent
    >;
    try {
      events = runAgUi({
        input,
        principalId: thread.principalId,
        internalThreadId: thread.threadId,
        signal: abortController.signal,
      });
    } catch {
      events = oneErrorEvent();
    }
    return reply
      .type(AG_UI_SSE_CONTENT_TYPE)
      .header("cache-control", "no-cache, no-transform")
      .header("connection", "keep-alive")
      .header("x-accel-buffering", "no")
      .send(
        Readable.from(
          encodeEventStream(events, abortController.signal, async (result) => {
            await options.persistAssistantMessages?.({
              principalId: thread.principalId,
              internalThreadId: thread.threadId,
              runInput: input,
              ...result,
            });
          }),
        ),
      );
  });
};

async function* encodeEventStream(
  events: AsyncIterable<
    import("../../../../packages/ag-ui-api-contract/src/index.js").AGUIEvent
  >,
  signal: AbortSignal,
  persist: (input: {
    readonly messages: readonly {
      readonly externalMessageId: string;
      readonly contentText: string;
    }[];
    readonly truncated: boolean;
  }) => Promise<void>,
): AsyncGenerator<string> {
  const assistantIds = new Set<string>();
  const published = new Map<string, string>();
  let failed = false;
  let terminal = false;
  try {
    for await (const event of events) {
      if (signal.aborted) return;
      observeAssistantEvent(event, assistantIds, published);
      if (event.type === "RUN_FINISHED") terminal = true;
      if (event.type === "RUN_ERROR") {
        terminal = true;
        failed = true;
      }
      yield encodeProfileAgUiSse(event);
    }
  } catch {
    failed = true;
    if (!signal.aborted) {
      terminal = true;
      yield encodeProfileAgUiSse(createSafeAgUiRunError());
    }
  } finally {
    if (published.size > 0) {
      await persist({
        messages: [...published].map(([externalMessageId, contentText]) => ({
          externalMessageId,
          contentText,
        })),
        truncated: signal.aborted || failed || !terminal,
      });
    }
  }
}

async function* oneErrorEvent() {
  yield createSafeAgUiRunError();
}

function validateRunLimits(
  input: RunAgentInput,
  config: ServerConfig,
): string | undefined {
  if (input.threadId.length > 256 || input.runId.length > 256) {
    return "Run and thread identifiers must not exceed 256 characters.";
  }
  if (input.messages.length > config.maxMessages) {
    return "The AG-UI message limit was exceeded.";
  }
  if (
    input.messages.some(
      (message) => JSON.stringify(message).length > config.maxMessageChars,
    )
  ) {
    return "An AG-UI message exceeded the configured size limit.";
  }
  return undefined;
}

function agUiError(code: string, message: string) {
  return { error: { code, message, type: "ag_ui_error" } };
}

function observeAssistantEvent(
  event: import("../../../../packages/ag-ui-api-contract/src/index.js").AGUIEvent,
  assistantIds: Set<string>,
  published: Map<string, string>,
): void {
  const value = event as unknown as Readonly<Record<string, unknown>>;
  const messageId =
    typeof value.messageId === "string" ? value.messageId : undefined;
  if (
    event.type === "TEXT_MESSAGE_START" &&
    value.role === "assistant" &&
    messageId !== undefined
  ) {
    assistantIds.add(messageId);
    return;
  }
  if (
    (event.type === "TEXT_MESSAGE_CONTENT" ||
      event.type === "TEXT_MESSAGE_CHUNK") &&
    messageId !== undefined &&
    assistantIds.has(messageId) &&
    typeof value.delta === "string"
  ) {
    published.set(messageId, (published.get(messageId) ?? "") + value.delta);
  }
}
