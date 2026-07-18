import process from "node:process";

import { z } from "zod";

import { DEFAULT_CHAT_MODEL_ID } from "../../../packages/openai-api-contract/src/index.js";

const serverConfigSchema = z.object({
  CHAT_SERVER_SERVICE_KEY: z.string().min(32).max(512),
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

export interface ServerConfig {
  readonly serviceKey: string;
  readonly openWebUiUserJwtSecret: string;
  readonly host: string;
  readonly port: number;
  readonly bodyLimitBytes: number;
  readonly requestTimeoutMs: number;
  readonly modelId: string;
  readonly streamBudgetMs: number;
  readonly pollingBudgetMs: number;
  readonly pollingIntervalMs: number;
}

export function parseServerConfig(
  environment: NodeJS.ProcessEnv,
): ServerConfig {
  const parsed = serverConfigSchema.parse(environment);
  return {
    serviceKey: parsed.CHAT_SERVER_SERVICE_KEY,
    openWebUiUserJwtSecret: parsed.OPENWEBUI_USER_JWT_SECRET,
    host: parsed.CHAT_SERVER_HOST,
    port: parsed.CHAT_SERVER_PORT,
    bodyLimitBytes: parsed.CHAT_SERVER_BODY_LIMIT_BYTES,
    requestTimeoutMs: parsed.CHAT_SERVER_REQUEST_TIMEOUT_MS,
    modelId: parsed.CHAT_SERVER_MODEL_ID,
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
