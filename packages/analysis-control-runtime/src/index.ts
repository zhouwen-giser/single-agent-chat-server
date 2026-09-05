import type { AnalysisPatchOperation } from "../../analysis-contract/src/index.js";

export interface AnalysisRequestScope {
  readonly analysisId: string;
  readonly userId: string;
  readonly userRole: string;
}

export interface AnalysisProposalCommand {
  readonly commandId: string;
  readonly proposalId: string;
  readonly expectedRevisionId: string;
  readonly expectedRevisionNumber: number;
  readonly targetNodeId: string;
  readonly publicArgsHash: string;
  readonly editSchemaHash: string;
  readonly patch: readonly AnalysisPatchOperation[];
  readonly mode: "SUGGEST_NEXT_REVISION" | "INTERRUPT_AND_APPLY";
  readonly idempotencyKey: string;
}

export interface AnalysisCancelCommand {
  readonly commandId: string;
  readonly expectedRevisionId: string;
  readonly expectedRevisionNumber: number;
  readonly idempotencyKey: string;
  readonly reason: "USER_REQUESTED" | "REVISION_RESTART";
}

export interface AnalysisInterventionResolutionCommand {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly response: Readonly<Record<string, unknown>>;
}

export interface AnalysisControlService {
  getAnalysis(scope: AnalysisRequestScope): Promise<unknown | undefined>;
  getSnapshot(scope: AnalysisRequestScope): Promise<unknown | undefined>;
  submitProposal(
    scope: AnalysisRequestScope,
    command: AnalysisProposalCommand,
  ): Promise<unknown>;
  requestCancel(
    scope: AnalysisRequestScope,
    command: AnalysisCancelCommand,
  ): Promise<unknown>;
  resolveIntervention(
    scope: AnalysisRequestScope & { readonly interventionId: string },
    command: AnalysisInterventionResolutionCommand,
  ): Promise<unknown>;
}

export class AnalysisServiceError extends Error {
  constructor(
    readonly statusCode: 400 | 403 | 404 | 409 | 410 | 422 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createUnavailableAnalysisControlService(): AnalysisControlService {
  const unavailable = async (): Promise<never> => {
    throw new AnalysisServiceError(
      503,
      "SACS_WSGS_ANALYSIS_HANDOFF_NOT_READY",
      "Interactive analysis is unavailable until the authoritative WSGS handoff is ready.",
    );
  };
  return {
    getAnalysis: unavailable,
    getSnapshot: unavailable,
    submitProposal: unavailable,
    requestCancel: unavailable,
    resolveIntervention: unavailable,
  };
}

export * from "./coordinator.js";
