import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createWsgsHttpClient,
  type WsgsHttpAdapterConfig,
  type WsgsGroundingRequest,
} from "../../../packages/wsgs-http-adapter/src/index.js";
import { WorldGroundingRuntime } from "../../../packages/world-grounding-runtime/src/index.js";
import { GroundingSourceAnalysisRuntime } from "../../../packages/analysis-runtime/src/grounding-source-runtime.js";
import { createGroundingSourceAnalysisControl } from "../../../packages/analysis-control-runtime/src/grounding-source-control.js";
import { GroundingJobAnalysisSourceAdapter } from "../../../packages/wsgs-analysis-adapter/src/grounding-job.js";
import type { GroundingAnalysisConfig } from "../../../packages/wsgs-analysis-adapter/src/config.js";
import type { PersistenceRuntime } from "../../../packages/persistence/src/index.js";
import { hashCanonicalJson } from "../../../packages/world-explanation-contract/src/index.js";
import {
  createGroundingAnalysisAgUiV03RunHandler,
  projectAnalysisRunStarted,
  projectAnalysisStateSnapshot,
  projectAnalysisActivitySnapshot,
  projectAnalysisStepStarted,
  projectAnalysisStepFinished,
  projectAnalysisText,
  projectAnalysisRunFinished,
  projectAnalysisRunInterrupted,
} from "../../../packages/ag-ui-analysis-adapter/src/index.js";
import type { AgUiRunHandler } from "../../../packages/ag-ui-interaction-adapter/src/index.js";
import { parseAndVerifyAgUiSharedStateV03 } from "../../../packages/analysis-contract/src/index.js";

export function createV06GroundingAnalysis(input: {
  persistence: PersistenceRuntime;
  config: GroundingAnalysisConfig;
  wsgsConfig: WsgsHttpAdapterConfig;
  sdarCompatibilityLock: unknown;
}) {
  const { persistence, config } = input;
  if (config.enabled && config.transport !== "GROUNDING_JOB")
    throw Error("ANALYSIS_SOURCE_TRANSPORT_UNAVAILABLE");
  const wsgs = createWsgsHttpClient({
    ...input.wsgsConfig,
    ...(config.enabled || !config.allowLegacy10
      ? { contractVersion: config.contractVersion }
      : {}),
  });
  const world: WorldGroundingRuntime = new WorldGroundingRuntime({
    requests: persistence.interactionRepository,
    grounding: persistence.groundingRepository,
    worldFocus: persistence.worldFocusRepository,
    authorityFusion: persistence.authorityFusionRepository,
    worldExplanations: persistence.worldExplanationRepository,
    conversation: persistence.conversationRepository,
    wsgs,
    sdarCompatibilityLock: input.sdarCompatibilityLock,
    sourcePolling: {
      pollIntervalMs: config.pollIntervalMs,
      maxDurationMs: config.maxWaitMs,
      maxConsecutiveFailures: config.maxConsecutivePollFailures,
    },
    ...(config.enabled
      ? {
          onSourceStarted: async (execution, owner) =>
            source!.accept(execution, owner),
          awaitSourceCompletion: async (request) => source!.complete(request),
        }
      : {}),
  });
  if (!config.enabled)
    return {
      world,
      source: undefined,
      analysisControl: undefined,
      runAgUiV03: undefined,
      capabilities: async () => ({
        enabled: false,
        transport: "GROUNDING_JOB",
        groundingContractReady: false,
        resultProfileReady: false,
        nativeReady: false,
        nativeReasonCode: "SACS_WSGS_NATIVE_ANALYSIS_CONTROL_DEFERRED",
      }),
    };
  const source: GroundingSourceAnalysisRuntime =
    new GroundingSourceAnalysisRuntime({
      analysis: persistence.analysisRepository,
      grounding: persistence.groundingRepository,
      world,
      maxActivePumps: config.maxActivePumps,
      viewLimits: {
        maxMapLayers: config.maxMapLayers,
        maxTimelineItems: config.maxTimelineItems,
        maxResultCandidates: config.maxResultCandidates,
        maxSafePayloadBytes: config.maxSafePayloadBytes,
      },
    });
  const activeSource = source;
  const analysisControl = createGroundingSourceAnalysisControl({
    runtime: source,
    store: persistence.analysisDevelopmentRepository,
    analysis: persistence.analysisRepository,
    grounding: persistence.groundingRepository,
    wsgs,
  });
  const adapter = new GroundingJobAnalysisSourceAdapter(wsgs, {
    pollIntervalMs: config.pollIntervalMs,
    maxDurationMs: config.maxWaitMs,
    maxConsecutiveFailures: config.maxConsecutivePollFailures,
  });
  let lastCapabilityCheck: string | undefined;
  const capabilities = async () => {
    try {
      const value = await adapter.capabilities();
      lastCapabilityCheck = new Date().toISOString();
      return {
        enabled: true,
        transport: "GROUNDING_JOB",
        groundingContractReady: true,
        resultProfileReady: true,
        ...value,
        lastSuccessfulCapabilityCheck: lastCapabilityCheck,
      };
    } catch {
      return {
        enabled: true,
        transport: "GROUNDING_JOB",
        groundingContractReady: false,
        resultProfileReady: false,
        nativeReady: false,
        nativeReasonCode: "SACS_WSGS_NATIVE_ANALYSIS_CONTROL_DEFERRED",
        reasonCodes: ["WSGS_CAPABILITY_CHECK_UNAVAILABLE"],
        ...(lastCapabilityCheck
          ? { lastSuccessfulCapabilityCheck: lastCapabilityCheck }
          : {}),
      };
    }
  };
  const handler: AgUiRunHandler = async function* (context) {
    const directive = z
      .strictObject({
        mode: z.enum(["START", "RECONNECT"]).default("START"),
        analysisId: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u)
          .optional(),
      })
      .parse(context.input.forwardedProps ?? {});
    const identity = {
      threadId: context.input.threadId,
      runId: context.input.runId,
    };
    let analysisId = directive.analysisId;
    if (directive.mode === "START") {
      const user = context.input.messages
        .filter((message) => message.role === "user")
        .at(-1);
      const text = z.string().min(1).max(32768).parse(user?.content);
      const digest = hashCanonicalJson({
        principalId: context.principalId,
        threadId: context.internalThreadId,
        runId: context.input.runId,
        text,
      }).slice(7);
      analysisId = "analysis-" + digest;
      const leaseOwner = "agui-source-" + randomUUID();
      const claim = await persistence.interactionRepository.claimRequest({
        protocol: "ag_ui",
        externalRequestId: "analysis-" + context.input.runId,
        principalId: context.principalId,
        threadId: context.internalThreadId,
        requestHash: digest,
        leaseOwner,
        leaseMs: 180000,
      });
      if (claim.outcome === "conflict")
        throw Error("ANALYSIS_SOURCE_REPLAY_CONFLICT");
      if (claim.outcome === "acquired") {
        const createdAt =
          await persistence.interactionRepository.authorizedRequestCreatedAt({
            requestId: claim.requestId,
            principalId: context.principalId,
            threadId: context.internalThreadId,
          });
        const request: WsgsGroundingRequest = {
          schemaVersion: "1.0",
          requestId: "wsgs-" + digest,
          operation: "EXECUTE_WORLD_QUERY",
          source: {
            conversationRef: context.internalThreadId,
            messageId: "message-" + digest,
            originalText: text,
            originalTextSha256:
              "sha256:" + createHash("sha256").update(text).digest("hex"),
            locale: "zh-CN",
            createdAt,
          },
          requestedProducts: [
            "MENTIONS",
            "RESOLVED_REFERENCES",
            "GROUNDING_GRAPH",
            "WORLD_EVIDENCE",
          ],
          contextCapsule: {
            knownWorldReferences: [],
            priorGroundings: [],
            mapSelections: [],
            externalCorrelationHints: [],
            externalPredicates: [],
          },
          executionPolicy: {
            readOnly: true,
            deadlineMs: Math.min(config.maxWaitMs, 120000),
            maxQueryOperations: 16,
            maxCandidatesPerMention: 5,
            maxResultBytes: 1048576,
            allowApproximation: false,
          },
        };
        await world.beginWorldGrounding({
          analysisId,
          revisionId: "revision-" + digest,
          groundingExecutionId: "grounding-" + digest,
          interactionRequestId: claim.requestId,
          leaseOwner,
          principalId: context.principalId,
          threadId: context.internalThreadId,
          requestId: request.requestId,
          canonicalGroundingRequest: request,
          requestHash: hashCanonicalJson(request),
          idempotencyKey: "wsgs-grounding-" + digest,
        });
      }
    }
    if (!analysisId) throw Error("ANALYSIS_NOT_FOUND");
    const scope = {
      analysisId,
      principalId: context.principalId,
      threadId: context.internalThreadId,
    };
    if (!(await activeSource.getProjection(scope)))
      throw Error("ANALYSIS_NOT_FOUND");
    await activeSource.pump.ensure(scope);
    yield projectAnalysisRunStarted(identity);
    yield projectAnalysisStepStarted({ stepName: "world-grounding" });
    let latest = await activeSource.getProjection(scope);
    for await (const observation of activeSource.pump.observe(scope)) {
      if (context.signal.aborted) return;
      latest = observation.projection;
      yield projectAnalysisStateSnapshot({
        stateRevision: latest.stateRevision,
        state: latest.state,
      });
      yield projectAnalysisActivitySnapshot({
        messageId: "activity-" + analysisId,
        activityRevision: latest.activityRevision,
        content: latest.activity,
      });
    }
    if (!latest) throw Error("ANALYSIS_NOT_FOUND");
    const state = parseAndVerifyAgUiSharedStateV03(latest.state);
    yield projectAnalysisStepFinished({ stepName: "world-grounding" });
    const view = state.worldExplanation as
      | {
          summary?: { primaryText?: string };
          status?: string;
          choices?: unknown[];
        }
      | undefined;
    if (view?.summary?.primaryText)
      yield* projectAnalysisText({
        messageId: "answer-" + context.input.runId,
        text: view.summary.primaryText,
      });
    if (view?.status === "WAITING_SELECTION")
      yield* projectAnalysisRunInterrupted({
        identity,
        stateRevision: latest.stateRevision,
        state: latest.state,
        activityMessageId: "activity-" + analysisId,
        activityRevision: latest.activityRevision,
        activity: latest.activity,
        interrupts: [
          {
            id: "choice-" + analysisId,
            reason: "AMBIGUITY",
            message: "请选择上游发布的候选对象。",
          },
        ],
      });
    else yield projectAnalysisRunFinished(identity);
  };
  return {
    world,
    source,
    analysisControl,
    runAgUiV03: createGroundingAnalysisAgUiV03RunHandler(handler),
    capabilities,
  };
}
