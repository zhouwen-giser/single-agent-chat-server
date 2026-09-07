import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createWsgsHttpClient,
  type WsgsHttpAdapterConfig,
  type WsgsGroundingRequest,
} from "../../../packages/wsgs-http-adapter/src/index.js";
import {
  WorldGroundingRuntime,
  type WorldGroundingRuntimeOptions,
  type WorldGroundingControlTurn,
} from "../../../packages/world-grounding-runtime/src/index.js";
import {
  GroundingSourceAnalysisRuntime,
  type GroundingSourceRuntimeOptions,
} from "../../../packages/analysis-runtime/src/grounding-source-runtime.js";
import { createGroundingSourceAnalysisControl } from "../../../packages/analysis-control-runtime/src/grounding-source-control.js";
import { GroundingJobAnalysisSourceAdapter } from "../../../packages/wsgs-analysis-adapter/src/grounding-job.js";
import { createGroundingClientSelector } from "../../../packages/wsgs-analysis-adapter/src/contract-identity.js";
import type { GroundingAnalysisConfig } from "../../../packages/wsgs-analysis-adapter/src/config.js";
import type { AnalysisRepository } from "../../../packages/persistence/src/index.js";
import { planFrozenGroundingRequest } from "../../../packages/grounding-request-planner/src/frozen-request.js";
import { FrozenWorldAnalysisContract } from "../../../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  parseGroundingContractIdentity,
  sourceIsTerminal,
} from "../../../packages/analysis-contract/src/source.js";
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

type SourceControlOptions = Parameters<
  typeof createGroundingSourceAnalysisControl
>[0];
function clarificationText(code: string): string {
  switch (code) {
    case "SELECTION_EXPIRED":
      return "候选已过期，历史结果仍可查看；请重新查询后再选择。";
    case "SELECTION_AMBIGUOUS":
      return "当前有多个候选列表，请明确要选择的列表与候选。";
    case "SELECTION_CONTEXT_REQUIRED":
      return "当前没有可唯一确定的候选列表，请补充对象或先发起查询。";
    default:
      return "选择上下文不可用，请明确条件后重新查询。";
  }
}
/** Replace only external storage ports in local integration tests; production uses PostgreSQL. */
export interface V06GroundingPersistence {
  interactionRepository: WorldGroundingRuntimeOptions["requests"];
  groundingRepository: WorldGroundingRuntimeOptions["grounding"] &
    GroundingSourceRuntimeOptions["grounding"] &
    SourceControlOptions["grounding"];
  analysisRepository: GroundingSourceRuntimeOptions["analysis"] &
    SourceControlOptions["analysis"] &
    Pick<AnalysisRepository, "findCurrentGroundingAnalysis">;
  analysisDevelopmentRepository: SourceControlOptions["store"];
  worldFocusRepository?: WorldGroundingRuntimeOptions["worldFocus"];
  authorityFusionRepository?: WorldGroundingRuntimeOptions["authorityFusion"];
  worldExplanationRepository?: WorldGroundingRuntimeOptions["worldExplanations"];
  conversationRepository?: WorldGroundingRuntimeOptions["conversation"];
}

export function createV06GroundingAnalysis(input: {
  persistence: V06GroundingPersistence;
  config: GroundingAnalysisConfig;
  wsgsConfig: WsgsHttpAdapterConfig;
  sdarCompatibilityLock: unknown;
  now?: () => Date;
}) {
  const { persistence, config } = input;
  const now = input.now ?? (() => new Date());
  const clientForContract = createGroundingClientSelector(input.wsgsConfig);
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
    ...(persistence.worldFocusRepository
      ? { worldFocus: persistence.worldFocusRepository }
      : {}),
    ...(persistence.authorityFusionRepository
      ? { authorityFusion: persistence.authorityFusionRepository }
      : {}),
    ...(persistence.worldExplanationRepository
      ? { worldExplanations: persistence.worldExplanationRepository }
      : {}),
    ...(persistence.conversationRepository
      ? { conversation: persistence.conversationRepository }
      : {}),
    wsgs,
    clientForContract,
    sdarCompatibilityLock: input.sdarCompatibilityLock,
    sourcePolling: {
      pollIntervalMs: config.pollIntervalMs,
      maxDurationMs: config.maxWaitMs,
      maxConsecutiveFailures: config.maxConsecutivePollFailures,
    },
    ...(config.enabled
      ? {
          onSourceStarted: async (execution, owner) =>
            source.accept(execution, owner),
          awaitSourceCompletion: async (request) => source.complete(request),
          ...(config.contractVersion === "sacs-wsgs-grounding/1.2"
            ? {
                answerFrozenWorld: async (turn: WorldGroundingControlTurn) =>
                  answerFrozenTurn(turn),
                continueFrozenWorld: async (
                  turn: WorldGroundingControlTurn,
                ) => {
                  // Explicit references to published candidates must not fall through to SDAR routing.
                  if (
                    /(?:第(?:[一二三四五六七八九十]|[1-9][0-9]?)个|展开卡片|聚焦地图|排除暂停|改查|改为|重新查询|重查|历史.*(?:目标|返回)|(?:这个|该|此)(?:候选|位置|目标))/u.test(
                      turn.userText,
                    )
                  )
                    return answerFrozenTurn(turn);
                  if (
                    /(?:让|叫|请)?(?:无人车|车辆|车|机器人).*(?:返回|前往|驶向|开往|导航)|(?:返回|前往|驶向|开往|导航到)(?:那里|该处|此处)/u.test(
                      turn.userText,
                    )
                  ) {
                    const scope = {
                      principalId: turn.principalId,
                      threadId: turn.threadId,
                    };
                    const current =
                      await persistence.analysisRepository.findCurrentGroundingAnalysis(
                        scope,
                      );
                    if (
                      current?.revision.source?.kind === "WSGS_GROUNDING_JOB" &&
                      current.revision.source.contractIdentity
                        ?.contractVersion === "sacs-wsgs-grounding/1.2"
                    ) {
                      const execution =
                        await persistence.groundingRepository.get({
                          ...scope,
                          groundingId: current.groundingExecutionId,
                        });
                      if (
                        execution?.groundingResult &&
                        execution.analysisIntent?.["revisionId"] ===
                          current.revision.revisionId
                      ) {
                        const result = new FrozenWorldAnalysisContract().parse(
                          "result",
                          execution.groundingResult,
                        );
                        if (
                          result.groundingId !==
                            current.revision.source.sourceId ||
                          result.resultHash !== execution.groundingResultHash
                        )
                          throw Error("ANALYSIS_SOURCE_IDENTITY_INVALID");
                        if (
                          result.worldAnalysisFindings.choices.length > 0 ||
                          result.worldAnalysisFindings.findings.some(
                            (finding) =>
                              finding.findingKind === "ACTION_TARGET_CANDIDATE",
                          )
                        )
                          return "当前显示的是历史分析候选，不能直接用于车辆执行。请明确候选；这里只能继续只读分析，实际执行仍需当前验证、路线规划和执行确认。";
                      }
                    }
                  }
                  return undefined;
                },
              }
            : {}),
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
      now,
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
    clientForContract,
    world,
    now,
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
  type FrozenTurn = WorldGroundingControlTurn & {
    analysisId?: string;
    contextMode?: "CONTINUE" | "REPLACE";
    analysisSelections?: readonly unknown[];
  };
  type StartedTurn = {
    analysisId?: string;
    revisionId?: string;
    groundingExecutionId?: string;
    localText?: string;
    finish(text: string): Promise<void>;
  };
  async function startFrozenTurn(turn: FrozenTurn): Promise<StartedTurn> {
    const commandId =
      "source-" +
      hashCanonicalJson({
        principalId: turn.principalId,
        threadId: turn.threadId,
        protocol: turn.protocol,
        externalRequestId: turn.externalRequestId,
      }).slice(7);
    const contractIdentity = parseGroundingContractIdentity({
      contractVersion: config.contractVersion,
      resultProfile: config.resultProfile,
    });
    const requestHash = hashCanonicalJson({
      commandId,
      contractIdentity,
      text: turn.userText,
      analysisId: turn.analysisId ?? null,
      contextMode: turn.contextMode ?? "CONTINUE",
      analysisSelections: turn.analysisSelections ?? [],
    }).slice(7);
    const leaseOwner = "source-turn-" + randomUUID();
    const claim = await persistence.interactionRepository.claimRequest({
      protocol: turn.protocol,
      externalRequestId: commandId,
      principalId: turn.principalId,
      threadId: turn.threadId,
      requestHash,
      leaseOwner,
      leaseMs: 180000,
    });
    if (claim.outcome === "conflict")
      throw Error("ANALYSIS_SOURCE_REPLAY_CONFLICT");
    if (claim.outcome === "in_progress")
      return {
        localText: "WORLD_GROUNDING_IN_PROGRESS",
        finish: async () => undefined,
      };
    if (claim.outcome === "replay") {
      if (claim.result.kind !== "message")
        throw Error("ANALYSIS_SOURCE_REPLAY_CONFLICT");
      const saved = claim.result.message.parts.find(
        (part) => part.kind === "data",
      );
      const reference = z
        .object({
          analysisId: z.string().optional(),
          revisionId: z.string().optional(),
          groundingExecutionId: z.string().optional(),
        })
        .parse(saved?.kind === "data" ? saved.data : {});
      return {
        ...reference,
        localText: claim.result.renderedText,
        finish: async () => undefined,
      };
    }
    const createdAt =
      await persistence.interactionRepository.authorizedRequestCreatedAt({
        requestId: claim.requestId,
        principalId: turn.principalId,
        threadId: turn.threadId,
      });
    const started: StartedTurn = {
      finish: async (text) => {
        const messageId = "answer-" + commandId;
        await persistence.interactionRepository.completeRequest({
          requestId: claim.requestId,
          principalId: turn.principalId,
          leaseOwner,
          result: {
            kind: "message",
            messageId,
            renderedText: text,
            message: {
              messageId,
              role: "AGENT",
              parts: [
                { kind: "text", mediaType: "text/plain", text },
                {
                  kind: "data",
                  mediaType: "application/json",
                  data: {
                    ...(started.analysisId
                      ? { analysisId: started.analysisId }
                      : {}),
                    ...(started.revisionId
                      ? { revisionId: started.revisionId }
                      : {}),
                    ...(started.groundingExecutionId
                      ? { groundingExecutionId: started.groundingExecutionId }
                      : {}),
                  },
                },
              ],
            },
          },
        });
      },
    };
    const scope = { principalId: turn.principalId, threadId: turn.threadId };
    const initialId = "grounding-" + commandId;
    const existing = await persistence.groundingRepository.get({
      groundingId: initialId,
      ...scope,
    });
    if (existing?.canonicalRequest && existing.analysisIntent) {
      // A previous delivery may have reached WSGS before this observer disconnected.
      started.analysisId = String(existing.analysisIntent["analysisId"]);
      started.revisionId = String(existing.analysisIntent["revisionId"]);
      started.groundingExecutionId = existing.groundingId;
      await world.beginWorldGrounding({
        ...scope,
        analysisId: started.analysisId,
        revisionId: String(existing.analysisIntent["revisionId"]),
        groundingExecutionId: existing.groundingId,
        interactionRequestId: claim.requestId,
        leaseOwner,
        requestId: existing.wsgsRequestId,
        canonicalGroundingRequest: existing.canonicalRequest as Parameters<
          typeof world.beginWorldGrounding
        >[0]["canonicalGroundingRequest"],
        requestHash: "sha256:" + existing.requestHash,
        idempotencyKey: existing.idempotencyKey,
        analysisIntent: existing.analysisIntent,
        contractIdentity: parseGroundingContractIdentity(
          existing.analysisIntent["contractIdentity"],
        ),
        ...(turn.signal ? { signal: turn.signal } : {}),
      });
      return started;
    }
    const candidateCurrent = turn.analysisId
      ? await persistence.analysisRepository.getGroundingAnalysis({
          ...scope,
          analysisId: turn.analysisId,
        })
      : await persistence.analysisRepository.findCurrentGroundingAnalysis(
          scope,
        );
    if (turn.analysisId && !candidateCurrent) throw Error("ANALYSIS_NOT_FOUND");
    const savedIdentity =
      candidateCurrent?.revision.source?.kind === "WSGS_GROUNDING_JOB"
        ? parseGroundingContractIdentity(
            candidateCurrent.revision.source.contractIdentity,
          )
        : undefined;
    // A new configured protocol never relabels a prior Source or its selectors.
    if (
      turn.analysisId &&
      savedIdentity?.contractVersion !== config.contractVersion
    )
      throw Error("ANALYSIS_SOURCE_CONTRACT_IDENTITY_INVALID");
    const current =
      savedIdentity?.contractVersion === config.contractVersion
        ? candidateCurrent
        : undefined;
    if (current) {
      started.analysisId = current.session.analysisId;
      const result = z
        .union([
          z.object({
            groundingExecutionId: z.string(),
            analysisId: z.string(),
            revisionId: z.string(),
            status: z.literal("ACCEPTED"),
          }),
          z.object({
            kind: z.enum(["PRESENTATION", "CLARIFICATION"]),
            reasonCode: z.string().optional(),
          }),
        ])
        .parse(
          await analysisControl.continueSource(
            { ...scope, analysisId: current.session.analysisId },
            {
              kind: "GROUNDING_SOURCE_QUERY",
              commandId,
              idempotencyKey: commandId,
              expectedRevisionId: current.revision.revisionId,
              expectedRevisionNumber: current.revision.revisionNumber,
              originalText: turn.userText,
              contextMode: turn.contextMode ?? "CONTINUE",
              ...(turn.analysisSelections
                ? { analysisSelections: [...turn.analysisSelections] }
                : {}),
            },
          ),
        );
      if ("groundingExecutionId" in result) {
        started.groundingExecutionId = result.groundingExecutionId;
        started.revisionId = result.revisionId;
      } else
        started.localText = result.reasonCode
          ? clarificationText(result.reasonCode)
          : "已复用当前结果进行展示。";
      return started;
    }
    started.analysisId = "analysis-" + commandId;
    const planned = planFrozenGroundingRequest({
      ...scope,
      analysisId: started.analysisId,
      commandId,
      text: turn.userText,
      createdAt,
      now: () => now().getTime(),
      contextMode: turn.contextMode ?? "CONTINUE",
      ...(turn.analysisSelections
        ? { selections: turn.analysisSelections }
        : {}),
    });
    if (planned.kind !== "QUERY") {
      started.localText =
        planned.kind === "CLARIFICATION"
          ? clarificationText(planned.reasonCode)
          : "尚无可展示的分析结果。";
      return started;
    }
    started.groundingExecutionId = initialId;
    started.revisionId = "revision-" + commandId;
    await world.beginWorldGrounding({
      ...scope,
      analysisId: started.analysisId,
      revisionId: "revision-" + commandId,
      groundingExecutionId: initialId,
      interactionRequestId: claim.requestId,
      leaseOwner,
      requestId: planned.request.requestId,
      canonicalGroundingRequest: planned.request,
      requestHash: planned.requestHash,
      idempotencyKey: planned.idempotencyKey,
      contractIdentity: planned.contractIdentity,
      ...(turn.signal ? { signal: turn.signal } : {}),
    });
    return started;
  }
  async function answerFrozenTurn(turn: FrozenTurn): Promise<string> {
    const started = await startFrozenTurn(turn);
    if (started.localText !== undefined) {
      await started.finish(started.localText);
      return started.localText;
    }
    if (!started.analysisId || !started.groundingExecutionId)
      throw Error("ANALYSIS_NOT_FOUND");
    try {
      await activeSource.complete({
        groundingExecutionId: started.groundingExecutionId,
        principalId: turn.principalId,
        threadId: turn.threadId,
        ...(turn.signal ? { signal: turn.signal } : {}),
      });
    } catch (error) {
      turn.signal?.throwIfAborted();
      const execution = await persistence.groundingRepository.get({
        groundingId: started.groundingExecutionId,
        principalId: turn.principalId,
        threadId: turn.threadId,
      });
      // FAILED/CANCELLED jobs need not contain a Result. Their validated snapshot is still displayable.
      if (
        !execution?.lastSourceStatus ||
        !sourceIsTerminal(execution.lastSourceStatus) ||
        execution.groundingResult
      )
        throw error;
    }
    const projection = await activeSource.getProjection({
      analysisId: started.analysisId,
      principalId: turn.principalId,
      threadId: turn.threadId,
    });
    if (!projection) throw Error("ANALYSIS_NOT_FOUND");
    const state = parseAndVerifyAgUiSharedStateV03(projection.state);
    if (state.analysis.activeRevisionId !== started.revisionId)
      throw Error("ANALYSIS_REVISION_SUPERSEDED");
    const text = String(
      (
        state.worldExplanation?.["summary"] as
          { primaryText?: string } | undefined
      )?.primaryText ?? "世界分析结果已更新。",
    );
    await started.finish(text);
    return text;
  }
  const handler: AgUiRunHandler = async function* (context) {
    const directive = z
      .strictObject({
        mode: z.enum(["START", "RECONNECT"]).default("START"),
        analysisId: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u)
          .optional(),
        contextMode: z.enum(["CONTINUE", "REPLACE"]).optional(),
        analysisSelections: z.array(z.unknown()).max(8).optional(),
      })
      .parse(context.input.forwardedProps ?? {});
    const identity = {
      threadId: context.input.threadId,
      runId: context.input.runId,
    };
    let analysisId = directive.analysisId;
    let started: StartedTurn | undefined;
    if (
      directive.mode === "RECONNECT" &&
      (directive.contextMode || directive.analysisSelections)
    )
      throw Error("ANALYSIS_RECONNECT_MUTATION_FORBIDDEN");
    if (
      directive.mode === "START" &&
      config.contractVersion === "sacs-wsgs-grounding/1.2"
    ) {
      const user = context.input.messages
        .filter((message) => message.role === "user")
        .at(-1);
      started = await startFrozenTurn({
        protocol: "ag_ui",
        principalId: context.principalId,
        threadId: context.internalThreadId,
        externalRequestId: context.input.runId,
        userText: z.string().min(1).max(32768).parse(user?.content),
        signal: context.signal,
        ...(directive.analysisId ? { analysisId: directive.analysisId } : {}),
        ...(directive.contextMode
          ? { contextMode: directive.contextMode }
          : {}),
        ...(directive.analysisSelections
          ? { analysisSelections: directive.analysisSelections }
          : {}),
      });
      analysisId = started.analysisId;
      if (started.localText !== undefined) {
        await started.finish(started.localText);
        yield projectAnalysisRunStarted(identity);
        if (analysisId) {
          const saved = await activeSource.getProjection({
            analysisId,
            principalId: context.principalId,
            threadId: context.internalThreadId,
          });
          if (
            saved &&
            (!started.revisionId ||
              parseAndVerifyAgUiSharedStateV03(saved.state).analysis
                .activeRevisionId === started.revisionId)
          )
            yield projectAnalysisStateSnapshot({
              stateRevision: saved.stateRevision,
              state: saved.state,
            });
        }
        yield* projectAnalysisText({
          messageId: "answer-" + context.input.runId,
          text: started.localText,
        });
        yield projectAnalysisRunFinished(identity);
        return;
      }
    } else if (directive.mode === "START") {
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
    for await (const observation of activeSource.pump.observe(
      scope,
      context.signal,
    )) {
      if (context.signal.aborted) return;
      latest = observation.projection;
      if (
        started?.revisionId &&
        observation.snapshot.analysis.activeRevisionId !== started.revisionId
      )
        throw Error("ANALYSIS_REVISION_SUPERSEDED");
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
    if (context.signal.aborted) return;
    if (!latest) throw Error("ANALYSIS_NOT_FOUND");
    const state = parseAndVerifyAgUiSharedStateV03(latest.state);
    const run = Object.values(state.analysis.runsById).find(
      (value) => value.revisionId === state.analysis.activeRevisionId,
    );
    if (
      !run ||
      ![
        "SUCCEEDED",
        "PARTIAL",
        "FAILED",
        "CANCELLED",
        "WAITING_INTERVENTION",
      ].includes(run.status)
    )
      throw Error("ANALYSIS_SOURCE_OBSERVATION_LIMIT_EXCEEDED");
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
    await started?.finish(view?.summary?.primaryText ?? "世界分析结果已更新。");
    if (view?.status === "WAITING_SELECTION" && state.pendingIntervention)
      yield* projectAnalysisRunInterrupted({
        identity,
        stateRevision: latest.stateRevision,
        state: latest.state,
        activityMessageId: "activity-" + analysisId,
        activityRevision: latest.activityRevision,
        activity: latest.activity,
        interrupts: [
          {
            id: state.pendingIntervention.interruptId,
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
