import process from "node:process";

import { z } from "zod";

import { DEFAULT_CHAT_MODEL_ID } from "../../../packages/openai-api-contract/src/index.js";
import { parseCorsAllowedOrigins } from "./security/cors.js";

const serverConfigSchema = z.object({
  CHAT_SERVER_SERVICE_KEY: z.string().min(32).max(512),
  AG_UI_SERVICE_KEY: z.string().min(32).max(512),
  OPENWEBUI_USER_JWT_SECRET: z.string().min(32).max(512),
  CHAT_SERVER_HOST: z.string().min(1).default("127.0.0.1"),
  CHAT_SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CHAT_SERVER_BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .default(1024 * 1024),
  CHAT_SERVER_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120_000)
    .default(30_000),
  CHAT_SERVER_MODEL_ID: z
    .string()
    .min(1)
    .max(256)
    .default(DEFAULT_CHAT_MODEL_ID),
  CHAT_CORS_ALLOW_ORIGINS: z.string().max(4_096).default(""),
  CHAT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
  CHAT_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(60_000),
  CHAT_MAX_MESSAGES: z.coerce.number().int().min(1).max(128).default(64),
  CHAT_MAX_MESSAGE_CHARS: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(32_768),
  CHAT_MAX_RESPONSE_CHARS: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(4 * 1024 * 1024)
    .default(64 * 1024),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CHAT_HTTP_STREAM_BUDGET_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(120_000)
    .default(30_000),
  SDAR_POLLING_BUDGET_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(120_000)
    .default(5_000),
  SDAR_POLLING_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10)
    .max(30_000)
    .default(1_000),
});

const analysisAdapterEnvironmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["test", "development", "production"])
      .default("production"),
    SACS_ANALYSIS_ADAPTER_MODE: z
      .enum(["disabled", "fixture", "http"])
      .default("disabled"),
  })
  .strict();

export interface ServerConfig {
  readonly serviceKey: string;
  readonly agUiServiceKey: string;
  readonly openWebUiUserJwtSecret: string;
  readonly host: string;
  readonly port: number;
  readonly bodyLimitBytes: number;
  readonly requestTimeoutMs: number;
  readonly modelId: string;
  readonly corsAllowedOrigins: readonly string[];
  readonly rateLimitMax: number;
  readonly rateLimitWindowMs: number;
  readonly maxMessages: number;
  readonly maxMessageChars: number;
  readonly maxResponseChars: number;
  readonly logLevel: string;
  readonly streamBudgetMs: number;
  readonly pollingBudgetMs: number;
  readonly pollingIntervalMs: number;
}

export interface AnalysisAdapterEnvironment {
  readonly nodeEnv: "test" | "development" | "production";
  readonly adapterMode: "disabled" | "fixture" | "http";
}

/**
 * Parses the v0.5 analysis composition switch independently from the legacy
 * server settings. Fixture mode is an explicit local-development capability;
 * it can never make a production process analysis-ready.
 */
export function parseAnalysisAdapterEnvironment(
  environment: NodeJS.ProcessEnv,
): AnalysisAdapterEnvironment {
  const parsed = analysisAdapterEnvironmentSchema.parse({
    NODE_ENV: environment.NODE_ENV,
    SACS_ANALYSIS_ADAPTER_MODE: environment.SACS_ANALYSIS_ADAPTER_MODE,
  });
  if (
    parsed.SACS_ANALYSIS_ADAPTER_MODE === "fixture" &&
    parsed.NODE_ENV === "production"
  ) {
    throw new Error("SACS_ANALYSIS_FIXTURE_FORBIDDEN_IN_PRODUCTION");
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    adapterMode: parsed.SACS_ANALYSIS_ADAPTER_MODE,
  };
}

export function parseServerConfig(
  environment: NodeJS.ProcessEnv,
): ServerConfig {
  const parsed = serverConfigSchema.parse(environment);
  if (parsed.AG_UI_SERVICE_KEY === parsed.CHAT_SERVER_SERVICE_KEY) {
    throw new Error(
      "AG_UI_SERVICE_KEY must differ from CHAT_SERVER_SERVICE_KEY",
    );
  }
  return {
    serviceKey: parsed.CHAT_SERVER_SERVICE_KEY,
    agUiServiceKey: parsed.AG_UI_SERVICE_KEY,
    openWebUiUserJwtSecret: parsed.OPENWEBUI_USER_JWT_SECRET,
    host: parsed.CHAT_SERVER_HOST,
    port: parsed.CHAT_SERVER_PORT,
    bodyLimitBytes: parsed.CHAT_SERVER_BODY_LIMIT_BYTES,
    requestTimeoutMs: parsed.CHAT_SERVER_REQUEST_TIMEOUT_MS,
    modelId: parsed.CHAT_SERVER_MODEL_ID,
    corsAllowedOrigins: parseCorsAllowedOrigins(parsed.CHAT_CORS_ALLOW_ORIGINS),
    rateLimitMax: parsed.CHAT_RATE_LIMIT_MAX,
    rateLimitWindowMs: parsed.CHAT_RATE_LIMIT_WINDOW_MS,
    maxMessages: parsed.CHAT_MAX_MESSAGES,
    maxMessageChars: parsed.CHAT_MAX_MESSAGE_CHARS,
    maxResponseChars: parsed.CHAT_MAX_RESPONSE_CHARS,
    logLevel: parsed.LOG_LEVEL,
    streamBudgetMs: parsed.CHAT_HTTP_STREAM_BUDGET_MS,
    pollingBudgetMs: parsed.SDAR_POLLING_BUDGET_MS,
    pollingIntervalMs: parsed.SDAR_POLLING_INTERVAL_MS,
  };
}

export function loadServerConfig(envFilePath = ".env"): ServerConfig {
  loadEnvironmentFileIfPresent(envFilePath);
  return parseServerConfig(process.env);
}

function loadEnvironmentFileIfPresent(envFilePath: string): void {
  try {
    process.loadEnvFile(envFilePath);
  } catch (error: unknown) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
