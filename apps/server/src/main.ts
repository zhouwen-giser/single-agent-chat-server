import { randomUUID } from "node:crypto";
import process from "node:process";

import { SdarTaskCoordinator } from "../../../packages/chat-runtime/src/index.js";
import {
  parsePersistenceConfig,
  setupPersistence,
  type PersistenceRuntime,
} from "../../../packages/persistence/src/index.js";
import {
  createSdarA2aClient,
  parseSdarA2aConfig,
} from "../../../packages/sdar-a2a-adapter/src/index.js";
import { localFallbackChatModel } from "../../../src/agent/model.js";

import type { ChatRunner, ChatRunnerResult } from "./api/openai-routes.js";
import { buildServer } from "./bootstrap.js";
import { createLazySdarClient } from "./chat/lazy-sdar-client.js";
import { createSdarChatRunner } from "./chat/sdar-chat-runner.js";
import { loadServerConfig } from "./config.js";
import { instrumentChatModel } from "./observability/instrumented-chat-model.js";
import { instrumentSdarClient } from "./observability/instrumented-sdar-client.js";
import { createSecureLoggerOptions } from "./observability/logging.js";
import { SecureTelemetry } from "./observability/telemetry.js";
import { installGracefulShutdown } from "./shutdown.js";

let persistence: PersistenceRuntime | undefined;
try {
  const config = loadServerConfig();
  persistence = await setupPersistence(parsePersistenceConfig(process.env));
  const activePersistence = persistence;
  const telemetry = new SecureTelemetry();
  const getClient = createLazySdarClient(async () => {
    const discovery = telemetry.beginA2a("agent_card_discovery");
    try {
      const client = await createSdarA2aClient(parseSdarA2aConfig(process.env));
      discovery.end("ok");
      return instrumentSdarClient(client, telemetry);
    } catch (error) {
      discovery.end("error");
      throw error;
    }
  });
  const coordinator = new SdarTaskCoordinator({
    repository: activePersistence.repository,
    getClient,
    streamBudgetMs: config.streamBudgetMs,
    pollingBudgetMs: config.pollingBudgetMs,
    pollingIntervalMs: config.pollingIntervalMs,
  });
  const reconciliation = await persistence.repository.reconcileStartup({
    leaseOwner: randomUUID(),
  });
  telemetry.setActiveTasks(reconciliation.activeBindings.length);
  const runChat = withActiveTaskRefresh(
    createSdarChatRunner({
      repository: activePersistence.repository,
      checkpointer: activePersistence.checkpointer,
      coordinator,
      model: instrumentChatModel(localFallbackChatModel, telemetry),
    }),
    async () => {
      telemetry.setActiveTasks(
        await activePersistence.repository.countActiveTaskBindings(),
      );
    },
  );
  const server = buildServer({
    config,
    logger: createSecureLoggerOptions(config.logLevel),
    telemetry,
    readinessCheck: () => activePersistence.readiness(),
    resolveChatThread: (input) =>
      activePersistence.repository.getOrCreateThread(input),
    checkpointer: activePersistence.checkpointer,
    runChat,
  });
  server.addHook("onClose", async () => activePersistence.close());
  installGracefulShutdown(server);
  server.log.info(
    {
      activeTaskBindings: reconciliation.activeBindings.length,
      recoveredIdempotencyClaims: reconciliation.recoveredClaimCount,
      recoveredSubmissionSlots: reconciliation.recoveredSubmissionSlotCount,
    },
    "persistence startup reconciliation complete",
  );
  await server.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  await persistence?.close().catch(() => undefined);
  process.stderr.write(
    JSON.stringify({
      event: "server.start.failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    }) + String.fromCharCode(10),
  );
  process.exitCode = 1;
}

function withActiveTaskRefresh(
  runChat: ChatRunner,
  refresh: () => Promise<void>,
): ChatRunner {
  return async (context) => {
    const result = await runChat(context);
    if (typeof result === "string") {
      await refresh().catch(() => undefined);
      return result;
    }
    return refreshAfter(result, refresh);
  };
}

async function* refreshAfter(
  result: Exclude<ChatRunnerResult, string>,
  refresh: () => Promise<void>,
): AsyncGenerator<string> {
  try {
    yield* result;
  } finally {
    await refresh().catch(() => undefined);
  }
}
