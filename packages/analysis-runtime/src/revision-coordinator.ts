import {
  ANALYSIS_MAX_NODES,
  analysisRevisionSchema,
  analysisRunSchema,
  type AnalysisRevision,
  type AnalysisRun,
} from "../../analysis-contract/src/index.js";
import type { WsgsAnalysisControlPort } from "../../wsgs-analysis-consumer/src/index.js";

export interface CompileRevisionRequest {
  readonly analysisId: string;
  readonly revisionId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly currentRevision: AnalysisRevision;
  readonly parentRunId: string;
  readonly cause: Extract<
    AnalysisRevision["cause"],
    "USER_PROPOSAL" | "USER_INTERVENTION" | "AMBIGUITY_RESOLUTION"
  >;
  readonly changedPaths: readonly string[];
  readonly patchedPublicArgs: Readonly<Record<string, unknown>>;
  readonly mode: "SUGGEST_NEXT_REVISION" | "INTERRUPT_AND_APPLY";
  readonly createdAt: string;
}

export interface WsgsCompileRevisionRequest {
  readonly analysisId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly parentPlanId: string;
  readonly parentPlanHash: string;
  readonly parentRevisionNumber: number;
  readonly changedPaths: readonly string[];
  readonly publicArgs: Readonly<Record<string, unknown>>;
}

export interface WsgsCompileRevisionResult {
  readonly upstreamAnalysisId: string;
  readonly planId: string;
  readonly planHash: string;
  readonly planRevision: number;
  readonly parentPlanId: string;
  readonly parentPlanHash: string;
  readonly nodeIds: readonly string[];
  readonly reusedNodeIds: readonly string[];
  readonly invalidatedNodeIds: readonly string[];
  readonly rerunNodeIds: readonly string[];
}

type CompilePort = WsgsAnalysisControlPort<
  WsgsCompileRevisionRequest,
  WsgsCompileRevisionResult
>;

export async function compileImmutableRevision(
  port: Pick<CompilePort, "compileRevision">,
  input: CompileRevisionRequest,
): Promise<AnalysisRevision> {
  if (input.currentRevision.analysisId !== input.analysisId) {
    throw new Error("ANALYSIS_REVISION_SCOPE_MISMATCH");
  }
  const result = await port.compileRevision({
    analysisId: input.analysisId,
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    parentPlanId: input.currentRevision.wsgsPlanId,
    parentPlanHash: input.currentRevision.planHash,
    parentRevisionNumber: input.currentRevision.revisionNumber,
    changedPaths: input.changedPaths,
    publicArgs: input.patchedPublicArgs,
  });
  validateCompileResult(result, input.currentRevision);
  return analysisRevisionSchema.parse({
    schemaVersion: "sacs-analysis-revision/1.0",
    revisionId: input.revisionId,
    analysisId: input.analysisId,
    revisionNumber: input.currentRevision.revisionNumber + 1,
    parentRevisionId: input.currentRevision.revisionId,
    parentRunId: input.parentRunId,
    cause: input.cause,
    wsgsPlanId: result.planId,
    planHash: result.planHash,
    changedPaths: [...input.changedPaths],
    reusedNodeIds: [...result.reusedNodeIds],
    invalidatedNodeIds: [...result.invalidatedNodeIds],
    rerunNodeIds: [...result.rerunNodeIds],
    status: input.mode === "SUGGEST_NEXT_REVISION" ? "QUEUED" : "READY",
    createdAt: input.createdAt,
  });
}

export interface WsgsCancelRequest {
  readonly analysisId: string;
  readonly revisionId: string;
  readonly upstreamRunId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly reason: "USER_REQUESTED" | "REVISION_RESTART";
}

export interface WsgsCancelResult {
  readonly supported: boolean;
  readonly acknowledged: boolean;
  readonly upstreamRunId: string;
}

type CancelPort = WsgsAnalysisControlPort<
  unknown,
  unknown,
  WsgsCancelRequest,
  WsgsCancelResult
>;

export interface CancelTransition {
  readonly requested: AnalysisRun;
  readonly settled: AnalysisRun;
  readonly queueRevision: boolean;
}

export async function requestAnalysisRunCancellation(
  port: Pick<CancelPort, "cancelRun">,
  run: AnalysisRun,
  input: Omit<WsgsCancelRequest, "upstreamRunId">,
  now: string,
): Promise<CancelTransition> {
  const parsed = analysisRunSchema.parse(run);
  if (parsed.upstreamRunId === undefined) {
    throw new Error("ANALYSIS_UPSTREAM_RUN_ID_REQUIRED");
  }
  if (
    !new Set(["STARTING", "RUNNING", "WAITING_INTERVENTION"]).has(parsed.status)
  ) {
    throw new Error("ANALYSIS_RUN_NOT_CANCELLABLE");
  }
  const requested = analysisRunSchema.parse({
    ...parsed,
    status: "CANCEL_REQUESTED",
  });
  const result = await port.cancelRun({
    ...input,
    upstreamRunId: parsed.upstreamRunId,
  });
  if (result.upstreamRunId !== parsed.upstreamRunId) {
    throw new Error("ANALYSIS_CANCEL_RUN_ID_MISMATCH");
  }
  if (result.supported && result.acknowledged) {
    return {
      requested,
      settled: analysisRunSchema.parse({
        ...requested,
        status: "CANCELLED",
        finishedAt: now,
      }),
      queueRevision: false,
    };
  }
  return {
    requested,
    settled: requested,
    queueRevision: true,
  };
}

export interface WsgsInterventionResolutionRequest {
  readonly analysisId: string;
  readonly interventionId: string;
  readonly interruptId: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly response: Readonly<Record<string, unknown>>;
}

export interface WsgsInterventionResolutionResult {
  readonly accepted: boolean;
  readonly upstreamRunId: string;
  readonly parentUpstreamRunId: string;
}

export function validateCompileResult(
  result: WsgsCompileRevisionResult,
  currentRevision: AnalysisRevision,
): void {
  if (
    result.parentPlanId !== currentRevision.wsgsPlanId ||
    result.parentPlanHash !== currentRevision.planHash
  ) {
    throw new Error("WSGS_REVISION_PARENT_PLAN_MISMATCH");
  }
  if (
    result.planId.length === 0 ||
    result.planId === currentRevision.wsgsPlanId ||
    result.planHash === currentRevision.planHash ||
    !/^sha256:[0-9a-f]{64}$/u.test(result.planHash)
  ) {
    throw new Error("WSGS_REVISION_IDENTITY_INVALID");
  }
  if (
    !Number.isInteger(result.planRevision) ||
    result.planRevision !== currentRevision.revisionNumber + 1
  ) {
    throw new Error("WSGS_REVISION_NUMBER_INVALID");
  }
  assertUniqueBounded(result.nodeIds, "WSGS_PLAN_NODE_SET_INVALID");
  const nodeIds = new Set(result.nodeIds);
  const sets = [
    result.reusedNodeIds,
    result.invalidatedNodeIds,
    result.rerunNodeIds,
  ];
  for (const set of sets) {
    assertUniqueBounded(set, "WSGS_REVISION_NODE_SET_INVALID");
    if (set.some((nodeId) => !nodeIds.has(nodeId))) {
      throw new Error("WSGS_REVISION_UNKNOWN_NODE");
    }
  }
  const assigned = new Set<string>();
  for (const set of sets) {
    for (const nodeId of set) {
      if (assigned.has(nodeId)) {
        throw new Error("WSGS_REVISION_NODE_SETS_OVERLAP");
      }
      assigned.add(nodeId);
    }
  }
  if (
    new Set([...result.reusedNodeIds, ...result.rerunNodeIds]).size !==
    nodeIds.size
  ) {
    throw new Error("WSGS_REVISION_NODE_CLASSIFICATION_INCOMPLETE");
  }
}

function assertUniqueBounded(values: readonly string[], code: string): void {
  if (
    values.length > ANALYSIS_MAX_NODES ||
    new Set(values).size !== values.length ||
    values.some((value) => value.length === 0 || value.length > 256)
  ) {
    throw new Error(code);
  }
}
