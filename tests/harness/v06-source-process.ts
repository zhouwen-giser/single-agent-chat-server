import process from "node:process";
import { readFileSync } from "node:fs";
import {
  setupPersistence,
  type GroundingExecution,
} from "../../packages/persistence/src/index.js";
import { buildServer } from "../../apps/server/src/bootstrap.js";
import { parseServerConfig } from "../../apps/server/src/config.js";
import { createV06GroundingAnalysis } from "../../apps/server/src/v06-grounding-analysis.js";
import { parseGroundingAnalysisConfig } from "../../packages/wsgs-analysis-adapter/src/config.js";
// Test-only process composition: production runtime, API and real PostgreSQL.
// Storage-port barriers only signal a committed fault point; no state is faked.
const config = parseServerConfig({
  CHAT_SERVER_SERVICE_KEY: process.env.SACS_TEST_CHAT_KEY,
  AG_UI_SERVICE_KEY: process.env.SACS_TEST_AGUI_KEY,
  OPENWEBUI_USER_JWT_SECRET: process.env.SACS_TEST_JWT_KEY,
  CHAT_RATE_LIMIT_MAX: "1000",
  CHAT_HTTP_STREAM_BUDGET_MS: "120000",
  CHAT_SERVER_REQUEST_TIMEOUT_MS: "120000",
});
const persistence = await setupPersistence({
  connectionString: process.env.TEST_DATABASE_URL!,
  poolMax: 12,
  operationTimeoutMs: 1500,
  idempotencyLeaseMs: 180000,
  maxActiveTasksPerChat: 8,
});
const point = process.env.SACS_TEST_FAULT_POINT;
async function barrier(name: string, execution?: GroundingExecution) {
  if (point !== name) return;
  process.send?.({
    event: "fault",
    point: name,
    pid: process.pid,
    groundingId: execution?.groundingId,
    requestHash: execution?.requestHash,
    lastSourceStatus: execution?.lastSourceStatus,
  });
  await new Promise<void>(() => undefined);
}
const grounding = new Proxy(persistence.groundingRepository, {
  get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof value !== "function") return value;
    return async (...args: unknown[]) => {
      const result = await Reflect.apply(value, target, args);
      if (key === "claim" && point === "after-claim")
        await barrier(
          point,
          (result as { execution: GroundingExecution }).execution,
        );
      if (key === "recordSourceSnapshot") {
        const execution = (result as { execution: GroundingExecution })
          .execution;
        if (
          point === "after-source-id" &&
          execution.lastSourceStatus === "ACCEPTED"
        )
          await barrier(point, execution);
        if (
          point === "after-running" &&
          execution.lastSourceStatus === "RUNNING"
        )
          await barrier(point, execution);
        if (point === "after-terminal" && execution.groundingResult)
          await barrier(point, execution);
      }
      return result;
    };
  },
});
const composition = createV06GroundingAnalysis({
  persistence: { ...persistence, groundingRepository: grounding },
  config: parseGroundingAnalysisConfig({
    SACS_WSGS_ANALYSIS_ENABLED: "true",
    SACS_WSGS_ANALYSIS_POLL_INTERVAL_MS: "200",
    SACS_WSGS_ANALYSIS_MAX_WAIT_MS: "90000",
  }),
  wsgsConfig: {
    baseUrl: process.env.SACS_TEST_WSGS_URL!,
    operationTimeoutMs: 120000,
  },
  sdarCompatibilityLock: JSON.parse(
    readFileSync(
      "dependencies/sdar-grounding-extension-compatibility-lock.json",
      "utf8",
    ),
  ),
});
const server = buildServer({
  config,
  readinessCheck: () => persistence.readiness(),
  conversationModelReadinessCheck: async () => true,
  analysisReadinessCheck: composition.readiness,
  resolveChatThread: (input) => persistence.repository.getOrCreateThread(input),
  runAgUiV03: composition.runAgUiV03,
  analysisControl: composition.analysisControl,
  analysisCapabilities: composition.capabilities,
  resolveAgUiThread: async (input) => {
    const principal = await persistence.interactionRepository.resolvePrincipal({
      issuer: "openwebui-jwt",
      subject: input.userId,
      role: input.userRole,
    });
    return persistence.interactionRepository.getOrCreateThread({
      clientType: "ag_ui",
      externalThreadId: input.externalThreadId,
      principalId: principal.principalId,
    });
  },
});
const url = await server.listen({ host: "127.0.0.1", port: 0 });
composition.source?.startRecovery(30000, (code) =>
  process.send?.({ event: "recovery-deferred", code, pid: process.pid }),
);
process.send?.({
  event: "ready",
  pid: process.pid,
  url,
  leaseMs: 180000,
  recoveryTickMs: 30000,
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void (async () => {
      await composition.source?.close();
      await server.close();
      await persistence.close();
      process.exit(0);
    })();
  });
