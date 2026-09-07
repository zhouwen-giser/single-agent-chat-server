import { randomUUID } from "node:crypto";
import {
  agUiSharedStateV03Schema,
  analysisProjectionSchema,
  calculateAgUiStateSnapshotHash,
  type AnalysisProjection,
} from "../../analysis-contract/src/index.js";
import {
  sourceStatusMapping,
  sourceIsTerminal,
  parseGroundingContractIdentity,
  type AnalysisSourceSnapshot,
} from "../../analysis-contract/src/source.js";
import { AnalysisDevelopmentPumpSupervisor } from "../../analysis-development-runtime/src/index.js";
import type {
  AnalysisRepository,
  AnalysisScope,
  GroundingPersistenceRepository,
  GroundingExecution,
} from "../../persistence/src/index.js";
import type { WorldGroundingRuntime } from "../../world-grounding-runtime/src/index.js";
import type {
  WsgsGroundingRequest,
  WsgsGroundingResult,
} from "../../wsgs-http-adapter/src/index.js";
import {
  normalizeWorldAnalysis,
  type AnalysisViewLimits,
} from "../../world-explanation-runtime/src/analysis-view.js";
import { WsgsAuthoritativeContract } from "../../wsgs-geospatial-consumer/src/authoritative.js";
import { FrozenWorldAnalysisContract } from "../../wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import { createInitialAnalysisProjection } from "./projection-reducer.js";
import { emptyMapSharedState } from "../../analysis-map/src/index.js";
import type { JsonObject } from "../../world-explanation-contract/src/index.js";

export interface GroundingSourceRuntimeOptions {
  analysis: AnalysisRepository;
  grounding: GroundingPersistenceRepository;
  world: WorldGroundingRuntime;
  maxActivePumps?: number;
  viewLimits?: AnalysisViewLimits;
}
/** Production source mode of the existing Analysis session/pump/projection stack. */
export class GroundingSourceAnalysisRuntime {
  readonly pump: AnalysisDevelopmentPumpSupervisor;
  private readonly owners = new Map<string, string>();
  private readonly authority = new WsgsAuthoritativeContract();
  private readonly recoveryOwner = "source-recovery-" + randomUUID();
  private readonly shutdown = new AbortController();
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryWork: Promise<unknown> | undefined;
  constructor(private readonly options: GroundingSourceRuntimeOptions) {
    this.pump = new AnalysisDevelopmentPumpSupervisor(
      {
        source: {
          load: (scope) => this.load(scope),
          consume: (scope) => this.consume(scope),
        },
        maxActivePumps: options.maxActivePumps ?? 128,
      },
      () => new Date().toISOString(),
    );
  }
  async accept(
    execution: GroundingExecution,
    leaseOwner: string,
  ): Promise<void> {
    const scope = this.scope(execution);
    if (!execution.wsgsGroundingId || !execution.lastSourceStatus) return;
    if (execution.leaseOwner !== leaseOwner) return;
    this.owners.set(scope.analysisId, leaseOwner);
    await this.options.analysis.bindGroundingSource({
      scope,
      groundingExecutionId: execution.groundingId,
      revisionId: String(execution.analysisIntent?.["revisionId"]),
      runId: "run-" + execution.groundingId,
      leaseOwner,
      title: "世界分析",
    });
    await this.project(scope, execution);
    await this.pump.ensure(scope);
  }
  async getProjection(
    scope: AnalysisScope,
  ): Promise<AnalysisProjection | undefined> {
    const projection = await this.options.analysis.getProjection(scope);
    return projection ? analysisProjectionSchema.parse(projection) : undefined;
  }
  async complete(input: {
    groundingExecutionId: string;
    principalId: string;
    threadId: string;
    signal?: AbortSignal;
  }): Promise<WsgsGroundingResult> {
    const execution = await this.options.grounding.get({
      groundingId: input.groundingExecutionId,
      principalId: input.principalId,
      threadId: input.threadId,
    });
    if (!execution) throw Error("ANALYSIS_NOT_FOUND");
    const scope = this.scope(execution);
    await this.pump.ensure(scope);
    const iterator = this.pump.observe(scope)[Symbol.asyncIterator]();
    try {
      for (;;) {
        input.signal?.throwIfAborted();
        const next = await abortableNext(iterator, input.signal);
        if (next.done) break;
        const state = next.value.snapshot;
        const run = Object.values(state.analysis.runsById).find(
          (r) => r.revisionId === state.analysis.activeRevisionId,
        );
        if (
          run &&
          [
            "SUCCEEDED",
            "PARTIAL",
            "FAILED",
            "CANCELLED",
            "WAITING_INTERVENTION",
          ].includes(run.status)
        )
          break;
      }
    } finally {
      void iterator.return?.();
    }
    const latest = await this.options.grounding.get({
      groundingId: input.groundingExecutionId,
      principalId: input.principalId,
      threadId: input.threadId,
    });
    if (!latest?.lastSourceStatus || !sourceIsTerminal(latest.lastSourceStatus))
      throw Error("ANALYSIS_SOURCE_OBSERVATION_LIMIT_EXCEEDED");
    if (!latest.groundingResult) throw Error("WSGS_" + latest.lastSourceStatus);
    const identity = parseGroundingContractIdentity(
      latest.analysisIntent?.["contractIdentity"],
    );
    if (identity.contractVersion === "sacs-wsgs-grounding/1.2")
      return new FrozenWorldAnalysisContract().parse(
        "result",
        latest.groundingResult,
      );
    this.authority.validate("result", latest.groundingResult);
    return latest.groundingResult as WsgsGroundingResult;
  }
  async recover(): Promise<number> {
    this.shutdown.signal.throwIfAborted();
    const rows = await this.options.grounding.claimRecoverable({
      leaseOwner: this.recoveryOwner,
      leaseMs: 180_000,
      limit: 128,
      sourceOnly: true,
    });
    for (const row of rows) {
      if (!row.canonicalRequest || !row.analysisIntent) continue;
      const request = row.canonicalRequest as WsgsGroundingRequest;
      const execution = await this.options.world.beginWorldGrounding({
        analysisId: String(row.analysisIntent["analysisId"]),
        revisionId: String(row.analysisIntent["revisionId"]),
        groundingExecutionId: row.groundingId,
        interactionRequestId: row.interactionRequestId,
        leaseOwner: this.recoveryOwner,
        principalId: row.principalId,
        threadId: row.threadId,
        requestId: row.wsgsRequestId,
        canonicalGroundingRequest: request,
        requestHash: "sha256:" + row.requestHash,
        idempotencyKey: row.idempotencyKey,
        contractIdentity: parseGroundingContractIdentity(
          row.analysisIntent["contractIdentity"],
        ),
      });
      await this.accept(execution, this.recoveryOwner);
    }
    return rows.length;
  }
  startRecovery(
    intervalMs = 30_000,
    onError: (code: string) => void = () => undefined,
  ): void {
    if (
      !Number.isInteger(intervalMs) ||
      intervalMs < 1000 ||
      intervalMs > 60_000
    )
      throw Error("ANALYSIS_RECOVERY_INTERVAL_INVALID");
    if (this.recoveryTimer || this.recoveryWork || this.shutdown.signal.aborted)
      return;
    const tick = () => {
      this.recoveryTimer = undefined;
      if (this.shutdown.signal.aborted) return;
      this.recoveryWork = this.recover()
        .catch(() => onError("ANALYSIS_SOURCE_RECOVERY_FAILED"))
        .finally(() => {
          this.recoveryWork = undefined;
          if (!this.shutdown.signal.aborted) {
            this.recoveryTimer = setTimeout(tick, intervalMs);
            this.recoveryTimer.unref();
          }
        });
    };
    tick();
  }
  async close(): Promise<void> {
    this.shutdown.abort();
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    await this.recoveryWork;
    await this.pump.settle();
  }
  private scope(execution: GroundingExecution): AnalysisScope {
    const analysisId = execution.analysisIntent?.["analysisId"];
    if (typeof analysisId !== "string")
      throw Error("ANALYSIS_SOURCE_IDENTITY_INVALID");
    return {
      analysisId,
      principalId: execution.principalId,
      threadId: execution.threadId,
    };
  }
  private async load(scope: AnalysisScope) {
    const bound = await this.options.analysis.getGroundingAnalysis(scope);
    if (!bound) return undefined;
    const execution = await this.options.grounding.get({
      groundingId: bound.groundingExecutionId,
      principalId: scope.principalId,
      threadId: scope.threadId,
    });
    if (!execution) return undefined;
    const projection =
      (await this.getProjection(scope)) ??
      (await this.project(scope, execution));
    if (!projection) return undefined;
    return {
      projection,
      terminal:
        execution.lastSourceStatus !== undefined &&
        sourceIsTerminal(execution.lastSourceStatus),
    };
  }
  private async *consume(scope: AnalysisScope) {
    const bound = await this.options.analysis.getGroundingAnalysis(scope);
    if (!bound) return;
    const leaseOwner = this.owners.get(scope.analysisId);
    if (!leaseOwner) throw Error("ANALYSIS_SOURCE_LEASE_NOT_OWNED");
    const input = {
      groundingExecutionId: bound.groundingExecutionId,
      principalId: scope.principalId,
      threadId: scope.threadId,
      leaseOwner,
      signal: this.shutdown.signal,
    };
    try {
      for await (const snapshot of this.options.world.observeWorldGrounding(
        input,
      )) {
        const execution = await this.options.grounding.get({
          groundingId: bound.groundingExecutionId,
          principalId: scope.principalId,
          threadId: scope.threadId,
        });
        if (!execution) return;
        const projection = await this.project(scope, execution);
        if (projection) yield { projection, terminal: snapshot.terminal };
      }
    } finally {
      this.owners.delete(scope.analysisId);
    }
  }
  private async project(
    scope: AnalysisScope,
    execution: GroundingExecution,
  ): Promise<AnalysisProjection | undefined> {
    const bound = await this.options.analysis.getGroundingAnalysis(scope);
    if (
      !bound ||
      !execution.lastSourceStatus ||
      !execution.lastObservationHash ||
      !bound.revision.source ||
      bound.revision.source.kind !== "WSGS_GROUNDING_JOB"
    )
      return undefined;
    const snapshot: AnalysisSourceSnapshot = {
      identity: bound.revision.source,
      sourceStatus: execution.lastSourceStatus,
      terminal: sourceIsTerminal(execution.lastSourceStatus),
      observedAt: execution.updatedAt.toISOString(),
      ...(execution.groundingResult
        ? {
            result: execution.groundingResult as WsgsGroundingResult,
            resultHash: execution.groundingResultHash!,
          }
        : {}),
    };
    const view = normalizeWorldAnalysis({
      analysisId: scope.analysisId,
      revisionId: bound.revision.revisionId,
      runId: bound.run.runId,
      snapshot,
      authority: this.authority,
      ...(this.options.viewLimits ? { limits: this.options.viewLimits } : {}),
    });
    const mapping = sourceStatusMapping[execution.lastSourceStatus];
    const session = { ...bound.session, status: mapping.session };
    const run = {
      ...bound.run,
      status:
        execution.cancelRequested && !snapshot.terminal
          ? ("CANCEL_REQUESTED" as const)
          : mapping.run,
    };
    const revision = {
      ...bound.revision,
      status:
        execution.lastSourceStatus === "COMPLETED"
          ? ("COMPLETED" as const)
          : ["PARTIAL", "UNRESOLVED"].includes(execution.lastSourceStatus)
            ? ("PARTIAL" as const)
            : ["FAILED", "CANCELLED"].includes(execution.lastSourceStatus)
              ? ("FAILED" as const)
              : ("RUNNING" as const),
    };
    const seed = createInitialAnalysisProjection({
      session,
      revision,
      run,
      createdAt: bound.session.createdAt,
    });
    const prior = await this.getProjection(scope);
    const nextRevision = (prior?.stateRevision ?? 0) + 1;
    const { meta: _meta, ...body } = seed.state as ReturnType<
      typeof agUiSharedStateV03Schema.parse
    >;
    const stateBody = {
      ...body,
      worldExplanation: view,
      map: {
        ...emptyMapSharedState(),
        sceneRevision: nextRevision,
        layersById: Object.fromEntries(
          view.map.layers.map((layer) => [layer.layerId, layer]),
        ),
      },
      timeline: {
        schemaVersion: "sacs-shared-timeline/1.0" as const,
        sources: view.timeline.sources,
        items: view.timeline.items,
      },
    };
    const state = agUiSharedStateV03Schema.parse({
      ...stateBody,
      meta: {
        stateRevision: nextRevision,
        snapshotHash: calculateAgUiStateSnapshotHash(stateBody, nextRevision),
      },
    });
    const projection = await this.options.analysis.projectGroundingSource({
      scope,
      groundingExecutionId: execution.groundingId,
      revisionId: bound.revision.revisionId,
      runId: bound.run.runId,
      observationHash: execution.lastObservationHash,
      state: state as unknown as JsonObject,
    });
    return projection ? analysisProjectionSchema.parse(projection) : undefined;
  }
}
async function abortableNext<T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal,
): Promise<IteratorResult<T>> {
  if (!signal) return iterator.next();
  signal.throwIfAborted();
  let listener: () => void = () => undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_resolve, reject) => {
        listener = () => reject(signal.reason);
        signal.addEventListener("abort", listener, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}
