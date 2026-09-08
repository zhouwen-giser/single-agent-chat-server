import { randomUUID } from "node:crypto";
import {
  analysisProjectionSchema,
  analysisInterventionSchema,
  analysisRevisionSchema,
  analysisRunSchema,
  analysisSessionSchema,
  agUiSharedStateV03Schema,
  calculateAgUiStateSnapshotHash,
} from "../../packages/analysis-contract/src/index.js";
import {
  parseGroundingContractIdentity,
  sourceStatusMapping,
} from "../../packages/analysis-contract/src/source.js";
import type {
  AnalysisDevelopmentRepository,
  AnalysisIntervention,
  AnalysisRepository,
  AnalysisScope,
  GroundingExecution,
  InteractionPersistenceRepository,
  PreparedSourceRevision,
  SourceRevisionCommandIdentity,
} from "../../packages/persistence/src/index.js";
import {
  AnalysisServiceError,
  type AnalysisRequestScope,
} from "../../packages/analysis-control-runtime/src/index.js";
import type { CompletedRequestResult } from "../../packages/request-result/src/index.js";
import { hashCanonicalJson } from "../../packages/world-explanation-contract/src/index.js";
import type { WorldGroundingRuntimeOptions } from "../../packages/world-grounding-runtime/src/index.js";
import {
  FrozenWorldAnalysisContract,
  publicResultHash,
  type GroundingJob12,
  type GroundingRequest12,
  type GroundingResult12,
} from "../../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import { MemoryGrounding } from "./memory-grounding.js";
import {
  frozenResult,
  publicExample,
  startFrozenWsgsPeer,
} from "./frozen-wsgs-http.js";

const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
export const frozenNow = () => new Date("2026-09-06T02:00:30.000Z");
type InteractionPort = WorldGroundingRuntimeOptions["requests"];

/** Durable interaction storage boundary. Does not execute or plan any analysis. */
export class MemoryFrozenInteraction implements InteractionPort {
  readonly rows = new Map<
    string,
    {
      requestId: string;
      principalId: string;
      threadId: string;
      requestHash: string;
      leaseOwner: string;
      leaseUntil: number;
      createdAt: string;
      result?: CompletedRequestResult;
    }
  >();
  constructor(private readonly now: () => Date = frozenNow) {}
  async claimRequest(
    input: Parameters<InteractionPersistenceRepository["claimRequest"]>[0],
  ): ReturnType<InteractionPersistenceRepository["claimRequest"]> {
    const key = JSON.stringify([
      input.protocol,
      input.externalRequestId,
      input.principalId,
      input.threadId,
    ]);
    const existing = this.rows.get(key);
    if (existing) {
      if (existing.requestHash !== input.requestHash)
        return { outcome: "conflict" };
      if (existing.result)
        return { outcome: "replay", result: clone(existing.result) };
      if (existing.leaseUntil > this.now().getTime())
        return { outcome: "in_progress" };
      existing.leaseOwner = input.leaseOwner;
      existing.leaseUntil = this.now().getTime() + (input.leaseMs ?? 180000);
      return { outcome: "acquired", requestId: existing.requestId };
    }
    const row = {
      requestId: randomUUID(),
      principalId: input.principalId,
      threadId: input.threadId,
      requestHash: input.requestHash,
      leaseOwner: input.leaseOwner,
      leaseUntil: this.now().getTime() + (input.leaseMs ?? 180000),
      createdAt: this.now().toISOString(),
    };
    this.rows.set(key, row);
    return { outcome: "acquired", requestId: row.requestId };
  }
  async authorizedRequestCreatedAt(
    input: Parameters<
      InteractionPersistenceRepository["authorizedRequestCreatedAt"]
    >[0],
  ) {
    const row = [...this.rows.values()].find(
      (item) =>
        item.requestId === input.requestId &&
        item.principalId === input.principalId &&
        item.threadId === input.threadId,
    );
    if (!row) throw Error("INTERACTION_NOT_FOUND");
    return row.createdAt;
  }
  async completeRequest(
    input: Parameters<InteractionPersistenceRepository["completeRequest"]>[0],
  ) {
    const row = [...this.rows.values()].find(
      (item) =>
        item.requestId === input.requestId &&
        item.principalId === input.principalId,
    );
    if (!row || row.result || row.leaseOwner !== input.leaseOwner)
      throw Error("INTERACTION_COMPLETION_CONFLICT");
    row.result = clone(input.result);
    row.leaseUntil = 0;
  }
}

type BoundAnalysis = NonNullable<
  Awaited<ReturnType<AnalysisRepository["getGroundingAnalysis"]>>
>;
type StoredProjection = NonNullable<
  Awaited<ReturnType<AnalysisRepository["getProjection"]>>
>;
type AnalysisPort = Pick<
  AnalysisRepository,
  | "findSession"
  | "getProjection"
  | "getGroundingAnalysis"
  | "bindGroundingSource"
  | "projectGroundingSource"
>;

/**
 * Repository-port substitute only: stores source bindings and supplied projections.
 * The production runtime creates every view/state and the production HTTP adapter
 * receives every source. This is not evidence for PostgreSQL transaction behavior.
 */
export class MemoryFrozenAnalysis implements AnalysisPort {
  readonly bindings = new Map<string, BoundAnalysis>();
  readonly history = new Map<string, BoundAnalysis>();
  readonly projections = new Map<string, StoredProjection>();
  readonly observations = new Set<string>();
  readonly publications: StoredProjection[] = [];
  readonly historicalObservations: string[] = [];
  readonly interventions = new Map<string, AnalysisIntervention>();
  onSourceBound?: (execution: GroundingExecution, bound: BoundAnalysis) => void;
  constructor(
    readonly grounding: MemoryGrounding,
    private readonly now: () => Date = frozenNow,
  ) {}
  private key(scope: AnalysisScope) {
    return JSON.stringify([
      scope.analysisId,
      scope.principalId,
      scope.threadId,
    ]);
  }
  async findSession(scope: AnalysisScope) {
    return clone(this.bindings.get(this.key(scope))?.session);
  }
  async getGroundingAnalysis(scope: AnalysisScope) {
    return clone(this.bindings.get(this.key(scope)));
  }
  async findCurrentGroundingAnalysis(scope: {
    principalId: string;
    threadId: string;
  }) {
    return clone(
      [...this.bindings.values()]
        .filter(
          (bound) =>
            bound.session.principalId === scope.principalId &&
            bound.session.threadId === scope.threadId,
        )
        .at(-1),
    );
  }
  async getProjection(scope: AnalysisScope) {
    return clone(this.projections.get(this.key(scope)));
  }
  async recordHistoricalGroundingSource(input: {
    scope: AnalysisScope;
    groundingExecutionId: string;
    revisionId: string;
    runId: string;
    observationHash: string;
  }) {
    const old = this.history.get(input.revisionId);
    const current = this.bindings.get(this.key(input.scope));
    const row = await this.grounding.get({
      groundingId: input.groundingExecutionId,
      principalId: input.scope.principalId,
      threadId: input.scope.threadId,
    });
    if (
      !old ||
      !current ||
      current.revision.revisionId === input.revisionId ||
      old.groundingExecutionId !== input.groundingExecutionId ||
      old.run.runId !== input.runId ||
      !row?.lastSourceStatus ||
      row.lastObservationHash !== input.observationHash
    )
      return;
    const receipt = input.groundingExecutionId + ":" + input.observationHash;
    if (!this.historicalObservations.includes(receipt))
      this.historicalObservations.push(receipt);
    this.history.set(input.revisionId, {
      ...old,
      run: {
        ...old.run,
        status: sourceStatusMapping[row.lastSourceStatus].run,
      },
    });
    this.grounding.projectionReceipts.set(
      input.groundingExecutionId,
      input.observationHash,
    );
  }
  async bindGroundingSource(
    input: Parameters<AnalysisRepository["bindGroundingSource"]>[0],
  ) {
    const execution = await this.grounding.get({
      groundingId: input.groundingExecutionId,
      principalId: input.scope.principalId,
      threadId: input.scope.threadId,
    });
    if (
      !execution?.wsgsGroundingId ||
      execution.analysisIntent?.["analysisId"] !== input.scope.analysisId ||
      execution.analysisIntent["revisionId"] !== input.revisionId
    )
      throw Error("ANALYSIS_NOT_FOUND");
    const priorBinding = this.history.get(input.revisionId);
    if (priorBinding) {
      if (
        priorBinding.groundingExecutionId !== input.groundingExecutionId ||
        priorBinding.run.runId !== input.runId
      )
        throw Error("ANALYSIS_SOURCE_IDENTITY_INVALID");
      return;
    }
    if (
      execution.leaseOwner !== input.leaseOwner ||
      !execution.leaseUntil ||
      execution.leaseUntil.getTime() <= this.now().getTime()
    )
      throw Error("ANALYSIS_SOURCE_LEASE_NOT_OWNED");
    const prior = this.bindings.get(this.key(input.scope));
    if (
      prior &&
      (execution.analysisIntent["parentRevisionId"] !==
        prior.revision.revisionId ||
        execution.analysisIntent["parentRunId"] !== prior.run.runId ||
        execution.analysisIntent["parentRevisionNumber"] !==
          prior.revision.revisionNumber)
    )
      throw new AnalysisServiceError(
        409,
        "ANALYSIS_REVISION_CONFLICT",
        "Revision changed.",
      );
    const revisionNumber = prior ? prior.revision.revisionNumber + 1 : 0;
    const createdAt = this.now().toISOString();
    const session = analysisSessionSchema.parse({
      schemaVersion: "sacs-analysis-session/1.0",
      ...input.scope,
      groundingId: execution.wsgsGroundingId,
      title: input.title,
      autonomyMode: "OBSERVER",
      status: "ACTIVE",
      activeRevisionId: input.revisionId,
      latestRevisionNumber: revisionNumber,
      observerPolicyHash: hashCanonicalJson({
        mode: "OBSERVER",
        source: "GROUNDING_JOB",
      }),
      createdAt: prior?.session.createdAt ?? createdAt,
      updatedAt: createdAt,
    });
    const revision = analysisRevisionSchema.parse({
      schemaVersion: "sacs-analysis-revision/1.0",
      analysisId: input.scope.analysisId,
      revisionId: input.revisionId,
      revisionNumber,
      cause: prior ? "USER_PROPOSAL" : "INITIAL_QUERY",
      ...(prior
        ? {
            parentRevisionId: prior.revision.revisionId,
            parentRunId: prior.run.runId,
          }
        : {}),
      source: {
        kind: "WSGS_GROUNDING_JOB",
        sourceId: execution.wsgsGroundingId,
        sourceHash: "sha256:" + execution.requestHash,
        contractIdentity: parseGroundingContractIdentity(
          execution.analysisIntent["contractIdentity"],
        ),
        ...(execution.sourceJobId
          ? { upstreamRunId: execution.sourceJobId }
          : {}),
      },
      changedPaths: [],
      reusedNodeIds: [],
      invalidatedNodeIds: [],
      rerunNodeIds: [],
      status: "READY",
      createdAt,
    });
    const run = analysisRunSchema.parse({
      schemaVersion: "sacs-analysis-run/1.0",
      runId: input.runId,
      revisionId: input.revisionId,
      attempt: 1,
      status: "STARTING",
      startedAt: createdAt,
      ...(execution.sourceJobId
        ? { upstreamRunId: execution.sourceJobId }
        : {}),
    });
    const binding = {
      session,
      revision,
      run,
      groundingExecutionId: input.groundingExecutionId,
    };
    this.bindings.set(this.key(input.scope), binding);
    this.history.set(input.revisionId, binding);
    this.onSourceBound?.(execution, binding);
  }
  async projectGroundingSource(
    input: Parameters<AnalysisRepository["projectGroundingSource"]>[0],
  ) {
    const key = this.key(input.scope);
    const bound = this.bindings.get(key);
    if (
      !bound ||
      bound.revision.revisionId !== input.revisionId ||
      bound.run.runId !== input.runId ||
      bound.groundingExecutionId !== input.groundingExecutionId
    )
      return undefined;
    const execution = await this.grounding.get({
      groundingId: input.groundingExecutionId,
      principalId: input.scope.principalId,
      threadId: input.scope.threadId,
    });
    if (
      !execution?.lastSourceStatus ||
      execution.lastObservationHash !== input.observationHash
    )
      return undefined;
    const observationKey = JSON.stringify([input.runId, input.observationHash]);
    if (this.observations.has(observationKey))
      return this.getProjection(input.scope);
    this.observations.add(observationKey);
    const pending = input.state["pendingIntervention"];
    if (pending) {
      const intervention = analysisInterventionSchema.parse(pending);
      if (
        intervention.analysisId !== input.scope.analysisId ||
        intervention.revisionId !== input.revisionId ||
        intervention.runId !== input.runId
      )
        throw Error("ANALYSIS_SOURCE_INTERVENTION_INVALID");
      this.interventions.set(
        intervention.interventionId,
        JSON.parse(JSON.stringify(intervention)),
      );
    }
    const prior = this.projections.get(key);
    const activity = {
      sourceStatus: execution.lastSourceStatus,
      transport: "GROUNDING_JOB",
    };
    const projection: StoredProjection = {
      schemaVersion: "sacs-analysis-projection/1.0",
      analysisId: input.scope.analysisId,
      stateRevision: (prior?.stateRevision ?? 0) + 1,
      activityRevision: (prior?.activityRevision ?? 0) + 1,
      state: clone(input.state),
      stateHash: hashCanonicalJson(input.state),
      activity,
      activityHash: hashCanonicalJson(activity),
      lastEventSequence: (prior?.lastEventSequence ?? 0) + 1,
      updatedAt: this.now().toISOString(),
    };
    analysisProjectionSchema.parse(projection);
    const mapping = sourceStatusMapping[execution.lastSourceStatus];
    const updated = {
      ...bound,
      session: { ...bound.session, status: mapping.session },
      run: { ...bound.run, status: mapping.run },
    };
    this.bindings.set(key, updated);
    this.history.set(input.revisionId, updated);
    this.projections.set(key, projection);
    this.grounding.projectionReceipts.set(
      input.groundingExecutionId,
      input.observationHash,
    );
    this.publications.push(projection);
    return clone(projection);
  }
}

interface MemorySourceCommand {
  key: string;
  kind: "SOURCE_REVISION" | "INTERVENTION_RESOLUTION";
  commandId: string;
  idempotencyKey: string;
  requestHash: string;
  scope: AnalysisScope;
  expectedRevisionId: string;
  expectedRevisionNumber: number;
  claimToken: string;
  prepared?: PreparedSourceRevision;
  result?: unknown;
  failure?: {
    safeCode: string;
    statusCode: AnalysisServiceError["statusCode"];
  };
  interventionId?: string;
}

/** Existing command/session claim persistence boundary, not control implementation. */
export class MemoryFrozenControl {
  readonly commands = new Map<string, MemorySourceCommand>();
  readonly cancellations = new Map<
    string,
    {
      scope: AnalysisScope;
      commandId: string;
      idempotencyKey: string;
      requestHash: string;
      claimToken: string;
      expectedRevisionId: string;
      expectedRevisionNumber: number;
      result?: unknown;
    }
  >();
  constructor(
    readonly analysis: MemoryFrozenAnalysis,
    private readonly now: () => Date = frozenNow,
    /** Authenticated external subject -> durable internal principal identity. */
    private readonly principalSubjects: ReadonlyMap<string, string> = new Map(),
  ) {
    analysis.grounding.sourceRecoveryEligible = (execution) => {
      const command = [...this.commands.values()].find(
        (item) =>
          item.commandId === execution.analysisIntent?.["commandId"] &&
          item.kind === execution.analysisIntent["commandKind"] &&
          item.scope.analysisId === execution.analysisIntent["analysisId"],
      );
      if (command?.failure) return false;
      const historical = this.analysis.history.get(
        String(execution.analysisIntent?.["revisionId"]),
      );
      if (!historical) return true;
      return [...this.analysis.bindings.values()].some(
        (bound) => bound.groundingExecutionId === execution.groundingId,
      );
    };
    analysis.onSourceBound = (execution, bound) => {
      const command = [...this.commands.values()].find(
        (item) =>
          item.scope.analysisId === bound.session.analysisId &&
          item.commandId === execution.analysisIntent?.["commandId"] &&
          item.kind === execution.analysisIntent["commandKind"],
      );
      if (!command) return;
      command.result = {
        analysisId: bound.session.analysisId,
        revisionId: bound.revision.revisionId,
        revisionNumber: bound.revision.revisionNumber,
        runId: bound.run.runId,
        groundingExecutionId: execution.groundingId,
        status: "ACCEPTED",
      };
      if (command.interventionId) {
        const intervention = analysis.interventions.get(command.interventionId);
        if (intervention)
          analysis.interventions.set(command.interventionId, {
            ...intervention,
            status: "RESOLVED",
          });
      }
    };
  }
  async resolveRequestScope(request: AnalysisRequestScope) {
    const principalId = this.principalSubjects.get(request.userId);
    if (!principalId) return undefined;
    const bound = [...this.analysis.bindings.values()].find(
      (item) =>
        item.session.analysisId === request.analysisId &&
        item.session.principalId === principalId &&
        request.userRole === "user",
    );
    return bound
      ? {
          analysisId: bound.session.analysisId,
          principalId: bound.session.principalId,
          threadId: bound.session.threadId,
        }
      : undefined;
  }
  async requestScopeForAnalysis(scope: AnalysisScope) {
    const session = await this.analysis.findSession(scope);
    const subject = [...this.principalSubjects.entries()].find(
      ([, principalId]) => principalId === scope.principalId,
    )?.[0];
    return session && subject
      ? {
          analysisId: scope.analysisId,
          userId: subject,
          userRole: "user",
        }
      : undefined;
  }
  async sourceRevisionExpected(scope: AnalysisScope, commandId: string) {
    const command = [...this.commands.values()].find(
      (item) =>
        item.scope.analysisId === scope.analysisId &&
        item.scope.principalId === scope.principalId &&
        item.scope.threadId === scope.threadId &&
        item.commandId === commandId,
    );
    return command
      ? {
          expectedRevisionId: command.expectedRevisionId,
          expectedRevisionNumber: command.expectedRevisionNumber,
        }
      : undefined;
  }
  async claimSourceRevision(
    input: Parameters<AnalysisDevelopmentRepository["claimSourceRevision"]>[0],
  ): ReturnType<AnalysisDevelopmentRepository["claimSourceRevision"]> {
    const scope = await this.resolveRequestScope(input.scope);
    if (!scope)
      throw new AnalysisServiceError(
        404,
        "ANALYSIS_NOT_FOUND",
        "Analysis unavailable.",
      );
    const kind = input.interventionId
      ? "INTERVENTION_RESOLUTION"
      : "SOURCE_REVISION";
    const key = JSON.stringify([
      scope.analysisId,
      kind,
      input.command.commandId,
    ]);
    const existing = [...this.commands.values()].find(
      (item) =>
        item.scope.analysisId === scope.analysisId &&
        item.kind === kind &&
        (item.commandId === input.command.commandId ||
          item.idempotencyKey === input.command.idempotencyKey),
    );
    if (existing) {
      if (
        existing.commandId !== input.command.commandId ||
        existing.idempotencyKey !== input.command.idempotencyKey ||
        existing.requestHash !== input.requestHash
      )
        return { disposition: "IDEMPOTENCY_CONFLICT" };
      if (existing.result !== undefined)
        return { disposition: "REPLAY", result: clone(existing.result) };
      if (existing.failure)
        return { disposition: "FAILED_REPLAY", ...existing.failure };
      return { disposition: "PENDING_CONFLICT" };
    }
    if (
      [...this.commands.values()].some(
        (item) =>
          item.scope.analysisId === scope.analysisId &&
          item.result === undefined &&
          item.failure === undefined,
      )
    )
      return { disposition: "PENDING_CONFLICT" };
    const bound = await this.analysis.getGroundingAnalysis(scope);
    if (
      !bound ||
      bound.revision.revisionId !== input.command.expectedRevisionId ||
      bound.revision.revisionNumber !== input.command.expectedRevisionNumber
    )
      throw new AnalysisServiceError(
        409,
        "ANALYSIS_REVISION_CONFLICT",
        "Revision changed.",
      );
    // The real repository holds the session row lock across this check and insert.
    if (
      [...this.commands.values()].some(
        (item) =>
          item.scope.analysisId === scope.analysisId &&
          item.result === undefined &&
          item.failure === undefined,
      )
    )
      return { disposition: "PENDING_CONFLICT" };
    const row: MemorySourceCommand = {
      key,
      kind,
      scope,
      commandId: input.command.commandId,
      idempotencyKey: input.command.idempotencyKey,
      requestHash: input.requestHash,
      expectedRevisionId: input.command.expectedRevisionId,
      expectedRevisionNumber: input.command.expectedRevisionNumber,
      claimToken: randomUUID(),
      ...(input.interventionId ? { interventionId: input.interventionId } : {}),
    };
    this.commands.set(key, row);
    return { disposition: "CLAIMED", claimToken: row.claimToken };
  }
  private async claimed(input: SourceRevisionCommandIdentity) {
    const scope = await this.resolveRequestScope(input.scope);
    const row =
      scope &&
      this.commands.get(
        JSON.stringify([scope.analysisId, input.commandKind, input.commandId]),
      );
    if (
      !row ||
      row.claimToken !== input.claimToken ||
      row.result !== undefined ||
      row.failure
    )
      throw new AnalysisServiceError(
        409,
        "ANALYSIS_MUTATION_CONFLICT",
        "Command is not owned.",
      );
    return row;
  }
  async getPreparedSourceRevision(input: SourceRevisionCommandIdentity) {
    return clone((await this.claimed(input)).prepared);
  }
  async prepareSourceRevision(
    input: Parameters<
      AnalysisDevelopmentRepository["prepareSourceRevision"]
    >[0],
  ) {
    const command = await this.claimed(input);
    const bound = await this.analysis.getGroundingAnalysis(command.scope);
    if (
      !bound ||
      bound.revision.revisionId !== command.expectedRevisionId ||
      bound.revision.revisionNumber !== command.expectedRevisionNumber ||
      input.plan.parentRevisionId !== command.expectedRevisionId
    )
      throw new AnalysisServiceError(
        409,
        "ANALYSIS_REVISION_CONFLICT",
        "Revision changed.",
      );
    const parent = await this.analysis.grounding.get({
      groundingId: bound.groundingExecutionId,
      principalId: command.scope.principalId,
      threadId: command.scope.threadId,
    });
    if (!parent)
      throw new AnalysisServiceError(
        404,
        "ANALYSIS_NOT_FOUND",
        "Analysis unavailable.",
      );
    const analysisIntent = {
      analysisId: command.scope.analysisId,
      revisionId: input.revisionId,
      contractIdentity: { ...input.plan.contractIdentity },
      parentRevisionId: bound.revision.revisionId,
      parentRunId: bound.run.runId,
      parentRevisionNumber: bound.revision.revisionNumber,
      commandKind: input.commandKind,
      commandId: input.commandId,
      ...(command.interventionId
        ? {
            interventionId: command.interventionId,
          }
        : {}),
    };
    const prepared: PreparedSourceRevision = {
      groundingExecutionId: input.groundingExecutionId,
      interactionRequestId: parent.interactionRequestId,
      revisionId: input.revisionId,
      request: clone(input.plan.request),
      requestHash: input.plan.requestHash,
      idempotencyKey: input.plan.idempotencyKey,
      contractIdentity: input.plan.contractIdentity,
      analysisIntent: JSON.parse(JSON.stringify(analysisIntent)),
    };
    const execution: GroundingExecution = {
      groundingId: prepared.groundingExecutionId,
      principalId: command.scope.principalId,
      threadId: command.scope.threadId,
      interactionRequestId: parent.interactionRequestId,
      wsgsRequestId: prepared.request.requestId,
      idempotencyKey: prepared.idempotencyKey,
      requestHash: prepared.requestHash.slice(7),
      wsgsOperation: prepared.request.operation,
      requestedProducts: prepared.request.requestedProducts,
      contextUsage: {},
      state: "GROUNDING_PENDING",
      leaseOwner: input.leaseOwner,
      leaseUntil: new Date(this.now().getTime() + 180000),
      canonicalRequest: JSON.parse(JSON.stringify(prepared.request)),
      analysisIntent: prepared.analysisIntent,
      version: 1,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.analysis.grounding.rows.set(execution.groundingId, execution);
    command.prepared = prepared;
    return clone(prepared);
  }
  async completeSourcePresentation(
    input: Parameters<
      AnalysisDevelopmentRepository["completeSourcePresentation"]
    >[0],
  ) {
    const command = await this.claimed(input);
    command.result = clone(input.result);
    return clone(command.result);
  }
  async markSourceRevisionFailed(
    input: Parameters<
      AnalysisDevelopmentRepository["markSourceRevisionFailed"]
    >[0],
  ) {
    const command = await this.claimed(input);
    command.failure = {
      safeCode: input.safeCode,
      statusCode: input.statusCode,
    };
  }
  async loadSourceIntervention(scope: AnalysisScope, interventionId: string) {
    const bound = await this.analysis.getGroundingAnalysis(scope);
    const row = this.analysis.interventions.get(interventionId);
    return row &&
      bound &&
      row.revisionId === bound.revision.revisionId &&
      row.analysisId === scope.analysisId &&
      row.status === "OPEN"
      ? clone(row)
      : undefined;
  }
  async claimCancel(
    input: Parameters<AnalysisDevelopmentRepository["claimCancel"]>[0],
  ): ReturnType<AnalysisDevelopmentRepository["claimCancel"]> {
    const scope = await this.resolveRequestScope(input.scope);
    if (!scope)
      throw new AnalysisServiceError(
        404,
        "ANALYSIS_NOT_FOUND",
        "Analysis unavailable.",
      );
    const key = JSON.stringify([scope.analysisId, input.command.commandId]);
    const prior = [...this.cancellations.values()].find(
      (row) =>
        row.scope.analysisId === scope.analysisId &&
        (row.commandId === input.command.commandId ||
          row.idempotencyKey === input.command.idempotencyKey),
    );
    if (prior) {
      if (
        prior.commandId !== input.command.commandId ||
        prior.idempotencyKey !== input.command.idempotencyKey ||
        prior.requestHash !== input.requestHash
      )
        return { disposition: "IDEMPOTENCY_CONFLICT" };
      return prior.result === undefined
        ? { disposition: "PENDING_CONFLICT" }
        : { disposition: "REPLAY", result: clone(prior.result) };
    }
    const bound = await this.analysis.getGroundingAnalysis(scope);
    if (
      !bound ||
      bound.revision.revisionId !== input.command.expectedRevisionId ||
      bound.revision.revisionNumber !== input.command.expectedRevisionNumber
    )
      throw new AnalysisServiceError(
        409,
        "ANALYSIS_REVISION_CONFLICT",
        "Revision changed.",
      );
    const claimToken = randomUUID();
    this.cancellations.set(key, {
      scope,
      commandId: input.command.commandId,
      idempotencyKey: input.command.idempotencyKey,
      requestHash: input.requestHash,
      claimToken,
      expectedRevisionId: input.command.expectedRevisionId,
      expectedRevisionNumber: input.command.expectedRevisionNumber,
    });
    return { disposition: "CLAIMED", claimToken };
  }
  async loadCancelContext(
    request: AnalysisRequestScope,
    commandId: string,
    claimToken: string,
  ) {
    const scope = await this.resolveRequestScope(request);
    const command =
      scope &&
      this.cancellations.get(JSON.stringify([scope.analysisId, commandId]));
    if (!scope || !command || command.claimToken !== claimToken)
      return undefined;
    const bound = await this.analysis.getGroundingAnalysis(scope);
    return bound
      ? {
          session: bound.session,
          currentRevision: bound.revision,
          currentRun: bound.run,
        }
      : undefined;
  }
  async commitCancellation(
    input: Parameters<AnalysisDevelopmentRepository["commitCancellation"]>[0],
  ) {
    const scope = await this.resolveRequestScope(input.scope);
    const command =
      scope &&
      this.cancellations.get(
        JSON.stringify([scope.analysisId, input.commandId]),
      );
    if (
      !scope ||
      !command ||
      command.claimToken !== input.claimToken ||
      command.result !== undefined
    )
      throw new AnalysisServiceError(
        409,
        "ANALYSIS_MUTATION_CONFLICT",
        "Cancellation not owned.",
      );
    const bound = await this.analysis.getGroundingAnalysis(scope);
    const current = await this.analysis.getProjection(scope);
    if (
      !bound ||
      !current ||
      bound.revision.revisionId !== command.expectedRevisionId
    )
      throw new AnalysisServiceError(
        409,
        "ANALYSIS_REVISION_CONFLICT",
        "Revision changed.",
      );
    const terminal = [
      "SUCCEEDED",
      "PARTIAL",
      "FAILED",
      "CANCELLED",
      "WAITING_INTERVENTION",
    ].includes(bound.run.status);
    let stateRevision = current.stateRevision;
    if (!terminal) {
      const state = agUiSharedStateV03Schema.parse(clone(current.state));
      state.analysis.runsById[bound.run.runId] = input.transition.settled;
      const { meta: _meta, ...body } = state;
      stateRevision++;
      const nextState = {
        ...body,
        meta: {
          stateRevision,
          snapshotHash: calculateAgUiStateSnapshotHash(body, stateRevision),
        },
      };
      const next: StoredProjection = {
        ...current,
        state: JSON.parse(JSON.stringify(nextState)),
        stateRevision,
        stateHash: hashCanonicalJson(nextState),
        updatedAt: this.now().toISOString(),
      };
      const key = JSON.stringify([
        scope.analysisId,
        scope.principalId,
        scope.threadId,
      ]);
      this.analysis.projections.set(key, next);
      this.analysis.bindings.set(key, {
        ...bound,
        run: clone(input.transition.settled),
      });
    }
    const status = terminal
      ? bound.run.status
      : input.transition.settled.status;
    const result = {
      status,
      runId: bound.run.runId,
      acknowledged: status === "CANCELLED",
      queueRevision: false,
      stateRevision,
      ...(input.sourceObservationError
        ? { reasonCode: input.sourceObservationError }
        : {}),
    };
    if (!input.deferCommandCompletion) command.result = result;
    return clone(result);
  }
}

/** Distinct logical sources for each formal POST; complete official wire validation. */
export async function startFrozenScenarioPeer(
  input: {
    examples?: readonly string[];
    async?: boolean;
    repeatedRunning?: number;
    rejectSecondPost?: 400 | 406 | 503;
  } = {},
) {
  const contract = new FrozenWorldAnalysisContract();
  const requests: GroundingRequest12[] = [];
  const results: GroundingResult12[] = [];
  const jobs = new Map<
    string,
    {
      job: GroundingJob12;
      polls: number;
      result: GroundingResult12;
      cancelled?: boolean;
    }
  >();
  const peer = await startFrozenWsgsPeer((request) => {
    if (request.path.endsWith("capabilities"))
      return { value: publicExample("capabilities") };
    if (request.method === "POST" && request.path === "/v1/groundings") {
      const body = contract.parse("request", JSON.parse(request.body));
      requests.push(body);
      const index = requests.length;
      if (index === 2 && input.rejectSecondPost)
        return { status: input.rejectSecondPost, value: {} };
      const result = frozenResult(
        input.examples?.[index - 1] ?? "ranking",
        body,
      );
      result.groundingId = "wire-grounding-" + index;
      result.resultHash = publicResultHash(result);
      contract.parse("result", result, body.executionPolicy.maxResultBytes);
      results.push(result);
      const job: GroundingJob12 = {
        schemaVersion: "1.0",
        requestId: body.requestId,
        groundingId: result.groundingId,
        jobId: "wire-job-" + index,
        status: "ACCEPTED",
        createdAt: "2026-09-06T10:00:00.000+08:00",
        updatedAt: "2026-09-06T10:00:00.000+08:00",
      };
      jobs.set(result.groundingId, { job, polls: 0, result });
      return input.async
        ? { status: 202, value: contract.parse("job", job) }
        : { value: result };
    }
    const sourceId = request.path
      .slice("/v1/groundings/".length)
      .replace(/:cancel$/u, "");
    const row = jobs.get(sourceId);
    if (!row) return { status: 404, value: {} };
    if (request.path.endsWith(":cancel")) row.cancelled = true;
    if (row.cancelled)
      return {
        value: contract.parse("job", {
          ...row.job,
          status: "CANCELLED",
          finishedAt: "2026-09-06T10:00:01.000+08:00",
        }),
      };
    row.polls++;
    const value =
      row.polls <= (input.repeatedRunning ?? 0)
        ? { ...row.job, status: "RUNNING" }
        : {
            ...row.job,
            status: row.result.status,
            result: row.result,
            finishedAt: "2026-09-06T10:00:01.000+08:00",
          };
    return { value: contract.parse("job", value) };
  });
  return { ...peer, requests, results, jobs };
}
