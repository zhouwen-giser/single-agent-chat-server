import { randomUUID } from "node:crypto";
import process from "node:process";

import {
  createInteractionAgUiRunHandler,
  type AgUiRunHandler,
} from "../../../packages/ag-ui-interaction-adapter/src/index.js";
import { SdarTaskCoordinator } from "../../../packages/chat-runtime/src/index.js";
import {
  DurableAgUiRunService,
  InterruptResumeService,
  resumeRunToInteractionEvents,
} from "../../../packages/interaction-runtime/src/index.js";
import { InteractionQueryService } from "../../../packages/interaction-query/src/index.js";
import {
  AgUiTaskCoordinatorRepository,
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
import {
  createSdarAgUiInteractionSource,
  createSdarAgUiTaskRecoverySource,
} from "./chat/sdar-agui-runner.js";
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
  const chatModel = instrumentChatModel(localFallbackChatModel, telemetry);
  const queryService = new InteractionQueryService(
    activePersistence.interactionRepository,
    getClient,
  );
  const agUiCoordinator = new SdarTaskCoordinator({
    repository: new AgUiTaskCoordinatorRepository(
      activePersistence.interactionRepository,
    ),
    getClient,
    streamBudgetMs: config.streamBudgetMs,
    pollingBudgetMs: config.pollingBudgetMs,
    pollingIntervalMs: config.pollingIntervalMs,
  });
  const durableAgUiRunService = new DurableAgUiRunService({
    repository: activePersistence.interactionRepository,
    execute: createSdarAgUiInteractionSource({
      repository: activePersistence.interactionRepository,
      checkpointer: activePersistence.checkpointer,
      coordinator: agUiCoordinator,
      queryService,
      model: chatModel,
    }),
    recoverTask: createSdarAgUiTaskRecoverySource(agUiCoordinator),
  });
  const runGeneralAgUi = createInteractionAgUiRunHandler((context) =>
    durableAgUiRunService.run({
      input: context.input,
      principalId: context.principalId,
      threadId: context.internalThreadId,
      signal: context.signal,
    }),
  );
  const interruptResumeService = new InterruptResumeService({
    repository: activePersistence.interactionRepository,
    getClient,
  });
  const runResumeAgUi = createInteractionAgUiRunHandler((context) =>
    resumeRunToInteractionEvents({
      service: interruptResumeService,
      runInput: context.input,
      principalId: context.principalId,
      threadId: context.internalThreadId,
      signal: context.signal,
    }),
  );
  const runAgUi: AgUiRunHandler = (context) =>
    (context.input.resume?.length ?? 0) > 0
      ? runResumeAgUi(context)
      : runGeneralAgUi(context);
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
      queryService,
      model: chatModel,
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
    resolveAgUiThread: async (input) => {
      const principal =
        await activePersistence.interactionRepository.resolvePrincipal({
          issuer: "openwebui-jwt",
          subject: input.userId,
          role: input.userRole,
        });
      return activePersistence.interactionRepository.getOrCreateThread({
        clientType: "ag_ui",
        externalThreadId: input.externalThreadId,
        principalId: principal.principalId,
      });
    },
    runAgUi,
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
): AsyncGenerator<
  | string
  | import("../../../packages/interaction-contract/src/index.js").SdarInteractionEvent
> {
  try {
    yield* result;
  } finally {
    await refresh().catch(() => undefined);
  }
}
