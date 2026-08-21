import { z } from "zod";

const conversationModelEnvironmentSchema = z.object({
  CONVERSATION_MODEL_BASE_URL: z.string().trim().min(1).max(2_048),
  CONVERSATION_MODEL_NAME: z.string().trim().min(1).max(256),
  CONVERSATION_MODEL_API_KEY: z.string().max(4_096).default(""),
  CONVERSATION_MODEL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(120_000)
    .default(30_000),
  CONVERSATION_MODEL_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(1)
    .max(16_384)
    .default(2_048),
  CONVERSATION_MODEL_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  CONVERSATION_MODEL_MAX_RETRIES: z.coerce
    .number()
    .int()
    .min(0)
    .max(2)
    .default(1),
  CONVERSATION_MODEL_RESPONSE_FORMAT: z
    .enum(["json_schema", "json_object"])
    .default("json_schema"),
});

export interface ConversationModelConfig {
  readonly baseUrl: string;
  readonly modelName: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  readonly maxRetries: number;
  readonly responseFormat: "json_schema" | "json_object";
}

export function parseConversationModelConfig(
  environment: NodeJS.ProcessEnv,
): ConversationModelConfig | undefined {
  const baseUrl = environment.CONVERSATION_MODEL_BASE_URL?.trim();
  const modelName = environment.CONVERSATION_MODEL_NAME?.trim();
  if (baseUrl === undefined && modelName === undefined) return undefined;
  const parsed = conversationModelEnvironmentSchema.parse(environment);
  const url = new URL(parsed.CONVERSATION_MODEL_BASE_URL);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("CONVERSATION_MODEL_BASE_URL must use HTTP or HTTPS");
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      "CONVERSATION_MODEL_BASE_URL must not contain credentials, query, or fragment",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return {
    baseUrl: url.toString().replace(/\/$/u, ""),
    modelName: parsed.CONVERSATION_MODEL_NAME.trim(),
    apiKey: parsed.CONVERSATION_MODEL_API_KEY,
    timeoutMs: parsed.CONVERSATION_MODEL_TIMEOUT_MS,
    maxOutputTokens: parsed.CONVERSATION_MODEL_MAX_OUTPUT_TOKENS,
    temperature: parsed.CONVERSATION_MODEL_TEMPERATURE,
    maxRetries: parsed.CONVERSATION_MODEL_MAX_RETRIES,
    responseFormat: parsed.CONVERSATION_MODEL_RESPONSE_FORMAT,
  };
}

export function conversationModelEndpoint(
  config: ConversationModelConfig,
): string {
  const url = new URL(config.baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/chat/completions`;
  return url.toString();
}
