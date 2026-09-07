import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AnalysisServiceError,
  type AnalysisControlService,
  type AnalysisRequestScope,
  type GroundingSourceProposalCommand,
} from "./index.js";
import type { GroundingSourceAnalysisRuntime } from "../../analysis-runtime/src/grounding-source-runtime.js";
import type {
  AnalysisDevelopmentRepository,
  AnalysisRepository,
  GroundingPersistenceRepository,
  AnalysisScope,
  SourceRevisionCommandIdentity,
} from "../../persistence/src/index.js";
import type { WorldGroundingRuntime } from "../../world-grounding-runtime/src/index.js";
import {
  FrozenSelectionError,
  planFrozenGroundingRequest,
} from "../../grounding-request-planner/src/frozen-request.js";
import type { WsgsHttpClient } from "../../wsgs-http-adapter/src/index.js";
import { hashCanonicalJson } from "../../world-explanation-contract/src/index.js";
import {
  parseGroundingContractIdentity,
  type GroundingContractIdentity,
} from "../../analysis-contract/src/source.js";
import { GroundingJobAnalysisSourceAdapter } from "../../wsgs-analysis-adapter/src/grounding-job.js";
import { FrozenWorldAnalysisContract } from "../../wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import {
  parseWsgsGroundingRequest,
  WsgsHttpError,
} from "../../wsgs-http-adapter/src/index.js";

type SourceControlStore = Pick<
  AnalysisDevelopmentRepository,
  | "requestScopeForAnalysis"
  | "sourceRevisionExpected"
  | "claimSourceRevision"
  | "getPreparedSourceRevision"
  | "prepareSourceRevision"
  | "completeSourcePresentation"
  | "markSourceRevisionFailed"
  | "loadSourceIntervention"
>;
export interface GroundingSourceAnalysisControl extends AnalysisControlService {
  continueSource(
    scope: AnalysisScope,
    command: GroundingSourceProposalCommand,
  ): Promise<unknown>;
}
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const sourceProposal = z
  .object({
    kind: z.literal("GROUNDING_SOURCE_QUERY"),
    commandId: id,
    idempotencyKey: z.string().min(1).max(256),
    expectedRevisionId: id,
    expectedRevisionNumber: z.number().int().min(0),
    originalText: z.string().min(1).max(32768),
    contextMode: z.enum(["CONTINUE", "REPLACE"]),
    analysisSelections: z.array(z.unknown()).max(8).optional(),
  })
  .strict();
const selectionResponse = z
  .object({
    expectedRevisionId: id,
    expectedRevisionNumber: z.number().int().min(0),
    originalText: z.string().min(1).max(32768),
    analysisSelections: z.array(z.unknown()).min(1).max(8),
  })
  .strict();

export function createGroundingSourceAnalysisControl(options: {
  runtime: Pick<GroundingSourceAnalysisRuntime, "getProjection"> &
    Partial<Pick<GroundingSourceAnalysisRuntime, "accept">> & {
      pump: Pick<GroundingSourceAnalysisRuntime["pump"], "ensure">;
    };
  store: Pick<
    AnalysisDevelopmentRepository,
    | "resolveRequestScope"
    | "claimCancel"
    | "loadCancelContext"
    | "commitCancellation"
  > &
    Partial<SourceControlStore>;
  analysis: Pick<AnalysisRepository, "findSession" | "getGroundingAnalysis">;
  grounding: Pick<GroundingPersistenceRepository, "requestSourceCancellation"> &
    Partial<Pick<GroundingPersistenceRepository, "get">>;
  world?: Pick<WorldGroundingRuntime, "beginWorldGrounding">;
  now?: () => Date;
  wsgs: WsgsHttpClient;
  clientForContract?: (identity: GroundingContractIdentity) => WsgsHttpClient;
}): GroundingSourceAnalysisControl {
  const resolve = async (request: AnalysisRequestScope) => {
    const scope = await options.store.resolveRequestScope(request);
    if (!scope)
      throw new AnalysisServiceError(
        404,
        "ANALYSIS_NOT_FOUND",
        "Analysis was not found.",
      );
    return scope;
  };
  const storeForSource = (): SourceControlStore => {
    const store = options.store;
    if (
      !store.requestScopeForAnalysis ||
      !store.sourceRevisionExpected ||
      !store.claimSourceRevision ||
      !store.getPreparedSourceRevision ||
      !store.prepareSourceRevision ||
      !store.completeSourcePresentation ||
      !store.markSourceRevisionFailed ||
      !store.loadSourceIntervention ||
      !options.world ||
      !options.grounding.get ||
      !options.runtime.accept
    )
      throw new AnalysisServiceError(
        503,
        "ANALYSIS_SOURCE_CONTROL_UNAVAILABLE",
        "Source control is unavailable.",
      );
    return store as typeof store & SourceControlStore;
  };
  const execute = async (
    request: AnalysisRequestScope,
    supplied: GroundingSourceProposalCommand,
    interventionId?: string,
  ): Promise<unknown> => {
    const scope = await resolve(request);
    let command: GroundingSourceProposalCommand;
    const authority = new FrozenWorldAnalysisContract();
    try {
      command = sourceProposal.parse(supplied);
      // Bound and validate untrusted selectors before hashing a command claim;
      // TTL/ownership are intentionally checked later so completed replay stays stable.
      command.analysisSelections?.forEach((selection) =>
        authority.parseSelection(selection),
      );
    } catch {
      throw new AnalysisServiceError(
        422,
        "ANALYSIS_SOURCE_COMMAND_INVALID",
        "Source query is invalid.",
      );
    }
    const store = storeForSource();
    const claim = await store.claimSourceRevision({
      scope: request,
      command,
      requestHash: hashCanonicalJson({
        ...command,
        ...(interventionId ? { interventionId } : {}),
      }),
      ...(interventionId ? { interventionId } : {}),
    });
    if (claim.disposition === "REPLAY") return claim.result;
    if (claim.disposition === "FAILED_REPLAY")
      throw new AnalysisServiceError(
        claim.statusCode,
        claim.safeCode,
        "Source query is unavailable.",
      );
    if (claim.disposition !== "CLAIMED")
      throw new AnalysisServiceError(
        409,
        claim.disposition === "IDEMPOTENCY_CONFLICT"
          ? "ANALYSIS_IDEMPOTENCY_CONFLICT"
          : "ANALYSIS_MUTATION_CONFLICT",
        "Source query conflicts with an existing command.",
      );
    const identity: SourceRevisionCommandIdentity = {
      scope: request,
      commandId: command.commandId,
      claimToken: claim.claimToken,
      commandKind: interventionId
        ? "INTERVENTION_RESOLUTION"
        : "SOURCE_REVISION",
    };
    let durable = false;
    let preparedGroundingId: string | undefined;
    try {
      let prepared = await store.getPreparedSourceRevision(identity);
      durable = prepared !== undefined;
      const leaseOwner = "source-control-" + randomUUID();
      if (!prepared) {
        const bound = await options.analysis.getGroundingAnalysis(scope);
        if (
          !bound ||
          bound.revision.revisionId !== command.expectedRevisionId ||
          bound.revision.revisionNumber !== command.expectedRevisionNumber
        )
          throw new AnalysisServiceError(
            409,
            "ANALYSIS_REVISION_CONFLICT",
            "Analysis revision changed.",
          );
        const prior = await options.grounding.get!({
          groundingId: bound.groundingExecutionId,
          principalId: scope.principalId,
          threadId: scope.threadId,
        });
        if (!prior)
          throw new AnalysisServiceError(
            404,
            "ANALYSIS_NOT_FOUND",
            "Analysis was not found.",
          );
        const contractIdentity = parseGroundingContractIdentity(
          prior.analysisIntent?.["contractIdentity"],
        );
        if (contractIdentity.contractVersion !== "sacs-wsgs-grounding/1.2")
          throw new AnalysisServiceError(
            422,
            "ANALYSIS_SOURCE_CONTRACT_UNSUPPORTED",
            "Source revision requires the frozen world-analysis contract.",
          );
        const result = prior.groundingResult
          ? authority.parse("result", prior.groundingResult)
          : undefined;
        if (interventionId) {
          const intervention = await store.loadSourceIntervention(
            scope,
            interventionId,
          );
          if (
            !intervention ||
            !result ||
            intervention.revisionId !== bound.revision.revisionId ||
            intervention.runId !== bound.run.runId ||
            intervention.requestPayload["priorGroundingId"] !==
              result.groundingId ||
            intervention.requestPayload["priorResultHash"] !==
              result.resultHash ||
            intervention.requestPayload["findingSetHash"] !==
              result.worldAnalysisFindings.findingSetHash
          )
            throw new AnalysisServiceError(
              409,
              "INTERVENTION_LINEAGE_CONFLICT",
              "The saved choice is no longer current.",
            );
          const allowed = intervention.requestPayload["choiceIds"];
          if (
            !Array.isArray(allowed) ||
            !command.analysisSelections?.length ||
            command.analysisSelections.some(
              (s) => !allowed.includes(authority.parseSelection(s).choiceId),
            )
          )
            throw new FrozenSelectionError("SELECTION_UNAVAILABLE");
        }
        const now = options.now?.() ?? new Date();
        const plan = planFrozenGroundingRequest({
          principalId: scope.principalId,
          threadId: scope.threadId,
          analysisId: scope.analysisId,
          commandId:
            "source-command-" +
            hashCanonicalJson({
              commandKind: identity.commandKind,
              commandId: command.commandId,
            }).slice(7),
          expectedRevisionId: command.expectedRevisionId,
          text: command.originalText,
          createdAt: now.toISOString(),
          contextMode: command.contextMode,
          ...(command.analysisSelections
            ? { selections: command.analysisSelections }
            : {}),
          ...(result
            ? {
                context: {
                  ...scope,
                  revisionId: bound.revision.revisionId,
                  contractIdentity,
                  result,
                },
              }
            : {}),
          now: () => now.getTime(),
        });
        if (plan.kind !== "QUERY")
          return await store.completeSourcePresentation({
            ...identity,
            result: {
              ...plan,
              analysisId: scope.analysisId,
              revisionId: bound.revision.revisionId,
            },
          });
        const stable = hashCanonicalJson({
          analysisId: scope.analysisId,
          commandKind: identity.commandKind,
          commandId: command.commandId,
        }).slice(7);
        prepared = await store.prepareSourceRevision({
          ...identity,
          plan: { ...plan, parentRevisionId: bound.revision.revisionId },
          revisionId: "revision-" + stable,
          groundingExecutionId: "grounding-" + stable,
          leaseOwner,
          ...(interventionId
            ? {
                response: {
                  expectedRevisionId: command.expectedRevisionId,
                  expectedRevisionNumber: command.expectedRevisionNumber,
                  originalText: command.originalText,
                  analysisSelections: command.analysisSelections ?? [],
                },
              }
            : {}),
        });
        durable = true;
      }
      preparedGroundingId = prepared.groundingExecutionId;
      const execution = await options.world!.beginWorldGrounding({
        ...scope,
        revisionId: prepared.revisionId,
        groundingExecutionId: prepared.groundingExecutionId,
        interactionRequestId: prepared.interactionRequestId,
        leaseOwner,
        requestId: prepared.request.requestId,
        canonicalGroundingRequest: prepared.request,
        requestHash: prepared.requestHash,
        idempotencyKey: prepared.idempotencyKey,
        contractIdentity: prepared.contractIdentity,
        analysisIntent: prepared.analysisIntent,
      });
      await options.runtime.accept!(execution, leaseOwner);
      const bound = await options.analysis.getGroundingAnalysis(scope);
      if (!bound || bound.revision.revisionId !== prepared.revisionId)
        throw new AnalysisServiceError(
          503,
          "ANALYSIS_SOURCE_COMMAND_PENDING",
          "Source query is saved and awaits observation.",
        );
      return {
        analysisId: scope.analysisId,
        revisionId: bound.revision.revisionId,
        revisionNumber: bound.revision.revisionNumber,
        runId: bound.run.runId,
        groundingExecutionId: bound.groundingExecutionId,
        status: "ACCEPTED",
      };
    } catch (error) {
      const definitelyRejected =
        error instanceof WsgsHttpError &&
        !error.retryable &&
        error.statusCode !== undefined &&
        [400, 401, 403, 404, 405, 406, 409, 410, 413, 415, 422].includes(
          error.statusCode,
        );
      const source =
        definitelyRejected && preparedGroundingId
          ? await options.grounding.get!({
              groundingId: preparedGroundingId,
              principalId: scope.principalId,
              threadId: scope.threadId,
            })
          : undefined;
      const rejectedBeforeSource =
        definitelyRejected && !source?.wsgsGroundingId;
      const safe =
        error instanceof AnalysisServiceError
          ? error
          : error instanceof FrozenSelectionError
            ? new AnalysisServiceError(
                error.code === "SELECTION_EXPIRED"
                  ? 410
                  : error.code === "SELECTION_INVALID"
                    ? 422
                    : 409,
                error.code,
                "Selection is unavailable or conflicts with the current context.",
              )
            : rejectedBeforeSource
              ? new AnalysisServiceError(
                  422,
                  "ANALYSIS_SOURCE_REQUEST_REJECTED",
                  "The source rejected this query; submit a new corrected query.",
                )
              : new AnalysisServiceError(
                  503,
                  "ANALYSIS_SOURCE_QUERY_UNAVAILABLE",
                  "Source query is unavailable; a saved intent can be retried.",
                );
      // Deterministic rejection ends only the local command. The saved source
      // row is retained as history, without inventing a remote FAILED status.
      if (!durable || rejectedBeforeSource)
        await store.markSourceRevisionFailed({
          ...identity,
          safeCode: safe.code,
          statusCode: safe.statusCode,
        });
      throw safe;
    }
  };
  return {
    continueSource: async (scope, command) => {
      const store = storeForSource();
      const request = await store.requestScopeForAnalysis(scope);
      if (!request)
        throw new AnalysisServiceError(
          404,
          "ANALYSIS_NOT_FOUND",
          "Analysis was not found.",
        );
      const original = await store.sourceRevisionExpected(
        scope,
        command.commandId,
      );
      return execute(request, { ...command, ...original });
    },
    getAnalysis: async (request) => {
      const scope = await resolve(request);
      return options.analysis.findSession(scope);
    },
    getSnapshot: async (request) => {
      const scope = await resolve(request);
      return (await options.runtime.getProjection(scope))?.state;
    },
    submitProposal: async (request, command) => {
      if (!("kind" in command)) {
        await resolve(request);
        throw new AnalysisServiceError(
          422,
          "ANALYSIS_SOURCE_KIND_MISMATCH",
          "Grounding analyses accept semantic source queries, not Plan patches.",
        );
      }
      return execute(request, command);
    },
    resolveIntervention: async (request, command) => {
      await resolve(request);
      const parsed = selectionResponse.safeParse(command.response);
      if (!parsed.success)
        throw new AnalysisServiceError(
          422,
          "INTERVENTION_RESPONSE_SCHEMA_INVALID",
          "Choice response is invalid.",
        );
      return execute(
        request,
        {
          kind: "GROUNDING_SOURCE_QUERY",
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          ...parsed.data,
          contextMode: "CONTINUE",
        },
        request.interventionId,
      );
    },
    requestCancel: async (request, command) => {
      const scope = await resolve(request);
      const claim = await options.store.claimCancel({
        scope: request,
        command,
        requestHash: hashCanonicalJson(command),
      });
      if (claim.disposition === "REPLAY") return claim.result;
      if (claim.disposition === "FAILED_REPLAY")
        throw new AnalysisServiceError(
          claim.statusCode,
          claim.safeCode,
          "Cancellation unavailable.",
        );
      if (claim.disposition !== "CLAIMED")
        throw new AnalysisServiceError(
          409,
          "ANALYSIS_MUTATION_CONFLICT",
          "Analysis control conflicts with another command.",
        );
      const context = await options.store.loadCancelContext(
        request,
        command.commandId,
        claim.claimToken,
      );
      const bound = await options.analysis.getGroundingAnalysis(scope);
      if (!context || !bound)
        throw new AnalysisServiceError(
          404,
          "ANALYSIS_NOT_FOUND",
          "Analysis was not found.",
        );
      // Both intent and the visible CANCEL_REQUESTED state precede the HTTP call.
      const execution = await options.grounding.requestSourceCancellation({
        groundingId: bound.groundingExecutionId,
        principalId: scope.principalId,
        threadId: scope.threadId,
      });
      const pending = {
        ...context.currentRun,
        status: "CANCEL_REQUESTED" as const,
      };
      const transition = {
        requested: pending,
        settled: pending,
        queueRevision: false,
      };
      await options.store.commitCancellation({
        scope: request,
        commandId: command.commandId,
        claimToken: claim.claimToken,
        transition,
        deferCommandCompletion: true,
        sourceCancellation: true,
      });
      let sourceObservationError: string | undefined;
      try {
        const contractIdentity = parseGroundingContractIdentity(
          execution.analysisIntent?.["contractIdentity"],
        );
        const client =
          options.clientForContract?.(contractIdentity) ?? options.wsgs;
        if (client.contractVersion !== contractIdentity.contractVersion)
          throw Error("ANALYSIS_SOURCE_CONTRACT_IDENTITY_INVALID");
        const body =
          contractIdentity.contractVersion === "sacs-wsgs-grounding/1.2"
            ? new FrozenWorldAnalysisContract().parse(
                "request",
                execution.canonicalRequest,
              )
            : parseWsgsGroundingRequest(execution.canonicalRequest);
        if (
          execution.wsgsGroundingId &&
          ![
            "COMPLETED",
            "PARTIAL",
            "AMBIGUOUS",
            "UNRESOLVED",
            "FAILED",
            "CANCELLED",
          ].includes(execution.lastSourceStatus ?? "")
        )
          await new GroundingJobAnalysisSourceAdapter(client).cancel({
            identity: {
              kind: "WSGS_GROUNDING_JOB",
              sourceId: execution.wsgsGroundingId,
              sourceHash: "sha256:" + execution.requestHash,
              contractIdentity,
              requestId: execution.wsgsRequestId,
              messageId: body.source.messageId,
              originalTextSha256: body.source.originalTextSha256,
              maxResultBytes: body.executionPolicy.maxResultBytes,
              ...(execution.sourceJobId
                ? { upstreamRunId: execution.sourceJobId }
                : {}),
            },
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            reason: command.reason,
          });
      } catch {
        sourceObservationError = "WSGS_CANCEL_OBSERVATION_UNCONFIRMED";
      }
      const result = await options.store.commitCancellation({
        scope: request,
        commandId: command.commandId,
        claimToken: claim.claimToken,
        transition,
        sourceCancellation: true,
        ...(sourceObservationError ? { sourceObservationError } : {}),
      });
      await options.runtime.pump.ensure(scope);
      return result;
    },
  };
}
