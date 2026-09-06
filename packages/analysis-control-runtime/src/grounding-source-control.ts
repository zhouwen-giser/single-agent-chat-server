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

export function createGroundingSourceAnalysisControl(options: {
  runtime: GroundingSourceAnalysisRuntime;
  store: AnalysisDevelopmentRepository;
  analysis: AnalysisRepository;
  grounding: GroundingPersistenceRepository;
  wsgs: WsgsHttpClient;
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
      const result = await options.store.commitCancellation({
        scope: request,
        commandId: command.commandId,
        claimToken: claim.claimToken,
        transition: {
          requested: pending,
          settled: pending,
          queueRevision: false,
        },
      });
      if (execution.wsgsGroundingId)
        await options.wsgs
          .cancelGrounding(execution.wsgsGroundingId)
          .catch(() => undefined);
      await options.runtime.pump.ensure(scope);
      return result;
    },
  };
}
