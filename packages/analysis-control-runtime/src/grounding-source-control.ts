import {
  AnalysisServiceError,
  type AnalysisControlService,
  type AnalysisRequestScope,
} from "./index.js";
import type { GroundingSourceAnalysisRuntime } from "../../analysis-runtime/src/grounding-source-runtime.js";
import type {
  AnalysisDevelopmentRepository,
  AnalysisRepository,
  GroundingPersistenceRepository,
} from "../../persistence/src/index.js";
import type { WsgsHttpClient } from "../../wsgs-http-adapter/src/index.js";
import { hashCanonicalJson } from "../../world-explanation-contract/src/index.js";
import {
  parseGroundingContractIdentity,
  type GroundingContractIdentity,
} from "../../analysis-contract/src/source.js";
import { GroundingJobAnalysisSourceAdapter } from "../../wsgs-analysis-adapter/src/grounding-job.js";
import { FrozenWorldAnalysisContract } from "../../wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import { parseWsgsGroundingRequest } from "../../wsgs-http-adapter/src/index.js";

export function createGroundingSourceAnalysisControl(options: {
  runtime: Pick<GroundingSourceAnalysisRuntime, "getProjection"> & {
    pump: Pick<GroundingSourceAnalysisRuntime["pump"], "ensure">;
  };
  store: Pick<
    AnalysisDevelopmentRepository,
    | "resolveRequestScope"
    | "claimCancel"
    | "loadCancelContext"
    | "commitCancellation"
  >;
  analysis: Pick<AnalysisRepository, "findSession" | "getGroundingAnalysis">;
  grounding: Pick<GroundingPersistenceRepository, "requestSourceCancellation">;
  wsgs: WsgsHttpClient;
  clientForContract?: (identity: GroundingContractIdentity) => WsgsHttpClient;
}): AnalysisControlService {
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
  const unsupported = async (request: AnalysisRequestScope): Promise<never> => {
    await resolve(request);
    throw new AnalysisServiceError(
      503,
      "GROUNDING_SOURCE_REVISION_NOT_READY",
      "Grounding source revision control is not ready.",
    );
  };
  return {
    getAnalysis: async (request) => {
      const scope = await resolve(request);
      return options.analysis.findSession(scope);
    },
    getSnapshot: async (request) => {
      const scope = await resolve(request);
      return (await options.runtime.getProjection(scope))?.state;
    },
    submitProposal: unsupported,
    resolveIntervention: unsupported,
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
