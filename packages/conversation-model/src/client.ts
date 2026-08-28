import { z } from "zod";

import {
  parseTurnDecision,
  type ConversationModel,
  type ConversationModelInput,
  type ConversationSummaryInput,
  type PublishedResultInput,
} from "./index.js";
import {
  conversationModelEndpoint,
  type ConversationModelConfig,
} from "./config.js";
import {
  decisionPrompt,
  explanationPrompt,
  generalAnswerPrompt,
  summaryPrompt,
  type ModelPromptMessage,
} from "./prompts.js";
import {
  parseTurnPlan,
  turnPlanSchema,
} from "../../world-grounding-contract/src/index.js";

const completionResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string() }).passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const MAX_RESPONSE_CHARACTERS = 65_536;
const READINESS_CACHE_MS = 30_000;

export type ConversationModelErrorCode =
  | "CONVERSATION_MODEL_TIMEOUT"
  | "CONVERSATION_MODEL_UNAVAILABLE"
  | "CONVERSATION_MODEL_RESPONSE_INVALID"
  | "CONVERSATION_MODEL_OUTPUT_INVALID";

export class ConversationModelError extends Error {
  constructor(
    readonly code: ConversationModelErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ConversationModelError";
  }
}

export interface ConversationModelClientOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export class OpenAiCompatibleConversationModel implements ConversationModel {
  readonly #fetch: typeof fetch;
  readonly #endpoint: string;
  readonly #now: () => number;
  #readiness:
    { readonly checkedAt: number; readonly available: boolean } | undefined;

  constructor(
    readonly config: ConversationModelConfig,
    options: ConversationModelClientOptions = {},
  ) {
    this.#fetch = options.fetch ?? fetch;
    this.#endpoint = conversationModelEndpoint(config);
    this.#now = options.now ?? Date.now;
  }

  async decideTurn(input: ConversationModelInput): Promise<unknown> {
    const content = await this.#complete(decisionPrompt(input), true);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new ConversationModelError(
        "CONVERSATION_MODEL_OUTPUT_INVALID",
        "Conversation model returned invalid structured output.",
      );
    }
    try {
      return parseTurnPlan(parsed);
    } catch {
      try {
        return parseTurnDecision(parsed);
      } catch {
        throw new ConversationModelError(
          "CONVERSATION_MODEL_OUTPUT_INVALID",
          "Conversation model returned a decision outside the allowed schema.",
        );
      }
    }
  }

  answerGeneral(input: ConversationModelInput): Promise<string> {
    return this.#complete(generalAnswerPrompt(input), false);
  }

  summarize(input: ConversationSummaryInput): Promise<string> {
    return this.#complete(summaryPrompt(input), false);
  }

  explainPublishedResult(input: PublishedResultInput): Promise<string> {
    return this.#complete(explanationPrompt(input), false);
  }

  async readiness(): Promise<boolean> {
    const now = this.#now();
    if (
      this.#readiness !== undefined &&
      now - this.#readiness.checkedAt < READINESS_CACHE_MS
    ) {
      return this.#readiness.available;
    }
    let available = false;
    try {
      const content = await this.#request(
        [{ role: "system", content: "Reply with OK." }],
        false,
        4,
      );
      available = content.length > 0;
    } catch {
      available = false;
    }
    this.#readiness = { checkedAt: now, available };
    return available;
  }

  async #complete(
    messages: readonly ModelPromptMessage[],
    structured: boolean,
  ): Promise<string> {
    const content = await this.#request(messages, structured);
    const normalized = content.trim();
    if (
      normalized.length === 0 ||
      normalized.length > MAX_RESPONSE_CHARACTERS
    ) {
      throw new ConversationModelError(
        "CONVERSATION_MODEL_RESPONSE_INVALID",
        "Conversation model returned an empty or oversized response.",
      );
    }
    return normalized;
  }

  async #request(
    messages: readonly ModelPromptMessage[],
    structured: boolean,
    maxTokens = this.config.maxOutputTokens,
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs,
      );
      try {
        const response = await this.#fetch(this.#endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.config.apiKey.length === 0
              ? {}
              : { authorization: `Bearer ${this.config.apiKey}` }),
          },
          body: JSON.stringify({
            model: this.config.modelName,
            messages,
            temperature: this.config.temperature,
            max_tokens: maxTokens,
            ...(structured
              ? {
                  response_format:
                    this.config.responseFormat === "json_schema"
                      ? {
                          type: "json_schema",
                          json_schema: {
                            name: "sacs_turn_plan_v04",
                            strict: true,
                            schema: z.toJSONSchema(turnPlanSchema),
                          },
                        }
                      : { type: "json_object" },
                }
              : {}),
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          const error = new ConversationModelError(
            "CONVERSATION_MODEL_UNAVAILABLE",
            "Conversation model request failed.",
            retryable,
          );
          if (!retryable) throw error;
          lastError = error;
          continue;
        }
        let document: unknown;
        try {
          const responseText = await response.text();
          if (responseText.length > MAX_RESPONSE_CHARACTERS) {
            throw new ConversationModelError(
              "CONVERSATION_MODEL_RESPONSE_INVALID",
              "Conversation model returned an oversized response.",
            );
          }
          document = JSON.parse(responseText);
        } catch {
          throw new ConversationModelError(
            "CONVERSATION_MODEL_RESPONSE_INVALID",
            "Conversation model returned invalid JSON.",
          );
        }
        const parsed = completionResponseSchema.safeParse(document);
        if (!parsed.success) {
          throw new ConversationModelError(
            "CONVERSATION_MODEL_RESPONSE_INVALID",
            "Conversation model response did not match Chat Completions.",
          );
        }
        return parsed.data.choices[0]?.message.content ?? "";
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          lastError = new ConversationModelError(
            "CONVERSATION_MODEL_TIMEOUT",
            "Conversation model request timed out.",
            true,
          );
        } else if (error instanceof ConversationModelError) {
          lastError = error;
          if (!error.retryable) throw error;
        } else {
          lastError = new ConversationModelError(
            "CONVERSATION_MODEL_UNAVAILABLE",
            "Conversation model is unavailable.",
            true,
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw (
      lastError ??
      new ConversationModelError(
        "CONVERSATION_MODEL_UNAVAILABLE",
        "Conversation model is unavailable.",
      )
    );
  }
}
