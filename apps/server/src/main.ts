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
  persistInterruptsBeforeRunFinish,
  resumeRunToInteractionEvents,
  taskRequestId,
} from "../../../packages/interaction-runtime/src/index.js";
import {
  InteractionTaskCoordinatorRepository,
  parsePersistenceConfig,
  setupPersistence,
  type PersistenceRuntime,
} from "../../../packages/persistence/src/index.js";
import {
  OpenAiCompatibleConversationModel,
  parseConversationModelConfig,
} from "../../../packages/conversation-model/src/index.js";
import {
  ClientHistoryImporter,
  ConversationContextAssembler,
  parseConversationContextBudget,
} from "../../../packages/conversation-context/src/index.js";
import {
  createSdarA2aClient,
  parseSdarA2aConfig,
} from "../../../packages/sdar-a2a-adapter/src/index.js";
import { adaptConversationModel } from "../../../src/agent/model.js";

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
  const telemetry = new SecureTelemetry();
  persistence = await setupPersistence(
    parsePersistenceConfig(process.env),
    telemetry,
  );
  const activePersistence = persistence;
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
  const conversationModelConfig = parseConversationModelConfig(process.env);
  const rawConversationModel =
    conversationModelConfig === undefined
      ? undefined
      : new OpenAiCompatibleConversationModel(conversationModelConfig);
  const conversationModel =
    rawConversationModel === undefined
      ? undefined
      : instrumentChatModel(rawConversationModel, telemetry);
  const chatModel =
    conversationModel === undefined
      ? undefined
      : adaptConversationModel(conversationModel);
  const contextAssembler = new ConversationContextAssembler(
    activePersistence.conversationRepository,
    activePersistence.interactionRepository,
    parseConversationContextBudget(process.env),
    telemetry,
  );
  const assembleContext = contextAssembler.assemble.bind(contextAssembler);
  const historyImporter = new ClientHistoryImporter(
    activePersistence.conversationRepository,
  );
  const agUiCoordinator = new SdarTaskCoordinator({
    repository: new InteractionTaskCoordinatorRepository(
      activePersistence.interactionRepository,
      "ag_ui",
    ),
    getClient,
    streamBudgetMs: config.streamBudgetMs,
    pollingBudgetMs: config.pollingBudgetMs,
    pollingIntervalMs: config.pollingIntervalMs,
  });
  const interruptResumeService = new InterruptResumeService({
    repository: activePersistence.interactionRepository,
    getClient,
  });
  const agUiInteractionSource = createSdarAgUiInteractionSource({
    repository: activePersistence.interactionRepository,
    checkpointer: activePersistence.checkpointer,
    coordinator: agUiCoordinator,
    model: chatModel,
    assembleContext,
    importHistory: historyImporter.import.bind(historyImporter),
    onClassificationError: (error) => {
      if (error === "ambiguous_task_reference") {
        telemetry.recordAmbiguousTaskReference();
      }
    },
  });
  const agUiTaskRecoverySource =
    createSdarAgUiTaskRecoverySource(agUiCoordinator);
  const durableAgUiRunService = new DurableAgUiRunService({
    repository: activePersistence.interactionRepository,
    execute: (context) =>
      persistInterruptsBeforeRunFinish(agUiInteractionSource(context), {
        service: interruptResumeService,
        principalId: context.principalId,
        internalThreadId: context.threadId,
      }),
    recoverTask: (context, taskId) =>
      persistInterruptsBeforeRunFinish(
        agUiTaskRecoverySource(context, taskId),
        {
          service: interruptResumeService,
          principalId: context.principalId,
          internalThreadId: context.threadId,
        },
      ),
  });
  const runGeneralAgUi = createInteractionAgUiRunHandler((context) =>
    durableAgUiRunService.run({
      input: context.input,
      principalId: context.principalId,
      threadId: context.internalThreadId,
      signal: context.signal,
    }),
  );
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
    repository: new InteractionTaskCoordinatorRepository(
      activePersistence.interactionRepository,
      "openai",
    ),
    getClient,
    streamBudgetMs: config.streamBudgetMs,
    pollingBudgetMs: config.pollingBudgetMs,
    pollingIntervalMs: config.pollingIntervalMs,
  });
  const reconciliation =
    await activePersistence.interactionRepository.reconcileStartup({
      leaseOwner: randomUUID(),
    });
  telemetry.setActiveTasks(reconciliation.activeBindings.length);
  const runChat = withActiveTaskRefresh(
    createSdarChatRunner({
      repository: activePersistence.repository,
      checkpointer: activePersistence.checkpointer,
      coordinator,
      model: chatModel,
      assembleContext,
      importHistory: historyImporter.import.bind(historyImporter),
      onClassificationError: (error) => {
        if (error === "ambiguous_task_reference") {
          telemetry.recordAmbiguousTaskReference();
        }
      },
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
    conversationModelReadinessCheck: () =>
      rawConversationModel?.readiness() ?? Promise.resolve(false),
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
    persistAgUiAssistantMessages: async (input) => {
      const run =
        await activePersistence.interactionRepository.findAuthorizedRun({
          runId: input.runInput.runId,
          principalId: input.principalId,
          threadId: input.internalThreadId,
        });
      const resumeInterruptId = input.runInput.resume?.[0]?.interruptId;
      const interrupt =
        run?.taskId !== undefined || resumeInterruptId === undefined
          ? undefined
          : await activePersistence.interactionRepository.findInterrupt({
              interruptId: resumeInterruptId,
              principalId: input.principalId,
              threadId: input.internalThreadId,
            });
      const taskId = run?.taskId ?? interrupt?.taskId;
      for (const message of input.messages) {
        await activePersistence.conversationRepository.appendAssistantMessage({
          principalId: input.principalId,
          threadId: input.internalThreadId,
          protocol: "ag_ui",
          externalMessageId: message.externalMessageId,
          requestId: taskRequestId(input.runInput.runId),
          contentText: message.contentText,
          ...(taskId === undefined ? {} : { taskId }),
          truncated: input.truncated,
        });
      }
    },
    checkpointer: activePersistence.checkpointer,
    runChat,
    persistAssistantMessage: async (input) => {
      await activePersistence.conversationRepository.appendAssistantMessage({
        ...input,
        protocol: "openai",
      });
    },
  });
  server.addHook("onClose", async () => activePersistence.close());
  installGracefulShutdown(server);
  server.log.info(
    {
      activeTaskBindings: reconciliation.activeBindings.length,
      recoveredIdempotencyClaims: reconciliation.recoveredClaimCount,
      recoveredSubmissionSlots: reconciliation.recoveredSubmissionSlotCount,
      recoveredTaskInteractionSlots:
        reconciliation.recoveredTaskInteractionSlotCount,
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
