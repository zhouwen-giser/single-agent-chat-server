import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AuthorityFusionEvaluator,
  AuthorityFusionRenderer,
  hashPlanRealityRequirements,
  PlanRealityRequirementCompiler,
  SdarTaskObservationAssembler,
  type AuthorityFusionResultV2,
} from "../../authority-fusion/src/index.js";
import { planGroundingRequest } from "../../grounding-request-planner/src/index.js";
import {
  GroundingContextAssembler,
  isDeterministicChoiceControl,
  PendingChoiceResolver,
  WorldFocusUpdater,
  type GroundingContextAssembly,
  type ContextReadyWorldReference,
  type PendingGroundingChoice,
  type WorldFocusRepository,
} from "../../conversation-world-focus/src/index.js";
import type {
  AuthorityFusionRepository,
  ConversationPersistenceRepository,
  GroundingPersistenceRepository,
  InteractionPersistenceRepository,
  JsonValue,
} from "../../persistence/src/index.js";
import type { NormalizedTask } from "../../sdar-a2a-adapter/src/index.js";
import type { CompletedRequestResult } from "../../request-result/src/index.js";
import {
  parseWsgsGroundingResult,
  WsgsHttpError,
  type WsgsGroundingJob,
  type WsgsGroundingContextCapsule,
  type WsgsGroundingRequest,
  type WsgsGroundingResult,
  type WsgsHttpClient,
} from "../../wsgs-http-adapter/src/index.js";
import {
  parseHybridPlanRealityCompare,
  parseGroundingRequestPlan,
  parseOperationalGroundingBundle,
  parseTurnPlan,
  type HybridPlanRealityCompare,
  type GroundingRequestPlan,
  type OperationalGroundingBundle,
  type TurnPlan,
} from "../../world-grounding-contract/src/index.js";

const sdarPublishedPlanSnapshotSchema = z.strictObject({
  taskId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  observedStatus: z.literal("INPUT_REQUIRED"),
  internalPhase: z.literal("awaiting_plan_confirmation"),
  publishedSummary: z.string().min(1).max(8_000),
});

const compatibilityLockSchema = z
  .object({
    profile: z.literal("sacs-sdar-operational-grounding/1.0"),
    status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
    dataPartMediaType: z.string().min(1).max(256).nullable(),
    schemaSha256: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/u)
      .nullable(),
    handlerEvidence: z.unknown().nullable(),
    validatorEvidence: z.unknown().nullable(),
    realE2eEvidence: z.unknown().nullable(),
    requiredRuntimeError: z.literal("SDAR_GROUNDING_EXTENSION_UNAVAILABLE"),
    fallback: z.object({
      dropDataPart: z.literal(false),
      convertToText: z.literal(false),
      modifySdar: z.literal(false),
    }),
  })
  .passthrough();

export type SdarGroundingCompatibilityLock = z.infer<
  typeof compatibilityLockSchema
>;

export const worldGroundingRuntimeCodes = [
  "WORLD_GROUNDING_IN_PROGRESS",
  "WORLD_GROUNDING_CONTEXT_UNAVAILABLE",
  "WORLD_GROUNDING_CAPABILITY_UNAVAILABLE",
  "WORLD_GROUNDING_CONTRACT_VIOLATION",
  "WORLD_GROUNDING_FAILED",
  "AUTHORITY_FUSION_PREVIEW_UNAVAILABLE",
  "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
] as const;

export type WorldGroundingRuntimeCode =
  (typeof worldGroundingRuntimeCodes)[number];

export class WorldGroundingRuntimeError extends Error {
  constructor(readonly code: WorldGroundingRuntimeCode) {
    super(code);
    this.name = "WorldGroundingRuntimeError";
  }
}

export interface WorldGroundingRuntimeTurn {
  readonly protocol: "openai" | "ag_ui";
  readonly principalId: string;
  readonly threadId: string;
  readonly externalRequestId: string;
  readonly userText: string;
  readonly turnPlan: TurnPlan;
  readonly signal?: AbortSignal;
}

export type WorldGroundingControlTurn = Omit<
  WorldGroundingRuntimeTurn,
  "turnPlan"
>;

export type SdarPublishedPlanSnapshot = z.infer<
  typeof sdarPublishedPlanSnapshotSchema
>;

export interface HybridGroundingRuntimeTurn extends WorldGroundingRuntimeTurn {
  readonly sdarTask?: NormalizedTask;
  readonly sdarPlan?: SdarPublishedPlanSnapshot;
}

export interface WorldGroundingRuntimeOptions {
  readonly requests: Pick<
    InteractionPersistenceRepository,
    "claimRequest" | "completeRequest" | "authorizedRequestCreatedAt"
  >;
  readonly grounding: Pick<
    GroundingPersistenceRepository,
    "claim" | "recordGroundingReady" | "complete" | "fail" | "cancel"
  > &
    Partial<Pick<GroundingPersistenceRepository, "get">>;
  readonly worldFocus?: WorldFocusRepository;
  readonly authorityFusion?: Pick<
    AuthorityFusionRepository,
    "findExact" | "saveOrReplay"
  >;
  readonly conversation?: Pick<
    ConversationPersistenceRepository,
    "loadMessageByExternalId"
  >;
  readonly wsgs: WsgsHttpClient;
  readonly sdarCompatibilityLock: unknown;
  readonly nextLeaseOwner?: () => string;
  readonly requestPlanner?: (turnPlan: TurnPlan) => GroundingRequestPlan;
}

interface ReadOnlyGroundingOverrides {
  readonly requestPlan?: ReturnType<typeof planGroundingRequest>;
  readonly context?: GroundingContextAssembly;
  readonly source?: {
    readonly messageId: string;
    readonly originalText: string;
  };
  readonly originMessageId?: string;
  readonly skipFocusUpdate?: boolean;
}

export class WorldGroundingRuntime {
  private readonly lock: SdarGroundingCompatibilityLock;
  private readonly nextLeaseOwner: () => string;
  private readonly contextAssembler?: GroundingContextAssembler;
  private readonly focusUpdater?: WorldFocusUpdater;
  private readonly pendingChoiceResolver = new PendingChoiceResolver();

  constructor(private readonly options: WorldGroundingRuntimeOptions) {
    this.lock = compatibilityLockSchema.parse(options.sdarCompatibilityLock);
    this.nextLeaseOwner = options.nextLeaseOwner ?? randomUUID;
    this.contextAssembler =
      options.worldFocus === undefined
        ? undefined
        : new GroundingContextAssembler(options.worldFocus);
    this.focusUpdater =
      options.worldFocus === undefined
        ? undefined
        : new WorldFocusUpdater(options.worldFocus);
  }

  async answerWorld(input: WorldGroundingRuntimeTurn): Promise<string> {
    const turnPlan = parseTurnPlan(input.turnPlan);
    if (turnPlan.turnRoute !== "WORLD_ANSWER") {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTRACT_VIOLATION",
      );
    }
    const revalidationFailure = await this.revalidateWorldFocus(
      input,
      turnPlan,
    );
    if (revalidationFailure !== undefined) return revalidationFailure;
    return (
      await this.executeReadOnlyGrounding(
        input,
        turnPlan,
        undefined,
        (result) => renderSafeWorldAnswer(result),
      )
    ).text;
  }

  async compareHybrid(input: HybridGroundingRuntimeTurn): Promise<string> {
    const turnPlan = parseTurnPlan(input.turnPlan);
    if (turnPlan.turnRoute !== "HYBRID_PLAN_REALITY_COMPARE") {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTRACT_VIOLATION",
      );
    }
    if (input.sdarTask === undefined) {
      const sdarPlan = sdarPublishedPlanSnapshotSchema.parse(input.sdarPlan);
      const revalidationFailure = await this.revalidateWorldFocus(
        input,
        turnPlan,
      );
      if (revalidationFailure !== undefined) return revalidationFailure;
      return (
        await this.executeReadOnlyGrounding(
          input,
          turnPlan,
          asJsonValue({ sdarPlan }),
          (result, observedAt) =>
            renderHybridAuthorityFusion(result, sdarPlan, observedAt),
        )
      ).text;
    }
    if (
      this.options.worldFocus === undefined ||
      this.contextAssembler === undefined
    ) {
      return "AUTHORITY_FUSION_PREVIEW_UNAVAILABLE";
    }
    const task = new SdarTaskObservationAssembler().assemble(input.sdarTask);
    const focus = await this.options.worldFocus.getFocus({
      principalId: input.principalId,
      threadId: input.threadId,
    });
    const requirements = new PlanRealityRequirementCompiler().compile(
      task,
      focus,
    );
    if (requirements.comparability === "NOT_COMPARABLE") {
      return "AUTHORITY_FUSION_NOT_COMPARABLE";
    }
    const requirementHash = hashPlanRealityRequirements(requirements);
    if (
      this.options.authorityFusion !== undefined &&
      focus.lastGroundingResultHash !== undefined
    ) {
      const replay = await this.options.authorityFusion.findExact({
        principalId: input.principalId,
        threadId: input.threadId,
        taskId: task.taskId,
        taskSnapshotHash: requirements.taskSnapshotHash,
        requirementHash,
        groundingResultHash: focus.lastGroundingResultHash,
      });
      if (replay !== undefined) {
        return renderAuthorityFusionV2(replay.result);
      }
    }
    const fusionTurnPlan = parseTurnPlan({
      ...turnPlan,
      worldFocusUsage: {
        ...turnPlan.worldFocusUsage,
        externalCorrelationHints: requirements.correlationHints.length > 0,
        externalPredicates: requirements.predicates.length > 0,
      },
    });
    const revalidationFailure = await this.revalidateWorldFocus(
      input,
      fusionTurnPlan,
    );
    if (revalidationFailure !== undefined) return revalidationFailure;
    const context = await this.contextAssembler.assemble({
      principalId: input.principalId,
      threadId: input.threadId,
      turnPlan: fusionTurnPlan,
      fusionRequirements: requirements,
    });
    return (
      await this.executeReadOnlyGrounding(
        { ...input, turnPlan: fusionTurnPlan },
        fusionTurnPlan,
        asJsonValue({
          taskSnapshotHash: requirements.taskSnapshotHash,
          requirementHash,
        }),
        async (result, observedAt) => {
          if (result.status === "AMBIGUOUS") {
            return renderSafeWorldAnswer(result);
          }
          if (!["COMPLETED", "PARTIAL"].includes(result.status)) {
            return "AUTHORITY_FUSION_PREVIEW_UNAVAILABLE";
          }
          const fusion = new AuthorityFusionEvaluator({
            now: () => new Date(observedAt),
          }).evaluate({ task, requirements, grounding: result });
          if (this.options.authorityFusion !== undefined) {
            await this.options.authorityFusion.saveOrReplay({
              principalId: input.principalId,
              threadId: input.threadId,
              taskId: task.taskId,
              taskSnapshotHash: requirements.taskSnapshotHash,
              requirementHash,
              groundingId: result.groundingId,
              groundingResultHash: result.resultHash,
              result: fusion,
            });
          }
          return renderAuthorityFusionV2(fusion);
        },
        { context },
      )
    ).text;
  }

  async continuePendingChoice(
    input: WorldGroundingControlTurn,
  ): Promise<string | undefined> {
    if (
      this.options.worldFocus === undefined ||
      this.options.conversation === undefined ||
      this.options.grounding.get === undefined ||
      this.contextAssembler === undefined
    ) {
      return undefined;
    }
    const choice = await this.options.worldFocus.getOpenChoice({
      principalId: input.principalId,
      threadId: input.threadId,
    });
    if (choice === undefined) {
      return isDeterministicChoiceControl(input.userText)
        ? "WORLD_GROUNDING_NO_PENDING_CHOICE"
        : undefined;
    }
    const resolution = this.pendingChoiceResolver.resolve(
      input.userText,
      choice,
    );
    if (resolution.kind === "CLARIFY") {
      return renderPendingChoiceClarification(choice, resolution.reason);
    }
    const selected = await this.options.worldFocus.selectChoice({
      principalId: input.principalId,
      threadId: input.threadId,
      choiceId: choice.choiceId,
      selectedProductId: resolution.candidate.productId,
    });
    const origin = await this.options.conversation.loadMessageByExternalId({
      principalId: input.principalId,
      threadId: input.threadId,
      externalMessageId: selected.originMessageId,
      role: "user",
    });
    const originExecution = await this.options.grounding.get({
      groundingId: selected.originGroundingId,
      principalId: input.principalId,
      threadId: input.threadId,
    });
    if (
      origin === undefined ||
      originExecution?.groundingResult === undefined
    ) {
      return "WORLD_GROUNDING_CONTINUATION_SOURCE_UNAVAILABLE";
    }
    const originResult = parseWsgsGroundingResult(
      originExecution.groundingResult,
    );
    const selectedProduct = originResult.referenceProducts.find(
      ({ productId }) => productId === resolution.candidate.productId,
    );
    if (selectedProduct === undefined) {
      return "WORLD_GROUNDING_CONTINUATION_SOURCE_UNAVAILABLE";
    }
    const originTurnPlan = parseTurnPlan(selected.originTurnPlan);
    const originRequestPlan = parseGroundingRequestPlan(
      selected.originRequestPlan,
    );
    const continuationReference = {
      alias: selectedProduct.displayName,
      referenceKey: selectedProduct.referenceKey,
      referenceType: selectedProduct.referenceType,
      sourceMessageId: selected.originMessageId,
      sourceGroundingId: originResult.groundingId,
      ...(selectedProduct.validUntil === undefined
        ? {}
        : { validUntil: selectedProduct.validUntil }),
    };
    const validationTurnPlan = parseTurnPlan({
      ...originTurnPlan,
      worldFocusUsage: {
        ...originTurnPlan.worldFocusUsage,
        knownWorldReferences: true,
      },
    });
    const validationPlan = parseGroundingRequestPlan({
      ...originRequestPlan,
      operation: "VALIDATE_REFERENCES",
      requestedProducts: ["RESOLVED_REFERENCES"],
      contextUsage: validationTurnPlan.worldFocusUsage,
    });
    const validationContext = await this.contextAssembler.assemble({
      principalId: input.principalId,
      threadId: input.threadId,
      turnPlan: validationTurnPlan,
      continuationReferences: [continuationReference],
    });
    const validation = await this.executeReadOnlyGrounding(
      { ...input, turnPlan: validationTurnPlan },
      validationTurnPlan,
      asJsonValue({
        choiceId: selected.choiceId,
        stage: "VALIDATE_REFERENCES",
      }),
      () => "WORLD_GROUNDING_REFERENCE_VALIDATED",
      {
        requestPlan: validationPlan,
        context: validationContext,
        source: {
          messageId: selected.originMessageId,
          originalText: origin.contentText,
        },
        originMessageId: selected.originMessageId,
      },
    );
    if (validation.result?.status !== "COMPLETED") {
      return "WORLD_GROUNDING_REFERENCE_VALIDATION_FAILED";
    }
    const validatedProduct =
      validation.result.referenceProducts.find(
        ({ productId }) => productId === resolution.candidate.productId,
      ) ?? selectedProduct;
    const validatedReference = {
      alias: validatedProduct.displayName,
      referenceKey: validatedProduct.referenceKey,
      referenceType: validatedProduct.referenceType,
      sourceMessageId: selected.originMessageId,
      sourceGroundingId: validation.result.groundingId,
      ...(validatedProduct.validUntil === undefined
        ? {}
        : { validUntil: validatedProduct.validUntil }),
    };
    const resumeTurnPlan = parseTurnPlan({
      ...originTurnPlan,
      worldFocusUsage: {
        ...originTurnPlan.worldFocusUsage,
        knownWorldReferences: true,
      },
    });
    const resumePlan = parseGroundingRequestPlan({
      ...originRequestPlan,
      contextUsage: resumeTurnPlan.worldFocusUsage,
    });
    const resumeContext = await this.contextAssembler.assemble({
      principalId: input.principalId,
      threadId: input.threadId,
      turnPlan: resumeTurnPlan,
      continuationReferences: [validatedReference],
    });
    return (
      await this.executeReadOnlyGrounding(
        { ...input, turnPlan: resumeTurnPlan },
        resumeTurnPlan,
        asJsonValue({
          choiceId: selected.choiceId,
          stage: "RESUME_ORIGIN_QUERY",
        }),
        (result) => renderSafeWorldAnswer(result),
        {
          requestPlan: resumePlan,
          context: resumeContext,
          source: {
            messageId: selected.originMessageId,
            originalText: origin.contentText,
          },
          originMessageId: selected.originMessageId,
        },
      )
    ).text;
  }

  private async executeReadOnlyGrounding(
    input: WorldGroundingRuntimeTurn,
    turnPlan: TurnPlan,
    hashExtension: JsonValue | undefined,
    renderResult: (
      result: WsgsGroundingResult,
      observedAt: string,
    ) => string | Promise<string>,
    overrides: ReadOnlyGroundingOverrides = {},
  ): Promise<{ readonly text: string; readonly result?: WsgsGroundingResult }> {
    const plan =
      overrides.requestPlan ??
      parseGroundingRequestPlan(
        (this.options.requestPlanner ?? planGroundingRequest)(turnPlan),
      );
    let context: GroundingContextAssembly;
    try {
      context =
        overrides.context ?? (await this.assembleContext(input, turnPlan));
    } catch (error) {
      if (error instanceof WorldGroundingRuntimeError) {
        return { text: error.code };
      }
      throw error;
    }
    const stableHash = stableTurnHash(
      input,
      turnPlan,
      asJsonValue({
        ...(hashExtension === undefined ? {} : { hashExtension }),
        ...(overrides.source === undefined ? {} : { source: overrides.source }),
      }),
    );
    const groundingId = `grounding-` + stableHash;
    const leaseOwner = this.nextLeaseOwner();
    const outerClaim = await this.options.requests.claimRequest({
      protocol: input.protocol,
      externalRequestId: `wg-` + stableHash,
      principalId: input.principalId,
      threadId: input.threadId,
      requestHash: stableHash,
      leaseOwner,
      leaseMs: 180_000,
    });
    if (outerClaim.outcome === "conflict") {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTRACT_VIOLATION",
      );
    }
    if (outerClaim.outcome === "in_progress") {
      return { text: "WORLD_GROUNDING_IN_PROGRESS" };
    }
    if (outerClaim.outcome === "replay") {
      if (outerClaim.result.kind !== "message") {
        throw new WorldGroundingRuntimeError(
          "WORLD_GROUNDING_CONTRACT_VIOLATION",
        );
      }
      const execution = await this.options.grounding.get?.({
        groundingId,
        principalId: input.principalId,
        threadId: input.threadId,
      });
      const result =
        execution?.groundingResult === undefined
          ? undefined
          : parseWsgsGroundingResult(execution.groundingResult);
      return {
        text: outerClaim.result.renderedText,
        ...(result === undefined ? {} : { result }),
      };
    }

    const requestCreatedAt =
      await this.options.requests.authorizedRequestCreatedAt({
        requestId: outerClaim.requestId,
        principalId: input.principalId,
        threadId: input.threadId,
      });
    const wsgsRequestId = `wsgs-` + stableHash;
    const request = createWsgsRequest({
      input,
      plan,
      requestId: wsgsRequestId,
      createdAt: requestCreatedAt,
      contextCapsule: context.contextCapsule,
      ...(overrides.source === undefined ? {} : { source: overrides.source }),
    });
    const groundingClaim = await this.options.grounding.claim({
      groundingId,
      principalId: input.principalId,
      threadId: input.threadId,
      interactionRequestId: outerClaim.requestId,
      wsgsRequestId,
      idempotencyKey: `wsgs-grounding-` + stableHash,
      requestHash: hashJsonValue(request),
      wsgsOperation: plan.operation,
      requestedProducts: plan.requestedProducts,
      contextUsage: turnPlan.worldFocusUsage,
      leaseOwner,
      leaseMs: 180_000,
    });
    if (groundingClaim.kind === "BUSY") {
      return { text: "WORLD_GROUNDING_IN_PROGRESS" };
    }

    let response: string | undefined;
    let resultForOutcome: WsgsGroundingResult | undefined;
    try {
      let result: WsgsGroundingResult | undefined;
      if (groundingClaim.kind === "REPLAY") {
        if (groundingClaim.execution.groundingResult === undefined) {
          response = terminalFailureText(
            groundingClaim.execution.failureCode ?? "WORLD_GROUNDING_FAILED",
          );
        } else {
          result = parseWsgsGroundingResult(
            groundingClaim.execution.groundingResult,
          );
        }
      } else {
        const capabilities = await this.options.wsgs.capabilities(input.signal);
        if (!capabilities.requiredCapabilitiesReady) {
          throw new WorldGroundingRuntimeError(
            "WORLD_GROUNDING_CAPABILITY_UNAVAILABLE",
          );
        }
        result = await resolveGroundingResult(
          this.options.wsgs,
          request,
          `wsgs-grounding-` + stableHash,
          input.signal,
        );
        assertResultIdentity(result, request);
        await this.options.grounding.recordGroundingReady({
          groundingId,
          principalId: input.principalId,
          threadId: input.threadId,
          leaseOwner,
          wsgsGroundingId: result.groundingId,
          resultHash: result.resultHash,
          result: asJsonValue(result),
        });
        if (result.status === "CANCELLED") {
          await this.options.grounding.cancel({
            groundingId,
            principalId: input.principalId,
            threadId: input.threadId,
          });
        } else if (!["COMPLETED", "PARTIAL"].includes(result.status)) {
          await this.options.grounding.fail({
            groundingId,
            principalId: input.principalId,
            threadId: input.threadId,
            failureCode: `WSGS_` + result.status,
          });
        }
      }

      if (result !== undefined) {
        resultForOutcome = result;
        if (overrides.skipFocusUpdate !== true) {
          await this.updateWorldFocus({
            input,
            turnPlan,
            requestPlan: plan,
            groundingExecutionId: groundingId,
            result,
            originMessageId:
              overrides.originMessageId ?? input.externalRequestId,
          });
        }
        response = await renderResult(result, requestCreatedAt);
        if (
          ["COMPLETED", "PARTIAL"].includes(result.status) &&
          groundingClaim.execution.state !== "COMPLETED"
        ) {
          await this.options.grounding.complete({
            groundingId,
            principalId: input.principalId,
            threadId: input.threadId,
          });
        }
      }
    } catch (error) {
      const code = safeRuntimeCode(error);
      if (code === undefined) throw error;
      await this.options.grounding
        .fail({
          groundingId,
          principalId: input.principalId,
          threadId: input.threadId,
          failureCode: code,
        })
        .catch(() => undefined);
      response = terminalFailureText(code);
    }
    if (response === undefined) {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTRACT_VIOLATION",
      );
    }
    await this.completeOuterRequest(
      outerClaim.requestId,
      input,
      leaseOwner,
      stableHash,
      response,
    );
    return {
      text: response,
      ...(resultForOutcome === undefined ? {} : { result: resultForOutcome }),
    };
  }

  private async assembleContext(
    input: WorldGroundingRuntimeTurn,
    turnPlan: TurnPlan,
  ): Promise<GroundingContextAssembly> {
    if (this.contextAssembler === undefined) {
      if (Object.values(turnPlan.worldFocusUsage).some(Boolean)) {
        throw new WorldGroundingRuntimeError(
          "WORLD_GROUNDING_CONTEXT_UNAVAILABLE",
        );
      }
      return {
        schemaVersion: "1.0",
        focusRevision: 0,
        contextCapsule: {
          knownWorldReferences: [],
          priorGroundings: [],
          mapSelections: [],
          externalCorrelationHints: [],
          externalPredicates: [],
        },
        source: "EMPTY",
      };
    }
    const assembled = await this.contextAssembler.assemble({
      principalId: input.principalId,
      threadId: input.threadId,
      turnPlan,
    });
    const usage = turnPlan.worldFocusUsage;
    const capsule = assembled.contextCapsule;
    if (
      (usage.knownWorldReferences &&
        capsule.knownWorldReferences.length === 0) ||
      (usage.priorGrounding && capsule.priorGroundings.length === 0) ||
      (usage.mapSelections && capsule.mapSelections.length === 0) ||
      (usage.externalCorrelationHints &&
        capsule.externalCorrelationHints.length === 0) ||
      (usage.externalPredicates && capsule.externalPredicates.length === 0)
    ) {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTEXT_UNAVAILABLE",
      );
    }
    return assembled;
  }

  private async revalidateWorldFocus(
    input: WorldGroundingRuntimeTurn,
    turnPlan: TurnPlan,
  ): Promise<string | undefined> {
    if (
      !turnPlan.worldFocusUsage.knownWorldReferences ||
      this.options.worldFocus === undefined ||
      this.contextAssembler === undefined
    ) {
      return undefined;
    }
    const usable = await this.options.worldFocus.listUsableReferences({
      principalId: input.principalId,
      threadId: input.threadId,
      limit: 64,
    });
    if (usable.length > 0) return undefined;
    const stale =
      await this.options.worldFocus.listReferencesRequiringValidation({
        principalId: input.principalId,
        threadId: input.threadId,
        limit: 64,
      });
    if (stale.length === 0) return undefined;
    const validationTurnPlan = parseTurnPlan({
      ...turnPlan,
      worldFocusUsage: {
        knownWorldReferences: true,
        priorGrounding: false,
        mapSelections: false,
        externalCorrelationHints: false,
        externalPredicates: false,
      },
    });
    const validationPlan = parseGroundingRequestPlan({
      ...parseGroundingRequestPlan(
        (this.options.requestPlanner ?? planGroundingRequest)(
          validationTurnPlan,
        ),
      ),
      operation: "VALIDATE_REFERENCES",
      requestedProducts: ["RESOLVED_REFERENCES"],
    });
    const validationContext = await this.contextAssembler.assemble({
      principalId: input.principalId,
      threadId: input.threadId,
      turnPlan: validationTurnPlan,
      continuationReferences: stale.map(toKnownWorldReference),
    });
    const validation = await this.executeReadOnlyGrounding(
      { ...input, turnPlan: validationTurnPlan },
      validationTurnPlan,
      asJsonValue({
        referenceIdentityHashes: stale.map(
          ({ focusReference }) => focusReference.referenceIdentityHash,
        ),
        stage: "REVALIDATE_WORLD_FOCUS",
      }),
      () => "WORLD_GROUNDING_REFERENCE_VALIDATED",
      {
        requestPlan: validationPlan,
        context: validationContext,
        originMessageId: input.externalRequestId,
      },
    );
    return validation.result?.status === "COMPLETED"
      ? undefined
      : "WORLD_GROUNDING_REFERENCE_VALIDATION_FAILED";
  }

  private async updateWorldFocus(input: {
    readonly input: WorldGroundingRuntimeTurn;
    readonly turnPlan: TurnPlan;
    readonly requestPlan: ReturnType<typeof planGroundingRequest>;
    readonly groundingExecutionId: string;
    readonly result: WsgsGroundingResult;
    readonly originMessageId: string;
  }): Promise<void> {
    if (this.focusUpdater === undefined) return;
    await this.focusUpdater.apply({
      principalId: input.input.principalId,
      threadId: input.input.threadId,
      groundingExecutionId: input.groundingExecutionId,
      originMessageId: input.originMessageId,
      turnPlan: input.turnPlan,
      requestPlan: input.requestPlan,
      result: input.result,
    });
  }

  async submitOperational(input: WorldGroundingRuntimeTurn): Promise<string> {
    const turnPlan = parseTurnPlan(input.turnPlan);
    if (
      turnPlan.turnRoute !== "SDAR_TASK" ||
      turnPlan.groundingRequirement === "NONE"
    ) {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTRACT_VIOLATION",
      );
    }
    try {
      assertSdarGroundingExtensionAvailable(this.lock);
    } catch (error) {
      if (
        error instanceof WorldGroundingRuntimeError &&
        error.code === "SDAR_GROUNDING_EXTENSION_UNAVAILABLE"
      ) {
        return error.code;
      }
      throw error;
    }
    throw new WorldGroundingRuntimeError(
      "WORLD_GROUNDING_CAPABILITY_UNAVAILABLE",
    );
  }

  private async completeOuterRequest(
    requestId: string,
    input: WorldGroundingRuntimeTurn,
    leaseOwner: string,
    stableHash: string,
    response: string,
  ): Promise<void> {
    await this.options.requests.completeRequest({
      requestId,
      principalId: input.principalId,
      leaseOwner,
      result: messageResult(stableHash, response),
    });
  }
}

export function assertSdarGroundingExtensionAvailable(
  value: unknown,
): asserts value is SdarGroundingCompatibilityLock {
  const lock = compatibilityLockSchema.parse(value);
  if (
    lock.status !== "AVAILABLE" ||
    lock.dataPartMediaType === null ||
    lock.schemaSha256 === null ||
    lock.handlerEvidence === null ||
    lock.validatorEvidence === null ||
    lock.realE2eEvidence === null
  ) {
    throw new WorldGroundingRuntimeError(
      "SDAR_GROUNDING_EXTENSION_UNAVAILABLE",
    );
  }
}

export function buildOperationalGroundingBundle(input: {
  readonly validationResult: WsgsGroundingResult;
  readonly selectedProductIds: readonly string[];
  readonly explicitlyConfirmedProductIds: readonly string[];
  readonly validatedAt: string;
  readonly createdAt: string;
}): OperationalGroundingBundle {
  const result = parseWsgsGroundingResult(input.validationResult);
  if (
    result.status !== "COMPLETED" ||
    result.unresolvedMentions.length > 0 ||
    result.capabilityGaps.length > 0
  ) {
    throw new WorldGroundingRuntimeError("WORLD_GROUNDING_CONTRACT_VIOLATION");
  }
  const selected = new Set(input.selectedProductIds);
  const confirmed = new Set(input.explicitlyConfirmedProductIds);
  if (
    selected.size === 0 ||
    selected.size !== input.selectedProductIds.length
  ) {
    throw new WorldGroundingRuntimeError("WORLD_GROUNDING_CONTRACT_VIOLATION");
  }
  const ambiguousProductIds = new Set(
    result.ambiguities.flatMap(({ candidateProductIds }) =>
      candidateProductIds.filter((productId) => selected.has(productId)),
    ),
  );
  for (const productId of ambiguousProductIds) {
    if (!confirmed.has(productId)) {
      throw new WorldGroundingRuntimeError(
        "WORLD_GROUNDING_CONTRACT_VIOLATION",
      );
    }
  }
  const products = result.referenceProducts.filter(({ productId }) =>
    selected.has(productId),
  );
  if (products.length !== selected.size) {
    throw new WorldGroundingRuntimeError("WORLD_GROUNDING_CONTRACT_VIOLATION");
  }
  return parseOperationalGroundingBundle({
    schemaVersion: "1.0",
    purpose: "SDAR_OPERATION",
    groundingId: result.groundingId,
    groundingResultHash: result.resultHash,
    references: products.map((product) => {
      if (
        product.sourceOperation !== "VALIDATE_REFERENCES" ||
        product.validUntil === undefined ||
        product.revalidationRequired !== false
      ) {
        throw new WorldGroundingRuntimeError(
          "WORLD_GROUNDING_CONTRACT_VIOLATION",
        );
      }
      return {
        productId: product.productId,
        referenceKey: product.referenceKey,
        sourceWorldVersion: product.sourceWorldVersion,
        validUntil: product.validUntil,
        revalidationRequired: false,
        validationStatus: "VALIDATED",
        confirmationStatus: ambiguousProductIds.has(product.productId)
          ? "EXPLICITLY_CONFIRMED"
          : "NOT_REQUIRED",
      };
    }),
    evidenceItemIds: result.evidenceItems.map(
      ({ evidenceProductId }) => evidenceProductId,
    ),
    ambiguityPolicy: {
      outcome:
        ambiguousProductIds.size > 0 ? "EXPLICITLY_CONFIRMED" : "NO_AMBIGUITY",
      autoAcceptSuggestedUnique: false,
    },
    validation: {
      authority: "WSGS",
      operation: "VALIDATE_REFERENCES",
      validatedAt: input.validatedAt,
      validationResultHash: result.resultHash,
    },
    createdAt: input.createdAt,
  });
}

export function buildHybridAuthorityFusion(input: {
  readonly result: WsgsGroundingResult;
  readonly sdarPlan: SdarPublishedPlanSnapshot;
  readonly observedAt: string;
}): HybridPlanRealityCompare {
  const result = parseWsgsGroundingResult(input.result);
  const sdarPlan = sdarPublishedPlanSnapshotSchema.parse(input.sdarPlan);
  const worldVersions = new Set(
    result.referenceProducts.map(
      ({ sourceWorldVersion }) => sourceWorldVersion,
    ),
  );
  if (
    result.status !== "COMPLETED" ||
    result.ambiguities.length > 0 ||
    result.unresolvedMentions.length > 0 ||
    result.capabilityGaps.length > 0 ||
    result.referenceProducts.length === 0 ||
    result.evidenceItems.length === 0 ||
    result.evidenceItems.some(
      ({ upstreamStatus }) => upstreamStatus !== "COMPLETED",
    ) ||
    worldVersions.size !== 1
  ) {
    throw new WorldGroundingRuntimeError(
      "AUTHORITY_FUSION_PREVIEW_UNAVAILABLE",
    );
  }
  const sourceWorldVersion = [...worldVersions][0];
  if (sourceWorldVersion === undefined) {
    throw new WorldGroundingRuntimeError(
      "AUTHORITY_FUSION_PREVIEW_UNAVAILABLE",
    );
  }
  const publishedSummary = safeText(sdarPlan.publishedSummary).slice(0, 8_000);
  if (publishedSummary.length === 0) {
    throw new WorldGroundingRuntimeError(
      "AUTHORITY_FUSION_PREVIEW_UNAVAILABLE",
    );
  }
  return parseHybridPlanRealityCompare({
    schemaVersion: "1.0",
    mode: "HYBRID_PLAN_REALITY_COMPARE",
    generatedAt: input.observedAt,
    plan: {
      authority: "SDAR",
      taskId: sdarPlan.taskId,
      observedStatus: sdarPlan.observedStatus,
      publishedSummary,
      observedAt: input.observedAt,
    },
    reality: {
      authority: "WSGS_GOWM",
      groundingId: result.groundingId,
      resultHash: result.resultHash,
      sourceWorldVersion,
      evidenceItemIds: [
        ...new Set(
          result.evidenceItems.map(
            ({ evidenceProductId }) => evidenceProductId,
          ),
        ),
      ],
      observedAt: input.observedAt,
    },
    composition: {
      authority: "SACS",
      relationship: "COMPARE_ONLY",
      summary:
        "SACS read one published SDAR plan snapshot and one completed WSGS/GOWM reality snapshot. This preview does not infer equivalence, contradiction, execution outcome, or authority changes.",
      differences: [],
    },
  });
}

export function renderHybridAuthorityFusion(
  result: WsgsGroundingResult,
  sdarPlan: SdarPublishedPlanSnapshot,
  observedAt: string,
): string {
  const comparison = buildHybridAuthorityFusion({
    result,
    sdarPlan,
    observedAt,
  });
  const observedReality = safeText(renderSafeWorldAnswer(result)).slice(
    0,
    4_000,
  );
  return [
    "AUTHORITY_FUSION_PREVIEW_READY",
    `Plan authority: ${comparison.plan.authority}`,
    `Task: ${comparison.plan.taskId} (${comparison.plan.observedStatus})`,
    `Published plan: ${comparison.plan.publishedSummary}`,
    `Reality authority: ${comparison.reality.authority}`,
    `Grounding: ${comparison.reality.groundingId}`,
    `World version: ${String(comparison.reality.sourceWorldVersion)}`,
    `Observed reality: ${observedReality}`,
    `Composition: ${comparison.composition.authority} ${comparison.composition.relationship}`,
    comparison.composition.summary,
    `Grounding result hash: ${comparison.reality.resultHash}`,
  ]
    .join("\n")
    .slice(0, 16_000);
}

export function renderAuthorityFusionV2(
  result: AuthorityFusionResultV2,
): string {
  return [
    "AUTHORITY_FUSION_V2_READY",
    new AuthorityFusionRenderer().render(result),
    `Task authority: ${result.task.authority}`,
    `Task: ${result.task.taskId} (${result.task.state})`,
    `Reality authority: ${result.reality.authority}`,
    `Grounding: ${result.reality.groundingId}`,
    `Grounding result hash: ${result.reality.resultHash}`,
  ]
    .join("\n")
    .slice(0, 16_000);
}

export function renderSafeWorldAnswer(result: WsgsGroundingResult): string {
  const parsed = parseWsgsGroundingResult(result);
  if (parsed.status === "AMBIGUOUS") {
    return [
      "WORLD_GROUNDING_CLARIFICATION_REQUIRED",
      ...parsed.ambiguities.map(
        (ambiguity) =>
          `Ambiguous reference: ` + safeText(ambiguity.surfaceText),
      ),
      "No candidate was selected automatically.",
    ].join("\n");
  }
  if (parsed.status === "UNRESOLVED") {
    return "WSGS could not resolve this world request. No conclusion about absence was made.";
  }
  if (parsed.status === "FAILED") return terminalFailureText("WSGS_FAILED");
  if (parsed.status === "CANCELLED") {
    return "World grounding was cancelled; no world-state conclusion was made.";
  }
  const lines = [
    parsed.status === "PARTIAL"
      ? "WSGS published a partial world-grounding result."
      : "WSGS published a world-grounding result.",
  ];
  for (const reference of parsed.referenceProducts) {
    const summary =
      reference.safeSummary === undefined
        ? ""
        : ` — ` + safeJson(reference.safeSummary);
    lines.push(`Reference: ` + safeText(reference.displayName) + summary);
  }
  for (const evidence of parsed.evidenceItems) {
    if (evidence.upstreamStatus === "NO_DATA") {
      lines.push(
        `Evidence ` +
          safeText(evidence.evidenceProductId) +
          " reported NO_DATA; this does not establish that the requested fact is absent.",
      );
      continue;
    }
    const payload =
      evidence.safePayload === undefined
        ? ""
        : ` — ` + safeJson(evidence.safePayload);
    lines.push(
      `Evidence ` +
        safeText(evidence.evidenceProductId) +
        ` (` +
        evidence.upstreamStatus +
        `)` +
        payload,
    );
  }
  if (
    parsed.referenceProducts.length === 0 &&
    parsed.evidenceItems.length === 0
  ) {
    lines.push(
      "No safe reference or evidence payload was published; this is not evidence of absence.",
    );
  }
  if (parsed.unresolvedMentions.length > 0) {
    lines.push(
      `Unresolved mentions: ` + String(parsed.unresolvedMentions.length) + ".",
    );
  }
  if (parsed.capabilityGaps.length > 0) {
    lines.push(
      `Capability gaps: ` + String(parsed.capabilityGaps.length) + ".",
    );
  }
  lines.push(`Result hash: ` + parsed.resultHash);
  return lines.join("\n").slice(0, 16_000);
}

async function resolveGroundingResult(
  wsgs: WsgsHttpClient,
  request: WsgsGroundingRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<WsgsGroundingResult> {
  const created = await wsgs.createGrounding(request, idempotencyKey, signal);
  if (!("jobId" in created)) return created;
  const job: WsgsGroundingJob =
    created.result === undefined &&
    ![
      "COMPLETED",
      "PARTIAL",
      "AMBIGUOUS",
      "UNRESOLVED",
      "FAILED",
      "CANCELLED",
    ].includes(created.status)
      ? await wsgs.waitForGrounding(created.groundingId, signal)
      : created;
  if (job.result === undefined) {
    if (job.error !== undefined) {
      throw new WsgsHttpError(
        job.error.code,
        undefined,
        job.error.retryable,
        job.error.stage,
      );
    }
    throw new WorldGroundingRuntimeError("WORLD_GROUNDING_CONTRACT_VIOLATION");
  }
  return job.result;
}

function createWsgsRequest(input: {
  readonly input: WorldGroundingRuntimeTurn;
  readonly plan: ReturnType<typeof planGroundingRequest>;
  readonly requestId: string;
  readonly createdAt: string;
  readonly contextCapsule: WsgsGroundingContextCapsule;
  readonly source?: {
    readonly messageId: string;
    readonly originalText: string;
  };
}): WsgsGroundingRequest {
  const messageId = input.source?.messageId ?? input.input.externalRequestId;
  const originalText = input.source?.originalText ?? input.input.userText;
  return {
    schemaVersion: "1.0",
    requestId: input.requestId,
    operation: input.plan.operation,
    source: {
      conversationRef: input.input.threadId,
      messageId,
      originalText,
      originalTextSha256: `sha256:` + sha256Hex(originalText),
      locale: "und",
      createdAt: input.createdAt,
    },
    requestedProducts: input.plan.requestedProducts,
    contextCapsule: input.contextCapsule,
    executionPolicy: input.plan.executionPolicy,
  };
}

function toKnownWorldReference(reference: ContextReadyWorldReference) {
  const focus = reference.focusReference;
  return {
    alias: focus.displayName,
    referenceKey: focus.referenceKey,
    referenceType: focus.referenceType,
    sourceMessageId: reference.sourceMessageId,
    sourceGroundingId: focus.sourceGroundingId,
    ...(focus.validUntil === undefined ? {} : { validUntil: focus.validUntil }),
  };
}

function renderPendingChoiceClarification(
  choice: PendingGroundingChoice,
  reason: string,
): string {
  return [
    "WORLD_GROUNDING_CHOICE_CLARIFICATION_REQUIRED",
    "Reason: " + reason,
    ...choice.candidates.map(
      ({ ordinal, displayName }) =>
        String(ordinal) + ". " + safeText(displayName),
    ),
  ]
    .join("\n")
    .slice(0, 8_000);
}

function assertResultIdentity(
  result: WsgsGroundingResult,
  request: WsgsGroundingRequest,
): void {
  if (
    result.requestId !== request.requestId ||
    result.source.messageId !== request.source.messageId ||
    result.source.originalTextSha256 !== request.source.originalTextSha256
  ) {
    throw new WorldGroundingRuntimeError("WORLD_GROUNDING_CONTRACT_VIOLATION");
  }
}

function stableTurnHash(
  input: WorldGroundingRuntimeTurn,
  turnPlan: TurnPlan,
  extension?: JsonValue,
): string {
  return hashJsonValue({
    protocol: input.protocol,
    principalId: input.principalId,
    threadId: input.threadId,
    externalRequestId: input.externalRequestId,
    userText: input.userText,
    turnPlan,
    ...(extension === undefined ? {} : { extension }),
  });
}

function hashJsonValue(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(asJsonValue(value)))
    .digest("hex");
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[` + value.map(canonicalJson).join(",") + `]`;
  return (
    `{` +
    Object.keys(value)
      .sort()
      .map(
        (key) => JSON.stringify(key) + ":" + canonicalJson(value[key] ?? null),
      )
      .join(",") +
    `}`
  );
}

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function messageResult(
  stableHash: string,
  response: string,
): CompletedRequestResult {
  const messageId = `world-answer-` + stableHash;
  return {
    kind: "message",
    messageId,
    message: {
      messageId,
      role: "AGENT",
      parts: [{ kind: "text", mediaType: "text/plain", text: response }],
    },
    renderedText: response,
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeText(value: string): string {
  const withoutControlCharacters = Array.from(
    value.replaceAll(/[\\`*_{}[\]()#+.!<>|~-]/gu, " "),
    (character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    },
  ).join("");
  return withoutControlCharacters
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, 2_000);
}

function safeJson(value: JsonValue): string {
  return safeText(JSON.stringify(value)).slice(0, 4_000);
}

function safeRuntimeCode(
  error: unknown,
): WorldGroundingRuntimeCode | undefined {
  if (error instanceof WorldGroundingRuntimeError) return error.code;
  if (error instanceof z.ZodError) {
    return "WORLD_GROUNDING_CONTRACT_VIOLATION";
  }
  if (error instanceof WsgsHttpError) {
    return error.code.includes("CAPABIL")
      ? "WORLD_GROUNDING_CAPABILITY_UNAVAILABLE"
      : error.code.includes("CONTRACT")
        ? "WORLD_GROUNDING_CONTRACT_VIOLATION"
        : "WORLD_GROUNDING_FAILED";
  }
  return undefined;
}

function terminalFailureText(code: string): string {
  if (code === "WORLD_GROUNDING_CONTEXT_UNAVAILABLE") return code;
  if (code === "WORLD_GROUNDING_CAPABILITY_UNAVAILABLE") return code;
  if (code === "WORLD_GROUNDING_CONTRACT_VIOLATION") return code;
  if (code === "AUTHORITY_FUSION_PREVIEW_UNAVAILABLE") return code;
  return "WORLD_GROUNDING_FAILED";
}
