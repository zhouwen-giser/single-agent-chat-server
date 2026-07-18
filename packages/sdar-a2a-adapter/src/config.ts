import { z } from "zod";

import type { SdarA2aAdapterConfig } from "./client.js";

const emptyToUndefined = (value: unknown): unknown =>
  value === "" ? undefined : value;

const environmentSchema = z.object({
  SDAR_A2A_BASE_URL: z.string().url().default("http://127.0.0.1:9999"),
  SDAR_A2A_ENDPOINT_OVERRIDE: z.preprocess(
    emptyToUndefined,
    z.string().url().optional(),
  ),
  SDAR_A2A_DISCOVERY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(120_000)
    .default(10_000),
  SDAR_A2A_OPERATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(30_000),
});

export function parseSdarA2aConfig(
  environment: NodeJS.ProcessEnv,
): SdarA2aAdapterConfig {
  const parsed = environmentSchema.parse(environment);
  return {
    baseUrl: parsed.SDAR_A2A_BASE_URL,
    ...(parsed.SDAR_A2A_ENDPOINT_OVERRIDE === undefined
      ? {}
      : { endpointOverride: parsed.SDAR_A2A_ENDPOINT_OVERRIDE }),
    discoveryTimeoutMs: parsed.SDAR_A2A_DISCOVERY_TIMEOUT_MS,
    operationTimeoutMs: parsed.SDAR_A2A_OPERATION_TIMEOUT_MS,
  };
}
