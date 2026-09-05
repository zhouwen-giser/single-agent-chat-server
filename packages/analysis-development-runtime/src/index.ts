import {
  agUiSharedStateV03Schema,
  analysisIdSchema,
  analysisProjectionSchema,
  analysisRevisionSchema,
  analysisRunSchema,
  analysisSessionSchema,
  calculateAgUiStateSnapshotHash,
  type AgUiSharedStateV03,
  type AnalysisNodeState,
  type AnalysisProjection,
  type AnalysisRevision,
  type AnalysisRun,
  type AnalysisSession,
} from "../../analysis-contract/src/index.js";
import {
  createAnalysisControlCoordinator,
  type AnalysisControlService,
} from "../../analysis-control-runtime/src/index.js";
import { createInitialAnalysisProjection } from "../../analysis-runtime/src/projection-reducer.js";
import {
  AnalysisDevelopmentRepository,
  AnalysisMutationClaimPendingError,
  type AnalysisDevelopmentSnapshot,
  type AnalysisScope,
} from "../../persistence/src/index.js";
import {
  type FixtureWsgsAnalysisCounters,
  type FixtureWsgsAnalysisScenario,
  type WsgsAnalysisAdapter,
  type WsgsAnalysisEventEnvelope,
  type WsgsAnalysisPlanSnapshot,
} from "../../wsgs-analysis-adapter/src/index.js";
import { WsgsAnalysisEventIntegrityGuard } from "../../wsgs-analysis-consumer/src/index.js";
import {
  canonicalJson,
  hashCanonicalJson,
} from "../../world-explanation-contract/src/index.js";

export interface AnalysisDevelopmentEnvironment {
  readonly nodeEnv: string;
  readonly adapterMode: string;
}

export interface AnalysisDevelopmentRuntimeOptions {
  readonly repository: AnalysisDevelopmentRepository;
  readonly adapter: WsgsAnalysisAdapter;
  readonly environment: AnalysisDevelopmentEnvironment;
  readonly now?: () => string;
  readonly nextId?: (kind: "revision" | "run") => string;
  readonly onPumpError?: (
    failure: AnalysisDevelopmentPumpFailure,
  ) => void | Promise<void>;
}

export interface StartAnalysisDevelopmentInput extends AnalysisScope {
  readonly groundingId: string;
  readonly title?: string;
  readonly scenario?: FixtureWsgsAnalysisScenario;
  readonly revisionId?: string;
  readonly runId?: string;
}

export interface StartAnalysisDevelopmentResult {
  readonly session: AnalysisSession;
  readonly revision: AnalysisRevision;
  readonly run: AnalysisRun;
  readonly projection: AnalysisProjection;
  readonly sourceSnapshot: WsgsAnalysisPlanSnapshot;
}

export type AnalysisDevelopmentObservation =
  | {
      readonly kind: "SNAPSHOT";
      readonly snapshot: AgUiSharedStateV03;
      readonly activity: Readonly<Record<string, unknown>>;
      readonly projection: AnalysisProjection;
    }
  | {
      readonly kind: "EVENT";
      readonly snapshot: AgUiSharedStateV03;
      readonly activity: Readonly<Record<string, unknown>>;
      readonly projection: AnalysisProjection;
      readonly upstreamEvent: WsgsAnalysisEventEnvelope;
    };

export type AnalysisDevelopmentPumpState =
  "STARTING" | "RUNNING" | "STOPPED" | "FAILED";

export interface AnalysisDevelopmentPumpFailure extends AnalysisScope {
  readonly errorCode: string;
  readonly observedAt: string;
}

export interface AnalysisDevelopmentPumpStatus extends AnalysisScope {
  readonly state: AnalysisDevelopmentPumpState;
  readonly lastEventSequence: number;
  readonly subscriptionCount: number;
  readonly stopReason?:
    "DURABLE_TERMINAL" | "TERMINAL_EVENT" | "UPSTREAM_STREAM_ENDED";
  readonly errorCode?: string;
}

export interface AnalysisDevelopmentRuntime {
  readonly analysisControl: AnalysisControlService;
  startAnalysis(
    input: StartAnalysisDevelopmentInput,
  ): Promise<StartAnalysisDevelopmentResult>;
  getSnapshot(scope: AnalysisScope): Promise<AgUiSharedStateV03 | undefined>;
  getProjection(scope: AnalysisScope): Promise<AnalysisProjection | undefined>;
  observeAnalysis(
    scope: AnalysisScope,
  ): AsyncIterable<AnalysisDevelopmentObservation>;
  ensureAnalysisPump(
    scope: AnalysisScope,
  ): Promise<AnalysisDevelopmentPumpStatus>;
  getAnalysisPumpStatus(
    scope: AnalysisScope,
  ): AnalysisDevelopmentPumpStatus | undefined;
  getAdapterCounters(): FixtureWsgsAnalysisCounters | undefined;
}

export function createAnalysisDevelopmentRuntime(
  options: AnalysisDevelopmentRuntimeOptions,
): AnalysisDevelopmentRuntime {
  assertDevelopmentEligibility(options);
  const now = options.now ?? (() => new Date().toISOString());
  const analysisControl = createAnalysisControlCoordinator({
    store: options.repository,
    wsgs: options.adapter,
    now,
    ...(options.nextId === undefined ? {} : { nextId: options.nextId }),
  });
  const pumps = new AnalysisDevelopmentPumpSupervisor(options, now);

  return {
    analysisControl,
    startAnalysis: async (input) => {
      const analysisId = analysisIdSchema.parse(input.analysisId);
      const groundingId = analysisIdSchema.parse(input.groundingId);
      const principalId = analysisIdSchema.parse(input.principalId);
      const threadId = analysisIdSchema.parse(input.threadId);
      const revisionId = analysisIdSchema.parse(
        input.revisionId ?? deterministicId("revision", analysisId),
      );
      const runId = analysisIdSchema.parse(
        input.runId ?? deterministicId("run", analysisId),
      );
      if (input.scenario !== undefined) {
        configureFixtureScenario(options.adapter, groundingId, input.scenario);
      }
      const sourceSnapshot = validateSourceSnapshot(
        await options.adapter.getAnalysisSnapshot(groundingId),
      );
      if (
        input.scenario !== undefined &&
        sourceSnapshot.scenario !== input.scenario
      ) {
        throw new Error("ANALYSIS_FIXTURE_SCENARIO_MISMATCH");
      }
      const createdAt = validDateTime(now());
      const revision = analysisRevisionSchema.parse({
        schemaVersion: "sacs-analysis-revision/1.0",
        revisionId,
        analysisId,
        revisionNumber: sourceSnapshot.planRevision,
        cause: "INITIAL_QUERY",
        wsgsPlanId: sourceSnapshot.planId,
        planHash: sourceSnapshot.planHash,
        changedPaths: [],
        reusedNodeIds: [],
        invalidatedNodeIds: [],
        rerunNodeIds: sourceSnapshot.nodeIds,
        status: "RUNNING",
        createdAt,
      });
      const run = analysisRunSchema.parse({
        schemaVersion: "sacs-analysis-run/1.0",
        runId,
        revisionId,
        attempt: 1,
        upstreamRunId: sourceSnapshot.upstreamRunId,
        status: "RUNNING",
        startedAt: createdAt,
      });
      const session = analysisSessionSchema.parse({
        schemaVersion: "sacs-analysis-session/1.0",
        analysisId,
        principalId,
        threadId,
        groundingId,
        title: input.title ?? `Fixture analysis ${analysisId}`,
        autonomyMode: "OBSERVER",
        status: "ACTIVE",
        activeRevisionId: revisionId,
        latestRevisionNumber: revision.revisionNumber,
        observerPolicyHash: hashCanonicalJson({
          schemaVersion: "sacs-analysis-observer-policy/1.0",
          mode: "OBSERVER",
          fixtureOnly: true,
        }),
        createdAt,
        updatedAt: createdAt,
      });
      const projection = enrichInitialProjection(
        createInitialAnalysisProjection({
          session,
          revision,
          run,
          createdAt,
        }),
        sourceSnapshot,
      );
      await options.repository.seedAnalysis({
        scope: { analysisId, principalId, threadId },
        session,
        revision,
        run,
        projection,
        descriptors: sourceSnapshot.toolInteractions,
      });
      const stored = await options.repository.getDevelopmentSnapshot({
        analysisId,
        principalId,
        threadId,
      });
      if (stored === undefined) {
        throw new Error("ANALYSIS_DEVELOPMENT_SEED_NOT_DURABLE");
      }
      const scope = { analysisId, principalId, threadId };
      const pumpStatus = await pumps.ensure(scope);
      if (pumpStatus.state === "FAILED") {
        throw new AnalysisDevelopmentPumpError(
          pumpStatus.errorCode ?? "ANALYSIS_EVENT_PUMP_FAILED",
        );
      }
      return {
        session: stored.session,
        revision: stored.currentRevision,
        run: stored.currentRun,
        projection: stored.projection,
        sourceSnapshot,
      };
    },
    getSnapshot: async (scope) => {
      const stored = await options.repository.getDevelopmentSnapshot(scope);
      return stored === undefined
        ? undefined
        : agUiSharedStateV03Schema.parse(stored.projection.state);
    },
    getProjection: async (scope) =>
      (await options.repository.getDevelopmentSnapshot(scope))?.projection,
    observeAnalysis: (scope) => pumps.observe(scope),
    ensureAnalysisPump: (scope) => pumps.ensure(scope),
    getAnalysisPumpStatus: (scope) => pumps.status(scope),
    getAdapterCounters: () => fixtureCounters(options.adapter),
  };
}

export class AnalysisDevelopmentPumpError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AnalysisDevelopmentPumpError";
  }
}

type PumpStopReason = NonNullable<AnalysisDevelopmentPumpStatus["stopReason"]>;

type PumpNotification =
  | {
      readonly kind: "EVENT";
      readonly observation: Extract<
        AnalysisDevelopmentObservation,
        { readonly kind: "EVENT" }
      >;
    }
  | { readonly kind: "END" }
  | { readonly kind: "ERROR"; readonly errorCode: string };

interface AnalysisPumpEntry extends AnalysisScope {
  state: AnalysisDevelopmentPumpState;
  lastEventSequence: number;
  subscriptionCount: number;
  stopReason?: PumpStopReason;
  errorCode?: string;
  initialized: Promise<void>;
  background?: Promise<void>;
  readonly listeners: Set<(notification: PumpNotification) => void>;
}

class AnalysisDevelopmentPumpSupervisor {
  private readonly entries = new Map<string, AnalysisPumpEntry>();

  constructor(
    private readonly options: AnalysisDevelopmentRuntimeOptions,
    private readonly now: () => string,
  ) {}

  async ensure(
    scopeValue: AnalysisScope,
  ): Promise<AnalysisDevelopmentPumpStatus> {
    const scope = validScope(scopeValue);
    const existing = this.entries.get(scope.analysisId);
    if (existing !== undefined) {
      assertSameScope(existing, scope);
      if (
        existing.state === "STARTING" ||
        existing.state === "RUNNING" ||
        (existing.state === "STOPPED" &&
          (existing.stopReason === "DURABLE_TERMINAL" ||
            existing.stopReason === "TERMINAL_EVENT"))
      ) {
        await existing.initialized;
        return pumpStatus(existing);
      }
    }

    const entry: AnalysisPumpEntry = {
      ...scope,
      state: "STARTING",
      lastEventSequence: 0,
      subscriptionCount: existing?.subscriptionCount ?? 0,
      initialized: Promise.resolve(),
      listeners: new Set(),
    };
    this.entries.set(scope.analysisId, entry);
    entry.initialized = this.initialize(entry).catch((error: unknown) => {
      this.fail(entry, error);
    });
    await entry.initialized;
    return pumpStatus(entry);
  }

  status(scopeValue: AnalysisScope): AnalysisDevelopmentPumpStatus | undefined {
    const scope = validScope(scopeValue);
    const entry = this.entries.get(scope.analysisId);
    if (entry === undefined) return undefined;
    assertSameScope(entry, scope);
    return pumpStatus(entry);
  }

  observe(
    scopeValue: AnalysisScope,
  ): AsyncIterable<AnalysisDevelopmentObservation> {
    return this.observeDurableState(validScope(scopeValue));
  }

  private async initialize(entry: AnalysisPumpEntry): Promise<void> {
    const stored = await this.options.repository.getDevelopmentSnapshot(entry);
    if (stored === undefined) {
      throw new AnalysisDevelopmentPumpError("ANALYSIS_NOT_FOUND");
    }
    assertStoredScope(stored, entry);
    entry.lastEventSequence = stored.projection.lastEventSequence;
    if (isDurableTerminal(stored)) {
      this.stop(entry, "DURABLE_TERMINAL");
      return;
    }
    entry.state = "RUNNING";
    entry.subscriptionCount += 1;
    entry.background = this.consume(entry, stored)
      .then(
        (reason) => {
          this.stop(entry, reason);
        },
        (error: unknown) => {
          this.fail(entry, error);
        },
      )
      .catch(() => undefined);
  }

  private async consume(
    entry: AnalysisPumpEntry,
    stored: AnalysisDevelopmentSnapshot,
  ): Promise<PumpStopReason> {
    const plan = durablePlanIdentity(stored.projection);
    const guard = new WsgsAnalysisEventIntegrityGuard({
      upstreamAnalysisId: plan.upstreamAnalysisId,
      planId: stored.currentRevision.wsgsPlanId,
      planHash: stored.currentRevision.planHash,
      planRevision: stored.currentRevision.revisionNumber,
    });
    const cursor = stored.projection.lastEventSequence;
    for await (const rawEvent of this.options.adapter.subscribeAnalysisEvents(
      stored.session.groundingId,
      cursor === 0 ? undefined : cursor,
    )) {
      const decision = guard.prepare(rawEvent);
      const committed = await retryWhileMutationClaimed(() =>
        this.options.repository.commitUpstreamEvent({
          scope: entry,
          decision,
        }),
      );
      entry.lastEventSequence = committed.projection.lastEventSequence;
      if (!committed.created) {
        if (isTerminalProjection(committed.projection)) {
          return "TERMINAL_EVENT";
        }
        continue;
      }
      guard.accept(decision);
      this.notify(entry, {
        kind: "EVENT",
        observation: {
          kind: "EVENT",
          snapshot: committed.snapshot,
          activity: committed.projection.activity,
          projection: committed.projection,
          upstreamEvent: rawEvent,
        },
      });
      if (isTerminalProjection(committed.projection)) {
        return "TERMINAL_EVENT";
      }
    }
    return "UPSTREAM_STREAM_ENDED";
  }

  private async *observeDurableState(
    scope: AnalysisScope,
  ): AsyncGenerator<AnalysisDevelopmentObservation> {
    const entry = this.entries.get(scope.analysisId);
    if (entry !== undefined) assertSameScope(entry, scope);
    const notifications = new PumpNotificationQueue();
    const listener = (notification: PumpNotification): void => {
      notifications.push(notification);
    };
    let attached = false;
    if (
      entry !== undefined &&
      (entry.state === "STARTING" || entry.state === "RUNNING")
    ) {
      entry.listeners.add(listener);
      attached = true;
    }

    try {
      const stored =
        await this.options.repository.getDevelopmentSnapshot(scope);
      if (stored === undefined) return;
      assertStoredScope(stored, scope);
      let lastEventSequence = stored.projection.lastEventSequence;
      yield {
        kind: "SNAPSHOT",
        snapshot: agUiSharedStateV03Schema.parse(stored.projection.state),
        activity: stored.projection.activity,
        projection: stored.projection,
      };
      if (!attached) {
        if (entry?.state === "FAILED") {
          throw new AnalysisDevelopmentPumpError(
            entry.errorCode ?? "ANALYSIS_EVENT_PUMP_FAILED",
          );
        }
        return;
      }

      for (;;) {
        const notification = await notifications.next();
        if (notification.kind === "END") return;
        if (notification.kind === "ERROR") {
          throw new AnalysisDevelopmentPumpError(notification.errorCode);
        }
        if (
          notification.observation.projection.lastEventSequence <=
          lastEventSequence
        ) {
          continue;
        }
        lastEventSequence =
          notification.observation.projection.lastEventSequence;
        yield notification.observation;
      }
    } finally {
      entry?.listeners.delete(listener);
      notifications.end();
    }
  }

  private stop(entry: AnalysisPumpEntry, reason: PumpStopReason): void {
    if (entry.state === "FAILED") return;
    entry.state = "STOPPED";
    entry.stopReason = reason;
    this.notify(entry, { kind: "END" });
    entry.listeners.clear();
  }

  private fail(entry: AnalysisPumpEntry, error: unknown): void {
    const errorCode = pumpErrorCode(error);
    entry.state = "FAILED";
    entry.errorCode = errorCode;
    delete entry.stopReason;
    this.notify(entry, { kind: "ERROR", errorCode });
    entry.listeners.clear();
    const failure: AnalysisDevelopmentPumpFailure = {
      analysisId: entry.analysisId,
      principalId: entry.principalId,
      threadId: entry.threadId,
      errorCode,
      observedAt: safeObservedAt(this.now),
    };
    try {
      const callback = this.options.onPumpError?.(failure);
      if (callback !== undefined) {
        void Promise.resolve(callback).catch(() => undefined);
      }
    } catch {
      // Error reporting must never create a second unhandled pump failure.
    }
  }

  private notify(
    entry: AnalysisPumpEntry,
    notification: PumpNotification,
  ): void {
    for (const listener of entry.listeners) {
      try {
        listener(notification);
      } catch {
        // Runtime-owned listeners are isolated from the durable event pump.
      }
    }
  }
}

class PumpNotificationQueue {
  private readonly queued: PumpNotification[] = [];
  private readonly waiting: Array<(notification: PumpNotification) => void> =
    [];
  private ended = false;

  push(notification: PumpNotification): void {
    if (this.ended) return;
    const waiter = this.waiting.shift();
    if (waiter === undefined) this.queued.push(notification);
    else waiter(notification);
  }

  async next(): Promise<PumpNotification> {
    const queued = this.queued.shift();
    if (queued !== undefined) return queued;
    if (this.ended) return { kind: "END" };
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiting.splice(0)) waiter({ kind: "END" });
    this.queued.length = 0;
  }
}

function pumpStatus(entry: AnalysisPumpEntry): AnalysisDevelopmentPumpStatus {
  return {
    analysisId: entry.analysisId,
    principalId: entry.principalId,
    threadId: entry.threadId,
    state: entry.state,
    lastEventSequence: entry.lastEventSequence,
    subscriptionCount: entry.subscriptionCount,
    ...(entry.stopReason === undefined ? {} : { stopReason: entry.stopReason }),
    ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
  };
}

function validScope(scope: AnalysisScope): AnalysisScope {
  return {
    analysisId: analysisIdSchema.parse(scope.analysisId),
    principalId: analysisIdSchema.parse(scope.principalId),
    threadId: analysisIdSchema.parse(scope.threadId),
  };
}

function assertSameScope(actual: AnalysisScope, expected: AnalysisScope): void {
  if (
    actual.analysisId !== expected.analysisId ||
    actual.principalId !== expected.principalId ||
    actual.threadId !== expected.threadId
  ) {
    throw new AnalysisDevelopmentPumpError(
      "ANALYSIS_DEVELOPMENT_SCOPE_MISMATCH",
    );
  }
}

function assertStoredScope(
  stored: AnalysisDevelopmentSnapshot,
  scope: AnalysisScope,
): void {
  assertSameScope(
    {
      analysisId: stored.session.analysisId,
      principalId: stored.session.principalId,
      threadId: stored.session.threadId,
    },
    scope,
  );
}

function isDurableTerminal(stored: AnalysisDevelopmentSnapshot): boolean {
  return (
    stored.session.status !== "ACTIVE" ||
    terminalRunStatuses.has(stored.currentRun.status)
  );
}

function isTerminalProjection(projection: AnalysisProjection): boolean {
  const state = agUiSharedStateV03Schema.parse(projection.state);
  if (state.analysis.session.status !== "ACTIVE") return true;
  const activeRevisionId = state.analysis.activeRevisionId;
  const currentRun = Object.values(state.analysis.runsById)
    .filter((run) => run.revisionId === activeRevisionId)
    .sort((left, right) => right.attempt - left.attempt)[0];
  return currentRun !== undefined && terminalRunStatuses.has(currentRun.status);
}

const terminalRunStatuses = new Set<AnalysisRun["status"]>([
  "CANCEL_REQUESTED",
  "CANCELLED",
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
]);

async function retryWhileMutationClaimed<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AnalysisMutationClaimPendingError)) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
}

function pumpErrorCode(error: unknown): string {
  try {
    if (error !== null && typeof error === "object") {
      for (const value of [
        (error as Readonly<{ code?: unknown }>).code,
        (error as Readonly<{ message?: unknown }>).message,
      ]) {
        if (
          typeof value === "string" &&
          /^[A-Z][A-Z0-9_:-]{2,127}$/u.test(value)
        ) {
          return value;
        }
      }
    }
  } catch {
    return "ANALYSIS_EVENT_PUMP_FAILED";
  }
  return "ANALYSIS_EVENT_PUMP_FAILED";
}

function safeObservedAt(now: () => string): string {
  try {
    return validDateTime(now());
  } catch {
    return new Date().toISOString();
  }
}

function enrichInitialProjection(
  initial: AnalysisProjection,
  source: WsgsAnalysisPlanSnapshot,
): AnalysisProjection {
  const state = agUiSharedStateV03Schema.parse(
    JSON.parse(canonicalJson(initial.state)),
  );
  for (const node of source.nodes) {
    state.analysis.nodesById[node.nodeId] = initialNodeState(node.nodeId);
  }
  state.meta.snapshotHash = calculateAgUiStateSnapshotHash(state);
  const activity = {
    schemaVersion: "io.sacs/analysis-activity/v1",
    scenario: source.scenario,
    plan: {
      upstreamAnalysisId: source.upstreamAnalysisId,
      planId: source.planId,
      planHash: source.planHash,
      planRevision: source.planRevision,
      nodeIds: source.nodeIds,
      edges: source.edges,
      generatedAt: source.generatedAt,
    },
    nodesById: Object.fromEntries(
      source.nodes.map((node) => [
        node.nodeId,
        {
          nodeId: node.nodeId,
          displayName: node.displayName,
          phase: node.phase,
          dependencyNodeIds: node.dependencyNodeIds,
          riskLevel: node.riskLevel,
          executionPolicy: node.executionPolicy,
          cancellable: node.cancellable,
        },
      ]),
    ),
    toolInteractionsByNodeId: Object.fromEntries(
      source.toolInteractions.map((descriptor) => [
        descriptor.nodeId,
        descriptor,
      ]),
    ),
  };
  return analysisProjectionSchema.parse({
    ...initial,
    state,
    stateHash: hashCanonicalJson(state),
    activity,
    activityHash: hashCanonicalJson(activity),
  });
}

function initialNodeState(nodeId: string): AnalysisNodeState {
  return {
    schemaVersion: "sacs-analysis-node-state/1.0",
    nodeId,
    executionStatus: "PENDING",
    relevanceStatus: "ACTIVE",
    currentness: "UNKNOWN",
    inputLayerIds: [],
    outputLayerIds: [],
    findingIds: [],
  };
}

function configureFixtureScenario(
  adapter: WsgsAnalysisAdapter,
  groundingId: string,
  scenario: FixtureWsgsAnalysisScenario,
): void {
  const configurable = adapter as WsgsAnalysisAdapter & {
    configureScenario?: (
      groundingId: string,
      scenario: FixtureWsgsAnalysisScenario,
    ) => void;
  };
  if (configurable.configureScenario === undefined) {
    throw new Error("ANALYSIS_FIXTURE_SCENARIO_CONFIGURATION_UNAVAILABLE");
  }
  configurable.configureScenario(groundingId, scenario);
}

function validateSourceSnapshot(
  value: WsgsAnalysisPlanSnapshot,
): WsgsAnalysisPlanSnapshot {
  if (
    value.schemaVersion !== "sacs-wsgs-analysis-plan/1.0" ||
    value.status !== "RUNNING" ||
    !Number.isSafeInteger(value.planRevision) ||
    value.planRevision < 0 ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.planHash) ||
    new Set(value.nodeIds).size !== value.nodeIds.length ||
    value.nodes.length !== value.nodeIds.length ||
    value.nodes.some(
      (node) =>
        !value.nodeIds.includes(node.nodeId) ||
        !analysisIdSchema.safeParse(node.nodeId).success,
    ) ||
    value.toolInteractions.some(
      (descriptor) => !value.nodeIds.includes(descriptor.nodeId),
    )
  ) {
    throw new Error("ANALYSIS_FIXTURE_PLAN_SNAPSHOT_INVALID");
  }
  for (const identifier of [
    value.upstreamAnalysisId,
    value.upstreamRunId,
    value.planId,
  ]) {
    analysisIdSchema.parse(identifier);
  }
  validDateTime(value.generatedAt);
  return value;
}

function durablePlanIdentity(projection: AnalysisProjection): {
  readonly upstreamAnalysisId: string;
} {
  const activity = projection.activity;
  const plan = activity["plan"];
  if (plan === null || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("ANALYSIS_DURABLE_PLAN_IDENTITY_MISSING");
  }
  const upstreamAnalysisId = (plan as Readonly<Record<string, unknown>>)[
    "upstreamAnalysisId"
  ];
  if (typeof upstreamAnalysisId !== "string") {
    throw new Error("ANALYSIS_DURABLE_PLAN_IDENTITY_MISSING");
  }
  return { upstreamAnalysisId };
}

function deterministicId(kind: "revision" | "run", analysisId: string): string {
  return `${kind}-${hashCanonicalJson({ kind, analysisId }).slice(7, 39)}`;
}

function validDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw new Error("ANALYSIS_DEVELOPMENT_TIMESTAMP_INVALID");
  }
  return date.toISOString();
}

function fixtureCounters(
  adapter: WsgsAnalysisAdapter,
): FixtureWsgsAnalysisCounters | undefined {
  const candidate = adapter as WsgsAnalysisAdapter & {
    getCounters?: () => FixtureWsgsAnalysisCounters;
  };
  return candidate.getCounters?.();
}

function assertDevelopmentEligibility(
  options: AnalysisDevelopmentRuntimeOptions,
): void {
  const fixture = options.adapter as WsgsAnalysisAdapter & {
    readonly manifest?: {
      readonly schemaVersion?: unknown;
      readonly adapterId?: unknown;
      readonly productionEligible?: unknown;
    };
  };
  if (
    !new Set(["test", "development"]).has(options.environment.nodeEnv) ||
    options.environment.adapterMode !== "fixture" ||
    options.adapter.productionEligible !== false ||
    fixture.manifest?.schemaVersion !== "sacs-v05-fixture-adapter/1.0" ||
    fixture.manifest.adapterId !== "FixtureWsgsAnalysisAdapter" ||
    fixture.manifest.productionEligible !== false
  ) {
    throw new Error("SACS_ANALYSIS_DEVELOPMENT_RUNTIME_FORBIDDEN");
  }
}
