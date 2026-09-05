import {
  ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
  analysisChangeProposalSchema,
  analysisRunSchema,
  assertAnalysisPublicArgsNonDisclosure,
  type AnalysisChangeProposal,
  type AnalysisIntervention,
  type AnalysisRevision,
  type AnalysisRun,
  type AnalysisSession,
  type ToolInteractionDescriptor,
} from "../../analysis-contract/src/index.js";
import {
  compileImmutableRevision,
  requestAnalysisRunCancellation,
  type CancelTransition,
  type WsgsCancelRequest,
  type WsgsCancelResult,
  type WsgsCompileRevisionRequest,
  type WsgsCompileRevisionResult,
  type WsgsInterventionResolutionRequest,
  type WsgsInterventionResolutionResult,
} from "../../analysis-runtime/src/revision-coordinator.js";
import {
  AnalysisControlError,
  validateAndApplyPublicArgsPatch,
} from "../../analysis-tool-interaction/src/index.js";
import { hashCanonicalJson } from "../../world-explanation-contract/src/index.js";

import {
  AnalysisServiceError,
  type AnalysisCancelCommand,
  type AnalysisControlService,
  type AnalysisInterventionResolutionCommand,
  type AnalysisRequestScope,
} from "./index.js";

export interface AnalysisProposalContext {
  readonly session: AnalysisSession;
  readonly currentRevision: AnalysisRevision;
  readonly currentRun: AnalysisRun;
  readonly descriptor: ToolInteractionDescriptor;
  readonly validatePublicArgs: (
    value: Readonly<Record<string, unknown>>,
  ) => boolean;
}

export interface AnalysisCancelContext {
  readonly session: AnalysisSession;
  readonly currentRevision: AnalysisRevision;
  readonly currentRun: AnalysisRun;
}

export interface AnalysisInterventionContext {
  readonly intervention: AnalysisIntervention;
  readonly currentRun: AnalysisRun;
  readonly expiresAt?: string;
  readonly validateResponse: (
    value: Readonly<Record<string, unknown>>,
  ) => boolean;
}

export type CommandClaim<T> =
  | { readonly disposition: "CLAIMED"; readonly claimToken: string }
  | { readonly disposition: "REPLAY"; readonly result: T }
  | {
      readonly disposition: "FAILED_REPLAY";
      readonly safeCode: string;
      readonly statusCode: AnalysisServiceError["statusCode"];
    }
  | { readonly disposition: "IDEMPOTENCY_CONFLICT" }
  | { readonly disposition: "PENDING_CONFLICT" };

export interface AnalysisCoordinatorStore {
  getAnalysis(scope: AnalysisRequestScope): Promise<unknown | undefined>;
  getSnapshot(scope: AnalysisRequestScope): Promise<unknown | undefined>;
  loadProposalContext(
    scope: AnalysisRequestScope,
    proposalId: string,
    claimToken: string,
  ): Promise<AnalysisProposalContext | undefined>;
  claimProposal(input: {
    readonly scope: AnalysisRequestScope;
    readonly proposal: AnalysisChangeProposal;
    readonly requestHash: string;
  }): Promise<CommandClaim<unknown>>;
  commitCompiledRevision(input: {
    readonly scope: AnalysisRequestScope;
    readonly expectedRevisionId: string;
    readonly expectedRevisionNumber: number;
    readonly proposalId: string;
    readonly claimToken: string;
    readonly revision: AnalysisRevision;
    readonly patchedPublicArgs: Readonly<Record<string, unknown>>;
    readonly cancellation?: CancelTransition;
    readonly replacementRun?: AnalysisRun;
  }): Promise<unknown>;
  markProposalFailed(input: {
    readonly scope: AnalysisRequestScope;
    readonly proposalId: string;
    readonly claimToken: string;
    readonly safeCode: string;
    readonly statusCode: AnalysisServiceError["statusCode"];
  }): Promise<void>;
  loadCancelContext(
    scope: AnalysisRequestScope,
    commandId: string,
    claimToken: string,
  ): Promise<AnalysisCancelContext | undefined>;
  claimCancel(input: {
    readonly scope: AnalysisRequestScope;
    readonly command: AnalysisCancelCommand;
    readonly requestHash: string;
  }): Promise<CommandClaim<unknown>>;
  commitCancellation(input: {
    readonly scope: AnalysisRequestScope;
    readonly commandId: string;
    readonly claimToken: string;
    readonly transition: CancelTransition;
  }): Promise<unknown>;
  markCancelFailed(input: {
    readonly scope: AnalysisRequestScope;
    readonly commandId: string;
    readonly claimToken: string;
    readonly safeCode: string;
    readonly statusCode: AnalysisServiceError["statusCode"];
  }): Promise<void>;
  loadInterventionContext(
    scope: AnalysisRequestScope & { readonly interventionId: string },
    commandId: string,
    claimToken: string,
  ): Promise<AnalysisInterventionContext | undefined>;
  claimInterventionResolution(input: {
    readonly scope: AnalysisRequestScope & { readonly interventionId: string };
    readonly command: AnalysisInterventionResolutionCommand;
    readonly requestHash: string;
  }): Promise<CommandClaim<unknown>>;
  commitInterventionResolution(input: {
    readonly scope: AnalysisRequestScope & { readonly interventionId: string };
    readonly commandId: string;
    readonly claimToken: string;
    readonly response: Readonly<Record<string, unknown>>;
    readonly responseHash: string;
    readonly resumedRun: AnalysisRun;
  }): Promise<unknown>;
  markInterventionResolutionFailed(input: {
    readonly scope: AnalysisRequestScope & { readonly interventionId: string };
    readonly commandId: string;
    readonly claimToken: string;
    readonly safeCode: string;
    readonly statusCode: AnalysisServiceError["statusCode"];
  }): Promise<void>;
}

export interface AnalysisCoordinatorWsgsPort {
  compileRevision(
    request: WsgsCompileRevisionRequest,
  ): Promise<WsgsCompileRevisionResult>;
  cancelRun(request: WsgsCancelRequest): Promise<WsgsCancelResult>;
  resolveIntervention(
    request: WsgsInterventionResolutionRequest,
  ): Promise<WsgsInterventionResolutionResult>;
}

export interface AnalysisControlCoordinatorOptions {
  readonly store: AnalysisCoordinatorStore;
  readonly wsgs: AnalysisCoordinatorWsgsPort;
  readonly now?: () => string;
  readonly nextId?: (kind: "revision" | "run") => string;
}

export function createAnalysisControlCoordinator(
  options: AnalysisControlCoordinatorOptions,
): AnalysisControlService {
  const now = options.now ?? (() => new Date().toISOString());
  const nextId =
    options.nextId ??
    ((kind: "revision" | "run") =>
      `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return {
    getAnalysis: (scope) => options.store.getAnalysis(scope),
    getSnapshot: (scope) => options.store.getSnapshot(scope),
    submitProposal: async (scope, command) => {
      const proposal = analysisChangeProposalSchema.parse({
        schemaVersion: "sacs-analysis-change-proposal/1.0",
        ...command,
        analysisId: scope.analysisId,
        status: "SUBMITTED",
        createdAt: now(),
      });
      const requestHash = hashCanonicalJson(command);
      const claim = await options.store.claimProposal({
        scope,
        proposal,
        requestHash,
      });
      const replay = resolveClaim(claim);
      if (replay.replayed) return replay.result;
      let dispatched = false;

      try {
        const context = await options.store.loadProposalContext(
          scope,
          command.proposalId,
          replay.claimToken,
        );
        if (context === undefined) throw notFound();
        assertMutableSession(context.session);
        assertRevisionCas(context.currentRevision, command);
        if (
          command.mode === "INTERRUPT_AND_APPLY" &&
          context.descriptor.editPolicy !== "CANCEL_AND_RESTART_ALLOWED"
        ) {
          throw new AnalysisServiceError(
            422,
            "INTERRUPT_EDIT_POLICY_FORBIDDEN",
            "The tool does not allow cancel-and-restart edits.",
          );
        }
        const applied = translateControlError(() =>
          validateAndApplyPublicArgsPatch({
            descriptor: context.descriptor,
            patch: command.patch,
            expectedPublicArgsHash: command.publicArgsHash,
            expectedEditSchemaHash: command.editSchemaHash,
            now: now(),
            validatePublicArgs: context.validatePublicArgs,
          }),
        );
        let cancellation: CancelTransition | undefined;
        if (command.mode === "INTERRUPT_AND_APPLY") {
          assertCancellationDispatchable(context.currentRun);
          dispatched = true;
          cancellation = await requestAnalysisRunCancellation(
            options.wsgs,
            context.currentRun,
            {
              analysisId: scope.analysisId,
              revisionId: context.currentRevision.revisionId,
              commandId: command.commandId,
              idempotencyKey: command.idempotencyKey,
              reason: "REVISION_RESTART",
            },
            now(),
          );
        }
        if (context.currentRevision.analysisId !== scope.analysisId) {
          throw new AnalysisServiceError(
            409,
            "ANALYSIS_REVISION_CONFLICT",
            "Analysis revision changed.",
          );
        }
        dispatched = true;
        let revision = await compileImmutableRevision(options.wsgs, {
          analysisId: scope.analysisId,
          revisionId: nextId("revision"),
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          currentRevision: context.currentRevision,
          parentRunId: context.currentRun.runId,
          cause: "USER_PROPOSAL",
          changedPaths: applied.changedPaths,
          patchedPublicArgs: applied.publicArgs,
          mode: command.mode,
          createdAt: now(),
        });
        if (cancellation?.queueRevision === true) {
          revision = { ...revision, status: "QUEUED" };
        }
        const replacementRun =
          command.mode === "INTERRUPT_AND_APPLY" &&
          cancellation !== undefined &&
          !cancellation.queueRevision
            ? analysisRunSchema.parse({
                schemaVersion: "sacs-analysis-run/1.0",
                runId: nextId("run"),
                revisionId: revision.revisionId,
                attempt: 1,
                parentRunId: context.currentRun.runId,
                status: "STARTING",
                startedAt: revision.createdAt,
              })
            : undefined;
        return await options.store.commitCompiledRevision({
          scope,
          expectedRevisionId: command.expectedRevisionId,
          expectedRevisionNumber: command.expectedRevisionNumber,
          proposalId: command.proposalId,
          claimToken: replay.claimToken,
          revision,
          patchedPublicArgs: applied.publicArgs,
          ...(cancellation === undefined ? {} : { cancellation }),
          ...(replacementRun === undefined ? {} : { replacementRun }),
        });
      } catch (error) {
        const normalized = normalizeServiceError(error);
        if (!dispatched) {
          await options.store
            .markProposalFailed({
              scope,
              proposalId: command.proposalId,
              claimToken: replay.claimToken,
              safeCode: normalized.code,
              statusCode: normalized.statusCode,
            })
            .catch(() => undefined);
        }
        throw normalized;
      }
    },
    requestCancel: async (scope, command) => {
      const claim = await options.store.claimCancel({
        scope,
        command,
        requestHash: hashCanonicalJson(command),
      });
      const replay = resolveClaim(claim);
      if (replay.replayed) return replay.result;
      let dispatched = false;
      try {
        const context = await options.store.loadCancelContext(
          scope,
          command.commandId,
          replay.claimToken,
        );
        if (context === undefined) throw notFound();
        assertMutableSession(context.session);
        assertRevisionCas(context.currentRevision, command);
        assertCancellationDispatchable(context.currentRun);
        dispatched = true;
        const transition = await requestAnalysisRunCancellation(
          options.wsgs,
          context.currentRun,
          {
            analysisId: scope.analysisId,
            revisionId: context.currentRevision.revisionId,
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            reason: command.reason,
          },
          now(),
        ).catch((error) => {
          throw normalizeServiceError(error);
        });
        return await options.store.commitCancellation({
          scope,
          commandId: command.commandId,
          claimToken: replay.claimToken,
          transition,
        });
      } catch (error) {
        const normalized = normalizeServiceError(error);
        if (!dispatched) {
          await options.store
            .markCancelFailed({
              scope,
              commandId: command.commandId,
              claimToken: replay.claimToken,
              safeCode: normalized.code,
              statusCode: normalized.statusCode,
            })
            .catch(() => undefined);
        }
        throw normalized;
      }
    },
    resolveIntervention: async (scope, command) => {
      const claim = await options.store.claimInterventionResolution({
        scope,
        command,
        requestHash: hashCanonicalJson({
          interventionId: scope.interventionId,
          command,
        }),
      });
      const replay = resolveClaim(claim);
      if (replay.replayed) return replay.result;
      let dispatched = false;
      try {
        const context = await options.store.loadInterventionContext(
          scope,
          command.commandId,
          replay.claimToken,
        );
        if (context === undefined) throw interventionNotFound();
        if (
          context.expiresAt !== undefined &&
          Date.parse(now()) >= Date.parse(context.expiresAt)
        ) {
          throw new AnalysisServiceError(
            410,
            "INTERACTION_EXPIRED",
            "Analysis intervention has expired.",
          );
        }
        try {
          assertAnalysisPublicArgsNonDisclosure(command.response);
        } catch {
          throw new AnalysisServiceError(
            422,
            ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
            ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
          );
        }
        if (!context.validateResponse(command.response)) {
          throw new AnalysisServiceError(
            422,
            "INTERVENTION_RESPONSE_SCHEMA_INVALID",
            "Intervention response is invalid.",
          );
        }
        const responseHash = hashCanonicalJson(command.response);
        if (context.currentRun.upstreamRunId === undefined) {
          throw new AnalysisServiceError(
            409,
            "ANALYSIS_UPSTREAM_RUN_ID_REQUIRED",
            "Analysis run cannot be resumed.",
          );
        }
        dispatched = true;
        const result = await options.wsgs.resolveIntervention({
          analysisId: scope.analysisId,
          interventionId: context.intervention.interventionId,
          interruptId: context.intervention.interruptId,
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          response: command.response,
        });
        if (!result.accepted) {
          dispatched = false;
          throw new AnalysisServiceError(
            409,
            "WSGS_INTERVENTION_RESUME_CONFLICT",
            "WSGS did not accept the intervention lineage.",
          );
        }
        if (result.parentUpstreamRunId !== context.currentRun.upstreamRunId) {
          throw new AnalysisServiceError(
            409,
            "WSGS_INTERVENTION_RESUME_CONFLICT",
            "WSGS did not accept the intervention lineage.",
          );
        }
        const resumedRun = analysisRunSchema.parse({
          schemaVersion: "sacs-analysis-run/1.0",
          runId: nextId("run"),
          revisionId: context.currentRun.revisionId,
          attempt: context.currentRun.attempt + 1,
          parentRunId: context.currentRun.runId,
          upstreamRunId: result.upstreamRunId,
          status: "RUNNING",
          startedAt: now(),
        });
        return await options.store.commitInterventionResolution({
          scope,
          commandId: command.commandId,
          claimToken: replay.claimToken,
          response: command.response,
          responseHash,
          resumedRun,
        });
      } catch (error) {
        const normalized = normalizeServiceError(error);
        if (!dispatched) {
          await options.store
            .markInterventionResolutionFailed({
              scope,
              commandId: command.commandId,
              claimToken: replay.claimToken,
              safeCode: normalized.code,
              statusCode: normalized.statusCode,
            })
            .catch(() => undefined);
        }
        throw normalized;
      }
    },
  };
}

function assertMutableSession(session: AnalysisSession): void {
  if (session.status !== "ACTIVE") {
    throw new AnalysisServiceError(
      409,
      "ANALYSIS_NOT_ACTIVE",
      "Analysis is not active.",
    );
  }
}

function assertRevisionCas(
  current: AnalysisRevision,
  expected: {
    readonly expectedRevisionId: string;
    readonly expectedRevisionNumber: number;
  },
): void {
  if (
    current.revisionId !== expected.expectedRevisionId ||
    current.revisionNumber !== expected.expectedRevisionNumber
  ) {
    throw new AnalysisServiceError(
      409,
      "ANALYSIS_REVISION_CONFLICT",
      "Analysis revision changed.",
    );
  }
}

function resolveClaim<T>(
  claim: CommandClaim<T>,
):
  | { readonly replayed: false; readonly claimToken: string }
  | { readonly replayed: true; readonly result: T } {
  if (claim.disposition === "REPLAY") {
    return { replayed: true, result: claim.result };
  }
  if (claim.disposition === "FAILED_REPLAY") {
    throw new AnalysisServiceError(
      claim.statusCode,
      claim.safeCode,
      "The previous analysis command failed.",
    );
  }
  if (claim.disposition === "IDEMPOTENCY_CONFLICT") {
    throw new AnalysisServiceError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was reused for another command.",
    );
  }
  if (claim.disposition === "PENDING_CONFLICT") {
    throw new AnalysisServiceError(
      409,
      "ANALYSIS_MUTATION_PENDING",
      "Another analysis mutation is pending.",
    );
  }
  return { replayed: false, claimToken: claim.claimToken };
}

function assertCancellationDispatchable(run: AnalysisRun): void {
  if (run.upstreamRunId === undefined) {
    throw new AnalysisServiceError(
      409,
      "ANALYSIS_UPSTREAM_RUN_ID_REQUIRED",
      "Analysis run cannot be cancelled.",
    );
  }
  if (
    !new Set<AnalysisRun["status"]>([
      "STARTING",
      "RUNNING",
      "WAITING_INTERVENTION",
    ]).has(run.status)
  ) {
    throw new AnalysisServiceError(
      409,
      "ANALYSIS_RUN_NOT_CANCELLABLE",
      "Analysis run cannot be cancelled.",
    );
  }
}

function translateControlError<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof AnalysisControlError) {
      throw new AnalysisServiceError(
        error.statusCode,
        error.code,
        error.message,
      );
    }
    throw error;
  }
}

function normalizeServiceError(error: unknown): AnalysisServiceError {
  if (error instanceof AnalysisServiceError) return error;
  return new AnalysisServiceError(
    503,
    safeFailureCode(error),
    "WSGS analysis control is unavailable.",
  );
}

function safeFailureCode(error: unknown): string {
  if (error instanceof AnalysisServiceError) return error.code;
  return error instanceof Error &&
    /^[A-Z][A-Z0-9_:-]{0,127}$/u.test(error.message)
    ? error.message
    : "WSGS_ANALYSIS_CONTROL_FAILED";
}

function notFound(): AnalysisServiceError {
  return new AnalysisServiceError(
    404,
    "ANALYSIS_NOT_FOUND",
    "Analysis was not found.",
  );
}

function interventionNotFound(): AnalysisServiceError {
  return new AnalysisServiceError(
    404,
    "ANALYSIS_INTERVENTION_NOT_FOUND",
    "Analysis intervention was not found.",
  );
}
