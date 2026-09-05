import { describe, expect, it } from "@jest/globals";

import { toolInteractionDescriptorSchema } from "../packages/analysis-contract/src/index.js";
import {
  FIXTURE_WSGS_ANALYSIS_MANIFEST,
  FIXTURE_WSGS_ANALYSIS_SUPPORT,
  FixtureWsgsAnalysisAdapter,
  HttpWsgsAnalysisAdapter,
  WsgsAnalysisAdapterError,
  createFixtureWsgsAnalysisAdapter,
  createHttpWsgsAnalysisAdapter,
  type WsgsAnalysisAdapter,
  type WsgsCompileRevisionRequest,
} from "../packages/wsgs-analysis-adapter/src/index.js";
import {
  calculateCanonicalJsonHash,
  parseWsgsAnalysisEventEnvelope,
  WSGS_ANALYSIS_HANDOFF_NOT_READY,
  type WsgsAnalysisEventEnvelope,
} from "../packages/wsgs-analysis-consumer/src/index.js";

const fixtureEnvironment = {
  NODE_ENV: "test",
  SACS_ANALYSIS_ADAPTER_MODE: "fixture",
} as const;

describe("v0.5 stable WSGS analysis adapter", () => {
  it("fails closed outside an explicitly selected development fixture mode", () => {
    for (const environment of [
      {
        NODE_ENV: "production",
        SACS_ANALYSIS_ADAPTER_MODE: "fixture",
      },
      { NODE_ENV: "test", SACS_ANALYSIS_ADAPTER_MODE: "http" },
      {
        NODE_ENV: "local-compose",
        SACS_ANALYSIS_ADAPTER_MODE: "fixture",
      },
      {},
    ]) {
      expect(() => new FixtureWsgsAnalysisAdapter({ environment })).toThrow(
        "FIXTURE_WSGS_ANALYSIS_ADAPTER_FORBIDDEN",
      );
    }

    const adapter = createFixtureWsgsAnalysisAdapter({
      environment: fixtureEnvironment,
    });
    const stablePort: WsgsAnalysisAdapter = adapter;
    expect(stablePort.productionEligible).toBe(false);
    expect(adapter.manifest).toBe(FIXTURE_WSGS_ANALYSIS_MANIFEST);
    expect(adapter.manifest).toEqual({
      schemaVersion: "sacs-v05-fixture-adapter/1.0",
      adapterId: "FixtureWsgsAnalysisAdapter",
      environmentEligibility: ["test", "development", "local-compose"],
      supports: FIXTURE_WSGS_ANALYSIS_SUPPORT,
      productionEligible: false,
    });
    expect(Object.isFrozen(adapter.manifest)).toBe(true);
  });

  it("materializes a deterministic plan, server-owned tool descriptor, and replayable events", async () => {
    const first = fixture();
    const second = fixture();
    const firstSnapshot = await first.getAnalysisSnapshot("grounding-1");
    const secondSnapshot = await second.getAnalysisSnapshot("grounding-1");

    expect(firstSnapshot).toEqual(secondSnapshot);
    expect(firstSnapshot).toEqual(
      expect.objectContaining({
        schemaVersion: "sacs-wsgs-analysis-plan/1.0",
        scenario: "SUCCESS",
        status: "RUNNING",
        nodeIds: ["reference", "query", "explanation"],
      }),
    );
    expect(firstSnapshot.toolInteractions).toHaveLength(1);
    expect(() =>
      toolInteractionDescriptorSchema.parse(firstSnapshot.toolInteractions[0]),
    ).not.toThrow();
    expect(firstSnapshot.toolInteractions[0]).toEqual(
      expect.objectContaining({
        nodeId: "query",
        operationKey: "fixture.geospatial.query",
        publicArgs: { radiusMeters: 500, relation: "near" },
      }),
    );
    expect(Object.isFrozen(firstSnapshot)).toBe(true);

    const events = await collect(first.subscribeAnalysisEvents("grounding-1"));
    expect(events.map((event) => event.eventType)).toEqual([
      "PLAN_PUBLISHED",
      "NODE_READY",
      "NODE_STARTED",
      "NODE_READY",
      "NODE_STARTED",
      "TOOL_INTERACTION_PUBLISHED",
      "TOOL_COMPLETED",
      "FINDING_AVAILABLE",
      "ANALYSIS_COMPLETED",
    ]);
    for (const event of events) {
      expect(parseWsgsAnalysisEventEnvelope(event)).toEqual(event);
      expect(event.payloadHash).toBe(calculateCanonicalJsonHash(event.payload));
      expect(event.planHash).toBe(firstSnapshot.planHash);
    }

    const replay = await collect(
      first.subscribeAnalysisEvents("grounding-1", 7),
    );
    expect(replay.map((event) => event.sequence)).toEqual([8, 9]);
    expect(first.getCounters()).toEqual({
      commands: {
        PLAN: 1,
        EVENTS: 2,
        COMPILE_REVISION: 0,
        CANCEL: 0,
        INTERVENTION: 0,
      },
      executions: {
        PLAN: 1,
        EVENTS: 1,
        COMPILE_REVISION: 0,
        CANCEL: 0,
        INTERVENTION: 0,
      },
      eventDeliveries: 11,
      toolExecutions: 1,
      dataGapCompletions: 0,
      clientPublicArgsExecutions: 0,
    });
  });

  it("represents DATA_GAP as unknown and completes without an intervention", async () => {
    const adapter = fixture();
    adapter.configureScenario("grounding-gap", "DATA_GAP");
    const snapshot = await adapter.getAnalysisSnapshot("grounding-gap");
    const events = await collect(
      adapter.subscribeAnalysisEvents("grounding-gap"),
    );

    expect(snapshot.scenario).toBe("DATA_GAP");
    expect(
      events.some((event) => event.eventType === "INTERVENTION_REQUIRED"),
    ).toBe(false);
    expect(eventOfType(events, "FINDING_AVAILABLE").payload).toEqual({
      finding: {
        status: "NO_DATA",
        gapKind: "DATA_GAP",
        reasonCode: "PRODUCT_NOT_AVAILABLE",
        truthValue: "UNKNOWN",
        falseClaimPrevented: true,
      },
    });
    expect(eventOfType(events, "ANALYSIS_COMPLETED").payload).toEqual({
      status: "PARTIAL",
      terminalGap: "DATA_GAP",
      truthValue: "UNKNOWN",
      interruptRequired: false,
    });

    await collect(
      adapter.subscribeAnalysisEvents("grounding-gap", events.at(-1)?.sequence),
    );
    expect(adapter.getCounters()).toEqual(
      expect.objectContaining({
        toolExecutions: 1,
        dataGapCompletions: 1,
        clientPublicArgsExecutions: 0,
      }),
    );
    expect(adapter.getCounters().executions.EVENTS).toBe(1);
  });

  it("compiles immutable fixture revisions without executing client publicArgs", async () => {
    const adapter = fixture();
    const snapshot = await adapter.getAnalysisSnapshot("grounding-compile");
    const request: WsgsCompileRevisionRequest = {
      analysisId: "analysis-1",
      commandId: "command-compile-1",
      idempotencyKey: "compile-key-1",
      parentPlanId: snapshot.planId,
      parentPlanHash: snapshot.planHash,
      parentRevisionNumber: snapshot.planRevision,
      changedPaths: ["/radiusMeters"],
      publicArgs: { radiusMeters: 750, relation: "within" },
    };
    const first = await adapter.compileRevision(request);
    const replay = await adapter.compileRevision(request);

    expect(replay).toBe(first);
    expect(first).toEqual(
      expect.objectContaining({
        upstreamAnalysisId: snapshot.upstreamAnalysisId,
        parentPlanId: snapshot.planId,
        parentPlanHash: snapshot.planHash,
        planRevision: 1,
        nodeIds: ["reference", "query", "explanation"],
        reusedNodeIds: ["reference"],
        invalidatedNodeIds: [],
        rerunNodeIds: ["query", "explanation"],
      }),
    );
    expect(first.planId).not.toBe(snapshot.planId);
    expect(first.planHash).not.toBe(snapshot.planHash);

    await expect(
      adapter.compileRevision({
        ...request,
        publicArgs: { radiusMeters: 900, relation: "within" },
      }),
    ).rejects.toThrow("FIXTURE_COMPILE_IDEMPOTENCY_CONFLICT");
    await expect(
      adapter.compileRevision({
        ...request,
        idempotencyKey: "compile-key-reused-command",
      }),
    ).rejects.toThrow("FIXTURE_COMPILE_IDEMPOTENCY_CONFLICT");
    await expect(
      adapter.compileRevision({
        ...request,
        commandId: "command-reused-idempotency-key",
      }),
    ).rejects.toThrow("FIXTURE_COMPILE_IDEMPOTENCY_CONFLICT");

    let getterExecutions = 0;
    const publicArgs: Record<string, unknown> = {};
    Object.defineProperty(publicArgs, "radiusMeters", {
      enumerable: true,
      get() {
        getterExecutions += 1;
        return 1;
      },
    });
    await expect(
      adapter.compileRevision({ ...request, publicArgs }),
    ).rejects.toThrow("FIXTURE_PUBLIC_ARGS_INVALID");
    expect(getterExecutions).toBe(0);
    expect(adapter.getCounters()).toEqual(
      expect.objectContaining({ clientPublicArgsExecutions: 0 }),
    );
    expect(adapter.getCounters().commands.COMPILE_REVISION).toBe(6);
    expect(adapter.getCounters().executions.COMPILE_REVISION).toBe(1);
  });

  it("acknowledges cancellation and resumes a known ambiguity idempotently", async () => {
    const adapter = fixture();
    adapter.configureScenario("grounding-ambiguity", "AMBIGUITY");
    const snapshot = await adapter.getAnalysisSnapshot("grounding-ambiguity");
    const events = await collect(
      adapter.subscribeAnalysisEvents("grounding-ambiguity"),
    );
    const required = eventOfType(events, "INTERVENTION_REQUIRED");
    const interventionId = required.payload["interventionId"];
    const interruptId = required.payload["interruptId"];
    expect(typeof interventionId).toBe("string");
    expect(typeof interruptId).toBe("string");

    const interventionRequest = {
      analysisId: "analysis-1",
      interventionId: interventionId as string,
      interruptId: interruptId as string,
      commandId: "command-intervention-1",
      idempotencyKey: "intervention-key-1",
      response: { selectedCandidateId: "fixture-candidate-a" },
    };
    const resolution = await adapter.resolveIntervention(interventionRequest);
    expect(await adapter.resolveIntervention(interventionRequest)).toBe(
      resolution,
    );
    expect(resolution).toEqual(
      expect.objectContaining({
        accepted: true,
        parentUpstreamRunId: snapshot.upstreamRunId,
      }),
    );

    const cancelRequest = {
      analysisId: "analysis-1",
      revisionId: "revision-1",
      upstreamRunId: resolution.upstreamRunId,
      commandId: "command-cancel-1",
      idempotencyKey: "cancel-key-1",
      reason: "USER_REQUESTED" as const,
    };
    const cancelled = await adapter.cancelRun(cancelRequest);
    expect(await adapter.cancelRun(cancelRequest)).toBe(cancelled);
    expect(cancelled).toEqual({
      supported: true,
      acknowledged: true,
      upstreamRunId: resolution.upstreamRunId,
    });
    expect(adapter.getCounters().commands).toEqual(
      expect.objectContaining({ INTERVENTION: 2, CANCEL: 2 }),
    );
    expect(adapter.getCounters().executions).toEqual(
      expect.objectContaining({ INTERVENTION: 1, CANCEL: 1 }),
    );
    expect(adapter.getCounters().toolExecutions).toBe(0);
  });

  it("exports an explicit route-free HTTP readiness boundary", () => {
    expect(HttpWsgsAnalysisAdapter.availability).toBe("UNAVAILABLE");
    expect(() => new HttpWsgsAnalysisAdapter()).toThrow(
      WSGS_ANALYSIS_HANDOFF_NOT_READY,
    );
    expect(createHttpWsgsAnalysisAdapter).toThrow(
      WSGS_ANALYSIS_HANDOFF_NOT_READY,
    );
    try {
      createHttpWsgsAnalysisAdapter();
    } catch (error) {
      expect(error).toBeInstanceOf(WsgsAnalysisAdapterError);
    }
  });
});

function fixture(): FixtureWsgsAnalysisAdapter {
  return new FixtureWsgsAnalysisAdapter({ environment: fixtureEnvironment });
}

async function collect(
  source: AsyncIterable<WsgsAnalysisEventEnvelope>,
): Promise<WsgsAnalysisEventEnvelope[]> {
  const events: WsgsAnalysisEventEnvelope[] = [];
  for await (const event of source) events.push(event);
  return events;
}

function eventOfType(
  events: readonly WsgsAnalysisEventEnvelope[],
  eventType: WsgsAnalysisEventEnvelope["eventType"],
): WsgsAnalysisEventEnvelope {
  const event = events.find((candidate) => candidate.eventType === eventType);
  if (event === undefined)
    throw new Error(`missing fixture event ${eventType}`);
  return event;
}
