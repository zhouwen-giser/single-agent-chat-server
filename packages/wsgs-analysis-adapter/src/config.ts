import { z } from "zod";
const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const boolean = z.enum(["true", "false"]).transform((v) => v === "true");
export const groundingAnalysisConfigSchema = z.strictObject({
  enabled: z.boolean(),
  transport: z.enum(["GROUNDING_JOB", "NATIVE", "FIXTURE"]),
  contractVersion: z.literal("sacs-wsgs-grounding/1.1"),
  resultProfile: z.literal("sacs-wsgs-geospatial-findings/1.0"),
  pollIntervalMs: integer(250, 10, 30000),
  maxWaitMs: integer(120000, 250, 120000),
  maxConsecutivePollFailures: integer(8, 1, 10),
  maxMapLayers: integer(128, 1, 128),
  maxTimelineItems: integer(1000, 1, 1000),
  maxResultCandidates: integer(100, 1, 100),
  maxSafePayloadBytes: integer(262144, 1024, 262144),
  maxActivePumps: integer(128, 1, 256),
  allowLegacy10: z.boolean(),
});
export type GroundingAnalysisConfig = z.infer<
  typeof groundingAnalysisConfigSchema
>;
export function parseGroundingAnalysisConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GroundingAnalysisConfig {
  const config = groundingAnalysisConfigSchema.parse({
    enabled: boolean.parse(env["SACS_WSGS_ANALYSIS_ENABLED"] ?? "false"),
    transport: env["SACS_WSGS_ANALYSIS_TRANSPORT"] ?? "GROUNDING_JOB",
    contractVersion:
      env["SACS_WSGS_ANALYSIS_CONTRACT_VERSION"] ?? "sacs-wsgs-grounding/1.1",
    resultProfile:
      env["SACS_WSGS_ANALYSIS_RESULT_PROFILE"] ??
      "sacs-wsgs-geospatial-findings/1.0",
    pollIntervalMs: env["SACS_WSGS_ANALYSIS_POLL_INTERVAL_MS"],
    maxWaitMs: env["SACS_WSGS_ANALYSIS_MAX_WAIT_MS"],
    maxConsecutivePollFailures:
      env["SACS_WSGS_ANALYSIS_MAX_CONSECUTIVE_POLL_FAILURES"],
    maxMapLayers: env["SACS_WSGS_ANALYSIS_MAX_MAP_LAYERS"],
    maxTimelineItems: env["SACS_WSGS_ANALYSIS_MAX_TIMELINE_ITEMS"],
    maxResultCandidates: env["SACS_WSGS_ANALYSIS_MAX_RESULT_CANDIDATES"],
    maxSafePayloadBytes: env["SACS_WSGS_ANALYSIS_MAX_SAFE_PAYLOAD_BYTES"],
    maxActivePumps: env["SACS_WSGS_ANALYSIS_MAX_ACTIVE_PUMPS"],
    allowLegacy10: boolean.parse(
      env["SACS_WSGS_ANALYSIS_ALLOW_LEGACY_1_0"] ?? "true",
    ),
  });
  if (
    config.transport === "FIXTURE" &&
    !["test", "development"].includes(env["NODE_ENV"] ?? "production")
  )
    throw Error("ANALYSIS_SOURCE_MODE_INVALID");
  if (config.enabled && config.transport === "NATIVE")
    throw Error("ANALYSIS_SOURCE_TRANSPORT_UNAVAILABLE");
  if (
    config.enabled &&
    env["SACS_ANALYSIS_ADAPTER_MODE"] === "fixture" &&
    config.transport !== "FIXTURE"
  )
    throw Error("ANALYSIS_SOURCE_MODE_INVALID");
  return config;
}
