import { describe, expect, it } from "@jest/globals";

import {
  agUiSharedStateV03Schema,
  analysisProjectionSchema,
  analysisRevisionSchema,
  analysisRunSchema,
  analysisSessionSchema,
  calculateAgUiStateSnapshotHash,
  type AgUiSharedStateV03,
  type AnalysisProjection,
} from "../packages/analysis-contract/src/index.js";
import {
  AnalysisDevelopmentPumpError,
  createAnalysisDevelopmentRuntime,
  type AnalysisDevelopmentRuntime,
} from "../packages/analysis-development-runtime/src/index.js";
import {
  AnalysisMutationClaimPendingError,
  type AnalysisDevelopmentEventCommit,
  type AnalysisDevelopmentRepository,
  type AnalysisDevelopmentSeed,
  type AnalysisDevelopmentSnapshot,
} from "../packages/persistence/src/analysis-development-repository.js";
import type { AnalysisScope } from "../packages/persistence/src/index.js";
import {
  FixtureWsgsAnalysisAdapter,
  type WsgsAnalysisAdapter,
  type WsgsAnalysisEventEnvelope,
} from "../packages/wsgs-analysis-adapter/src/index.js";
import {
  calculateCanonicalJsonHash,
  type WsgsAnalysisEventDecision,
} from "../packages/wsgs-analysis-consumer/src/index.js";
import {
  canonicalJson,
  hashCanonicalJson,
} from "../packages/world-explanation-contract/src/index.js";

const environment = {
  nodeEnv: "test",
  adapterMode: "fixture",
} as const;
const adapterEnvironment = {
  NODE_ENV: "test",
  SACS_ANALYSIS_ADAPTER_MODE: "fixture",
} as const;
const now = "2026-09-05T01:00:00.000Z";

describe("v0.5 analysis development runtime", () => {
  it("seeds deterministic trusted state and starts its event pump without an observer", async () => {
    const repository = new MemoryDevelopmentRepository();
    const adapter = new FixtureWsgsAnalysisAdapter({
      environment: adapterEnvironment,
      generatedAt: now,
    });
    const runtime = developmentRuntime(repository, adapter);
    const scope = {
      analysisId: "analysis-development-1",
      principalId: "principal-development-1",
      threadId: "thread-development-1",
    } as const;
    const started = await runtime.startAnalysis({
      ...scope,
      groundingId: "grounding-development-1",
      runId: "agui-run-development-1",
      scenario: "SUCCESS",
    });

    expect(started.run.runId).toBe("agui-run-development-1");
    expect(started.revision.revisionId).toMatch(/^revision-[0-9a-f]{32}$/u);
    expect(started.session).toMatchObject({
      autonomyMode: "OBSERVER",
      activeRevisionId: started.revision.revisionId,
      latestRevisionNumber: 0,
    });
    expect(started.projection.state).toMatchObject({
      analysis: {
        nodesById: {
          reference: { executionStatus: "PENDING" },
          query: { executionStatus: "PENDING" },
          explanation: { executionStatus: "PENDING" },
        },
      },
    });
    expect(started.projection.activity).toMatchObject({
      scenario: "SUCCESS",
      plan: {
        upstreamAnalysisId: started.sourceSnapshot.upstreamAnalysisId,
      },
      toolInteractionsByNodeId: {
        query: started.sourceSnapshot.toolInteractions[0],
      },
    });
    expect(repository.lastSeed?.descriptors).toEqual(
      started.sourceSnapshot.toolInteractions,
    );

    const status = await waitForPump(runtime, scope, "STOPPED");
    expect(status).toMatchObject({
      stopReason: "TERMINAL_EVENT",
      lastEventSequence: 9,
      subscriptionCount: 1,
    });
    expect(runtime.getAdapterCounters()).toMatchObject({
      commands: { EVENTS: 1 },
      executions: { PLAN: 1, EVENTS: 1 },
      clientPublicArgsExecutions: 0,
    });
  });

  it("restores a projection without another adapter snapshot or tool execution", async () => {
    const repository = new MemoryDevelopmentRepository();
    const adapter = new FixtureWsgsAnalysisAdapter({
      environment: adapterEnvironment,
      generatedAt: now,
    });
    const runtime = developmentRuntime(repository, adapter);
    const scope = {
      analysisId: "analysis-reconnect",
      principalId: "principal-reconnect",
      threadId: "thread-reconnect",
    } as const;
    await runtime.startAnalysis({
      ...scope,
      groundingId: "grounding-reconnect",
    });
    await waitForPump(runtime, scope, "STOPPED");
    const before = runtime.getAdapterCounters();
    const projection = await runtime.getProjection(scope);
    const snapshot = await runtime.getSnapshot(scope);

    expect(projection?.state).toEqual(snapshot);
    expect(runtime.getAdapterCounters()).toEqual(before);
  });

  it("continues committing after an observer disconnects", async () => {
    const repository = new MemoryDevelopmentRepository();
    const adapter = new ControlledFixtureWsgsAnalysisAdapter();
    const runtime = developmentRuntime(repository, adapter);
    const scope = {
      analysisId: "analysis-disconnect",
      principalId: "principal-disconnect",
      threadId: "thread-disconnect",
    } as const;
    await runtime.startAnalysis({
      ...scope,
      groundingId: "grounding-disconnect",
    });

    const observer = runtime.observeAnalysis(scope)[Symbol.asyncIterator]();
    expect((await observer.next()).value).toMatchObject({ kind: "SNAPSHOT" });
    adapter.release();
    const firstEvent = await observer.next();
    expect(firstEvent.value).toMatchObject({
      kind: "EVENT",
      upstreamEvent: { sequence: 1 },
      projection: { lastEventSequence: 1 },
    });
    if (firstEvent.value?.kind === "EVENT") {
      expect(repository.committedEventIds).toContain(
        firstEvent.value.upstreamEvent.eventId,
      );
    }

    await observer.return?.();
    adapter.release(16);
    const status = await waitForPump(runtime, scope, "STOPPED");

    expect(status).toMatchObject({
      stopReason: "TERMINAL_EVENT",
      lastEventSequence: 9,
      subscriptionCount: 1,
    });
    expect(repository.lastEventSequence).toBe(9);
    expect(adapter.subscriptions).toHaveLength(1);
  });

  it("retries an upstream event outside the transaction while a mutation claim is active", async () => {
    const repository = new MemoryDevelopmentRepository();
    repository.mutationConflictsRemaining = 2;
    const adapter = new ControlledFixtureWsgsAnalysisAdapter();
    const runtime = developmentRuntime(repository, adapter);
    const scope = {
      analysisId: "analysis-mutation-ordering",
      principalId: "principal-mutation-ordering",
      threadId: "thread-mutation-ordering",
    } as const;
    await runtime.startAnalysis({
      ...scope,
      groundingId: "grounding-mutation-ordering",
    });

    adapter.release();
    await waitForCursor(repository, 1);

    expect(repository.commitAttempts).toBe(3);
    expect(runtime.getAnalysisPumpStatus(scope)).toMatchObject({
      state: "RUNNING",
      lastEventSequence: 1,
    });
    adapter.release(16);
    await waitForPump(runtime, scope, "STOPPED");
  });

  it("shares one pump across observers and rejects a conflicting scope", async () => {
    const repository = new MemoryDevelopmentRepository();
    const adapter = new ControlledFixtureWsgsAnalysisAdapter();
    const runtime = developmentRuntime(repository, adapter);
    const scope = {
      analysisId: "analysis-multi-observer",
      principalId: "principal-multi-observer",
      threadId: "thread-multi-observer",
    } as const;
    await runtime.startAnalysis({
      ...scope,
      groundingId: "grounding-multi-observer",
    });
    const first = runtime.observeAnalysis(scope)[Symbol.asyncIterator]();
    const second = runtime.observeAnalysis(scope)[Symbol.asyncIterator]();

    await Promise.all([first.next(), second.next()]);
    await Promise.all([
      runtime.ensureAnalysisPump(scope),
      runtime.ensureAnalysisPump(scope),
    ]);
    expect(adapter.subscriptions).toHaveLength(1);
    await expect(
      runtime.ensureAnalysisPump({
        ...scope,
        principalId: "principal-conflict",
      }),
    ).rejects.toThrow("ANALYSIS_DEVELOPMENT_SCOPE_MISMATCH");

    adapter.release(16);
    const status = await waitForPump(runtime, scope, "STOPPED");
    expect(status.subscriptionCount).toBe(1);
    expect(repository.committedEventIds).toHaveLength(9);
    await first.return?.();
    await second.return?.();
  });

  it("does not stop for an inactive-plan completion event", async () => {
    const repository = new MemoryDevelopmentRepository();
    const adapter = new ControlledFixtureWsgsAnalysisAdapter((event) => {
      if (event.sequence !== 1) return event;
      const payload = {
        status: "SUCCEEDED",
        terminalGap: null,
        interruptRequired: false,
      };
      return {
        ...event,
        planId: `${event.planId}-inactive`,
        eventType: "ANALYSIS_COMPLETED",
        payload,
        payloadHash: calculateCanonicalJsonHash(payload),
      };
    });
    const runtime = developmentRuntime(repository, adapter);
    const scope = {
      analysisId: "analysis-inactive-completion",
      principalId: "principal-inactive-completion",
      threadId: "thread-inactive-completion",
    } as const;
    await runtime.startAnalysis({
      ...scope,
      groundingId: "grounding-inactive-completion",
    });

    adapter.release();
    await waitForCursor(repository, 1);
    expect(runtime.getAnalysisPumpStatus(scope)?.state).toBe("RUNNING");
    expect(repository.sessionStatus).toBe("ACTIVE");

    adapter.release(16);
    const terminal = await waitForPump(runtime, scope, "STOPPED");
    expect(terminal).toMatchObject({
      stopReason: "TERMINAL_EVENT",
      lastEventSequence: 9,
    });
  });

  it("a new runtime resumes a nonterminal durable cursor and does not restart a terminal pump", async () => {
    const repository = new MemoryDevelopmentRepository();
    const firstAdapter = new ControlledFixtureWsgsAnalysisAdapter();
    const firstRuntime = developmentRuntime(repository, firstAdapter);
    const scope = {
      analysisId: "analysis-runtime-restart",
      principalId: "principal-runtime-restart",
      threadId: "thread-runtime-restart",
    } as const;
    await firstRuntime.startAnalysis({
      ...scope,
      groundingId: "grounding-runtime-restart",
    });
    firstAdapter.release();
    firstAdapter.end();
    const firstStatus = await waitForPump(firstRuntime, scope, "STOPPED");
    expect(firstStatus).toMatchObject({
      stopReason: "UPSTREAM_STREAM_ENDED",
      lastEventSequence: 1,
    });

    const secondAdapter = new ControlledFixtureWsgsAnalysisAdapter();
    const secondRuntime = developmentRuntime(repository, secondAdapter);
    await secondRuntime.ensureAnalysisPump(scope);
    expect(secondAdapter.subscriptions).toEqual([
      {
        groundingId: "grounding-runtime-restart",
        afterSequence: 1,
      },
    ]);
    secondAdapter.release(16);
    const terminal = await waitForPump(secondRuntime, scope, "STOPPED");
    expect(terminal).toMatchObject({
      stopReason: "TERMINAL_EVENT",
      lastEventSequence: 9,
      subscriptionCount: 1,
    });

    const ensuredAgain = await secondRuntime.ensureAnalysisPump(scope);
    expect(ensuredAgain.stopReason).toBe("TERMINAL_EVENT");
    expect(secondAdapter.subscriptions).toHaveLength(1);

    const thirdAdapter = new ControlledFixtureWsgsAnalysisAdapter();
    const thirdRuntime = developmentRuntime(repository, thirdAdapter);
    const durableTerminal = await thirdRuntime.ensureAnalysisPump(scope);
    expect(durableTerminal).toMatchObject({
      state: "STOPPED",
      stopReason: "DURABLE_TERMINAL",
      lastEventSequence: 9,
      subscriptionCount: 0,
    });
    expect(thirdAdapter.subscriptions).toHaveLength(0);
  });

  it("reports pump failures to status and observers without an unhandled rejection", async () => {
    const repository = new MemoryDevelopmentRepository();
    const adapter = new ControlledFixtureWsgsAnalysisAdapter();
    const reported: unknown[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const runtime = developmentRuntime(repository, adapter, async (failure) => {
      reported.push(failure);
      throw new Error("REPORTING_SINK_FAILED");
    });
    const scope = {
      analysisId: "analysis-pump-error",
      principalId: "principal-pump-error",
      threadId: "thread-pump-error",
    } as const;

    try {
      await runtime.startAnalysis({
        ...scope,
        groundingId: "grounding-pump-error",
      });
      const observer = runtime.observeAnalysis(scope)[Symbol.asyncIterator]();
      expect((await observer.next()).value).toMatchObject({ kind: "SNAPSHOT" });

      adapter.fail("UPSTREAM_TEST_FAILURE");
      await expect(observer.next()).rejects.toMatchObject({
        name: "AnalysisDevelopmentPumpError",
        code: "UPSTREAM_TEST_FAILURE",
      } satisfies Partial<AnalysisDevelopmentPumpError>);
      const status = await waitForPump(runtime, scope, "FAILED");
      await flushTasks();

      expect(status).toMatchObject({
        state: "FAILED",
        errorCode: "UPSTREAM_TEST_FAILURE",
        subscriptionCount: 1,
      });
      expect(reported).toEqual([
        {
          ...scope,
          errorCode: "UPSTREAM_TEST_FAILURE",
          observedAt: now,
        },
      ]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("contains a hostile thrown object whose error getters also throw", async () => {
    const repository = new MemoryDevelopmentRepository();
    const adapter = new ControlledFixtureWsgsAnalysisAdapter();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const runtime = developmentRuntime(repository, adapter);
    const scope = {
      analysisId: "analysis-hostile-error",
      principalId: "principal-hostile-error",
      threadId: "thread-hostile-error",
    } as const;

    try {
      await runtime.startAnalysis({
        ...scope,
        groundingId: "grounding-hostile-error",
      });
      const observer = runtime.observeAnalysis(scope)[Symbol.asyncIterator]();
      await observer.next();
      const hostile = Object.create(null, {
        code: {
          get(): never {
            throw new Error("HOSTILE_CODE_GETTER");
          },
        },
        message: {
          get(): never {
            throw new Error("HOSTILE_MESSAGE_GETTER");
          },
        },
      }) as unknown;

      adapter.throwValue(hostile);
      await expect(observer.next()).rejects.toMatchObject({
        code: "ANALYSIS_EVENT_PUMP_FAILED",
      });
      const status = await waitForPump(runtime, scope, "FAILED");
      await flushTasks();
      expect(status.errorCode).toBe("ANALYSIS_EVENT_PUMP_FAILED");
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("fails closed outside fixture development eligibility", () => {
    const repository = new MemoryDevelopmentRepository();
    const adapter = new FixtureWsgsAnalysisAdapter({
      environment: adapterEnvironment,
    });
    expect(() =>
      createAnalysisDevelopmentRuntime({
        repository: repository as unknown as AnalysisDevelopmentRepository,
        adapter,
        environment: { nodeEnv: "production", adapterMode: "fixture" },
      }),
    ).toThrow("SACS_ANALYSIS_DEVELOPMENT_RUNTIME_FORBIDDEN");
    expect(() =>
      createAnalysisDevelopmentRuntime({
        repository: repository as unknown as AnalysisDevelopmentRepository,
        adapter: {
          ...adapter,
          productionEligible: true,
        } as unknown as WsgsAnalysisAdapter,
        environment,
      }),
    ).toThrow("SACS_ANALYSIS_DEVELOPMENT_RUNTIME_FORBIDDEN");
  });
});

class MemoryDevelopmentRepository {
  lastSeed: AnalysisDevelopmentSeed | undefined;
  committedEventIds: string[] = [];
  commitAttempts = 0;
  mutationConflictsRemaining = 0;
  private snapshot: AnalysisDevelopmentSnapshot | undefined;

  get lastEventSequence(): number | undefined {
    return this.snapshot?.projection.lastEventSequence;
  }

  get sessionStatus(): string | undefined {
    return this.snapshot?.session.status;
  }

  async seedAnalysis(seed: AnalysisDevelopmentSeed): Promise<void> {
    this.lastSeed = seed;
    this.snapshot = {
      session: seed.session,
      currentRevision: seed.revision,
      currentRun: seed.run,
      projection: seed.projection,
      ...(seed.intervention === undefined
        ? {}
        : { openIntervention: seed.intervention }),
    };
  }

  async getDevelopmentSnapshot(
    scope: AnalysisScope,
  ): Promise<AnalysisDevelopmentSnapshot | undefined> {
    if (
      this.snapshot?.session.analysisId !== scope.analysisId ||
      this.snapshot.session.principalId !== scope.principalId ||
      this.snapshot.session.threadId !== scope.threadId
    ) {
      return undefined;
    }
    return this.snapshot;
  }

  async commitUpstreamEvent(input: {
    readonly scope: AnalysisScope;
    readonly decision: WsgsAnalysisEventDecision;
  }): Promise<AnalysisDevelopmentEventCommit> {
    this.commitAttempts += 1;
    if (this.mutationConflictsRemaining > 0) {
      this.mutationConflictsRemaining -= 1;
      throw new AnalysisMutationClaimPendingError();
    }
    const stored = await this.getDevelopmentSnapshot(input.scope);
    if (stored === undefined) throw new Error("ANALYSIS_NOT_FOUND");
    const event = input.decision.event;
    if (event.sequence <= stored.projection.lastEventSequence) {
      return {
        created: false,
        disposition: "IDEMPOTENT_DUPLICATE",
        projection: stored.projection,
        snapshot: agUiSharedStateV03Schema.parse(stored.projection.state),
      };
    }
    if (event.sequence !== stored.projection.lastEventSequence + 1) {
      throw new Error("TEST_REPOSITORY_EVENT_SEQUENCE_NOT_NEXT");
    }

    const applyToActivePlan =
      input.decision.disposition === "APPLY_TO_ACTIVE_PLAN";
    const terminal = terminalState(stored, event, applyToActivePlan);
    const projection = nextProjection(
      stored.projection,
      terminal.state,
      event,
      applyToActivePlan,
    );
    this.snapshot = {
      session: terminal.session,
      currentRevision: terminal.revision,
      currentRun: terminal.run,
      projection,
      ...(stored.openIntervention === undefined
        ? {}
        : { openIntervention: stored.openIntervention }),
    };
    this.committedEventIds.push(event.eventId);
    return {
      created: true,
      disposition: input.decision.disposition,
      projection,
      snapshot: agUiSharedStateV03Schema.parse(projection.state),
    };
  }
}

type StreamSignal =
  | { readonly kind: "NEXT" }
  | { readonly kind: "END" }
  | { readonly kind: "ERROR"; readonly errorCode: string }
  | { readonly kind: "THROW"; readonly error: unknown };

class ControlledFixtureWsgsAnalysisAdapter extends FixtureWsgsAnalysisAdapter {
  readonly subscriptions: Array<{
    readonly groundingId: string;
    readonly afterSequence?: number;
  }> = [];
  private readonly signals: StreamSignal[] = [];
  private readonly waiters: Array<(signal: StreamSignal) => void> = [];

  constructor(
    private readonly transformEvent: (
      event: WsgsAnalysisEventEnvelope,
    ) => WsgsAnalysisEventEnvelope = (event) => event,
  ) {
    super({ environment: adapterEnvironment, generatedAt: now });
  }

  override subscribeAnalysisEvents(
    groundingId: string,
    afterSequence?: number,
  ): AsyncIterable<WsgsAnalysisEventEnvelope> {
    this.subscriptions.push({
      groundingId,
      ...(afterSequence === undefined ? {} : { afterSequence }),
    });
    return this.control(
      super.subscribeAnalysisEvents(groundingId, afterSequence),
    );
  }

  release(count = 1): void {
    for (let index = 0; index < count; index += 1) {
      this.send({ kind: "NEXT" });
    }
  }

  end(): void {
    this.send({ kind: "END" });
  }

  fail(errorCode: string): void {
    this.send({ kind: "ERROR", errorCode });
  }

  throwValue(error: unknown): void {
    this.send({ kind: "THROW", error });
  }

  private async *control(
    source: AsyncIterable<WsgsAnalysisEventEnvelope>,
  ): AsyncGenerator<WsgsAnalysisEventEnvelope> {
    for await (const event of source) {
      const signal = await this.nextSignal();
      if (signal.kind === "END") return;
      if (signal.kind === "ERROR") throw new Error(signal.errorCode);
      if (signal.kind === "THROW") throw signal.error;
      yield this.transformEvent(event);
    }
  }

  private async nextSignal(): Promise<StreamSignal> {
    const signal = this.signals.shift();
    if (signal !== undefined) return signal;
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private send(signal: StreamSignal): void {
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.signals.push(signal);
    else waiter(signal);
  }
}

function developmentRuntime(
  repository: MemoryDevelopmentRepository,
  adapter: WsgsAnalysisAdapter,
  onPumpError?: NonNullable<
    Parameters<typeof createAnalysisDevelopmentRuntime>[0]["onPumpError"]
  >,
): AnalysisDevelopmentRuntime {
  return createAnalysisDevelopmentRuntime({
    repository: repository as unknown as AnalysisDevelopmentRepository,
    adapter,
    environment,
    now: () => now,
    ...(onPumpError === undefined ? {} : { onPumpError }),
  });
}

function terminalState(
  stored: AnalysisDevelopmentSnapshot,
  event: WsgsAnalysisEventEnvelope,
  applyToActivePlan: boolean,
): {
  readonly session: AnalysisDevelopmentSnapshot["session"];
  readonly revision: AnalysisDevelopmentSnapshot["currentRevision"];
  readonly run: AnalysisDevelopmentSnapshot["currentRun"];
  readonly state: AgUiSharedStateV03;
} {
  if (event.eventType !== "ANALYSIS_COMPLETED" || !applyToActivePlan) {
    return {
      session: stored.session,
      revision: stored.currentRevision,
      run: stored.currentRun,
      state: agUiSharedStateV03Schema.parse(stored.projection.state),
    };
  }
  const status = event.payload["status"];
  if (status !== "SUCCEEDED" && status !== "PARTIAL") {
    throw new Error("TEST_REPOSITORY_COMPLETION_INVALID");
  }
  const session = analysisSessionSchema.parse({
    ...stored.session,
    status: "COMPLETED",
    updatedAt: event.occurredAt,
  });
  const revision = analysisRevisionSchema.parse({
    ...stored.currentRevision,
    status: status === "SUCCEEDED" ? "COMPLETED" : "PARTIAL",
  });
  const run = analysisRunSchema.parse({
    ...stored.currentRun,
    status,
    finishedAt: event.occurredAt,
  });
  const state = agUiSharedStateV03Schema.parse(
    JSON.parse(canonicalJson(stored.projection.state)),
  );
  state.analysis.session = session;
  state.analysis.revisionsById[revision.revisionId] = revision;
  state.analysis.runsById[run.runId] = run;
  state.meta.stateRevision += 1;
  state.meta.snapshotHash = calculateAgUiStateSnapshotHash(state);
  return { session, revision, run, state };
}

function nextProjection(
  current: AnalysisProjection,
  state: AgUiSharedStateV03,
  event: WsgsAnalysisEventEnvelope,
  applyToActivePlan: boolean,
): AnalysisProjection {
  const stateChanged =
    applyToActivePlan && event.eventType === "ANALYSIS_COMPLETED";
  const activity = stateChanged
    ? { ...current.activity, completion: event.payload }
    : current.activity;
  return analysisProjectionSchema.parse({
    ...current,
    stateRevision: current.stateRevision + (stateChanged ? 1 : 0),
    activityRevision: current.activityRevision + (stateChanged ? 1 : 0),
    state,
    stateHash: stateChanged ? hashCanonicalJson(state) : current.stateHash,
    activity,
    activityHash: stateChanged
      ? hashCanonicalJson(activity)
      : current.activityHash,
    lastEventSequence: event.sequence,
    updatedAt: event.occurredAt,
  });
}

async function waitForPump(
  runtime: AnalysisDevelopmentRuntime,
  scope: AnalysisScope,
  expected: "STOPPED" | "FAILED",
): Promise<
  NonNullable<ReturnType<AnalysisDevelopmentRuntime["getAnalysisPumpStatus"]>>
> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = runtime.getAnalysisPumpStatus(scope);
    if (status?.state === expected) return status;
    await flushTasks();
  }
  throw new Error(
    `TEST_PUMP_DID_NOT_REACH_${expected}:${JSON.stringify(runtime.getAnalysisPumpStatus(scope))}`,
  );
}

async function waitForCursor(
  repository: MemoryDevelopmentRepository,
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (repository.lastEventSequence === expected) return;
    await flushTasks();
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`TEST_REPOSITORY_DID_NOT_REACH_CURSOR_${expected}`);
}

async function flushTasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
