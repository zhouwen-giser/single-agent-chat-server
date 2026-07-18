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
  type SdarA2aClient,
} from "../../../packages/sdar-a2a-adapter/src/index.js";
import { buildServer } from "./bootstrap.js";
import { createSdarChatRunner } from "./chat/sdar-chat-runner.js";
import { loadServerConfig } from "./config.js";

let persistence: PersistenceRuntime | undefined;
try {
  const config = loadServerConfig();
  persistence = await setupPersistence(parsePersistenceConfig(process.env));
  const activePersistence = persistence;
  const getClient = createLazySdarClient();
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
  const server = buildServer({
    config,
    logger: true,
    resolveChatThread: (input) =>
      activePersistence.repository.getOrCreateThread(input),
    checkpointer: activePersistence.checkpointer,
    runChat: createSdarChatRunner({
      repository: activePersistence.repository,
      checkpointer: activePersistence.checkpointer,
      coordinator,
    }),
  });
  server.addHook("onClose", async () => activePersistence.close());
  server.log.info(
    {
      activeTaskBindings: reconciliation.activeBindings.length,
      recoveredIdempotencyClaims: reconciliation.recoveredClaimCount,
    },
    "persistence startup reconciliation complete",
  );
  await server.listen({ host: config.host, port: config.port });
} catch (error: unknown) {
  await persistence?.close().catch(() => undefined);
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(
    JSON.stringify({ event: "server.start.failed", message }) +
      String.fromCharCode(10),
  );
  process.exitCode = 1;
}

function createLazySdarClient(): () => Promise<SdarA2aClient> {
  let pending: Promise<SdarA2aClient> | undefined;
  return () => {
    if (pending === undefined) {
      pending = createSdarA2aClient(parseSdarA2aConfig(process.env)).catch(
        (error: unknown) => {
          pending = undefined;
          throw error;
        },
      );
    }
    return pending;
  };
}
