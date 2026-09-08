import { describe, expect, it } from "@jest/globals";
import { EventType, type AGUIEvent } from "@ag-ui/core";

import {
  createAnalysisDevelopmentAgUiRunHandler,
  parseAnalysisDevelopmentDirective,
  type AnalysisDevelopmentRuntimePort,
  type AnalysisDevelopmentStartResult,
} from "../apps/server/src/v05-analysis-development.js";
import { SACS_AG_UI_V03_PROFILE_ID } from "../packages/ag-ui-api-contract/src/index.js";
import { createUnavailableAnalysisControlService } from "../packages/analysis-control-runtime/src/index.js";
import type { AnalysisProjection } from "../packages/analysis-contract/src/index.js";
import { FixtureWsgsAnalysisAdapter } from "../packages/wsgs-analysis-adapter/src/index.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";
import {
  analysisStateBody,
  analysisStateHash,
  v05Now,
} from "./v05-analysis-fixtures.js";

describe("v0.5 analysis development composition", () => {
  it("accepts only the explicit development directive", () => {
    expect(
      parseAnalysisDevelopmentDirective({
        analysisId: "analysis-1",
        groundingId: "grounding-1",
        scenario: "SUCCESS",
        mode: "START",
      }),
    ).toEqual({
      analysisId: "analysis-1",
      groundingId: "grounding-1",
      scenario: "SUCCESS",
      mode: "START",
    });
    expect(() =>
      parseAnalysisDevelopmentDirective({
        analysisId: "analysis-1",
        groundingId: "grounding-1",
        scenario: "SUCCESS",
        mode: "START",
        publicArgs: { radiusMeters: 9_999 },
      }),
    ).toThrow();
    expect(() =>
      parseAnalysisDevelopmentDirective({
        analysisId: "analysis-1",
        groundingId: "grounding-1",
        scenario: "SUCCESS",
        mode: "EXECUTE_PUBLIC_ARGS",
      }),
    ).toThrow();
  });

  it("runs a read-only fixture analysis with official progressive events", async () => {
    const fixture = await createRuntimeFixture();
    const handler = createAnalysisDevelopmentAgUiRunHandler(fixture.runtime);
    const events = await collect(
      handler(
        runContext({
          analysisId: "analysis-1",
          groundingId: "grounding-1",
          scenario: "SUCCESS",
          mode: "START",
        }),
      ),
    );

    expect(events.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        EventType.RUN_STARTED,
        EventType.STATE_SNAPSHOT,
        EventType.ACTIVITY_SNAPSHOT,
        EventType.STEP_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TOOL_CALL_RESULT,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_END,
        EventType.STEP_FINISHED,
        EventType.RUN_FINISHED,
      ]),
    );
    expect(fixture.startInputs).toEqual([
      {
        analysisId: "analysis-1",
        groundingId: "grounding-1",
        principalId: "principal-1",
        threadId: "thread-1",
        title: "Fixture analysis analysis-1",
        scenario: "SUCCESS",
        runId: "run-1",
      },
    ]);
    expect(fixture.observeCount).toBe(1);
    expect(fixture.projectionCount).toBe(0);
  });

  it("returns a durable terminal reconnect without opening an observer", async () => {
    const fixture = await createRuntimeFixture();
    const handler = createAnalysisDevelopmentAgUiRunHandler(fixture.runtime);
    const events = await collect(
      handler(
        runContext({
          analysisId: "analysis-1",
          groundingId: "grounding-1",
          scenario: "SUCCESS",
          mode: "RECONNECT",
        }),
      ),
    );

    expect(events.map(({ type }) => type)).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.ACTIVITY_SNAPSHOT,
      EventType.RUN_FINISHED,
    ]);
    expect(fixture.startInputs).toHaveLength(0);
    expect(fixture.ensureCount).toBe(1);
    expect(fixture.observeCount).toBe(0);
    expect(fixture.projectionCount).toBe(1);
    expect(fixture.reconnectCalls).toEqual([
      "getProjection",
      "ensureAnalysisPump",
    ]);
  });

  it("ensures an active reconnect pump before attaching its observer", async () => {
    const fixture = await createRuntimeFixture({ terminal: false });
    const handler = createAnalysisDevelopmentAgUiRunHandler(fixture.runtime);
    const events = await collect(
      handler(
        runContext({
          analysisId: "analysis-1",
          groundingId: "grounding-1",
          scenario: "SUCCESS",
          mode: "RECONNECT",
        }),
      ),
    );

    expect(events.map(({ type }) => type)).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.ACTIVITY_SNAPSHOT,
      EventType.RUN_FINISHED,
    ]);
    expect(fixture.ensureCount).toBe(1);
    expect(fixture.observeCount).toBe(1);
    expect(fixture.reconnectCalls).toEqual([
      "getProjection",
      "ensureAnalysisPump",
      "observeAnalysis",
    ]);
  });

  it("rejects extra forwarded publicArgs before any runtime call", async () => {
    const fixture = await createRuntimeFixture();
    const handler = createAnalysisDevelopmentAgUiRunHandler(fixture.runtime);

    await expect(
      collect(
        handler(
          runContext({
            analysisId: "analysis-1",
            groundingId: "grounding-1",
            scenario: "SUCCESS",
            mode: "START",
            publicArgs: { radiusMeters: 7_500 },
          }),
        ),
      ),
    ).rejects.toThrow();
    expect(fixture.startInputs).toHaveLength(0);
    expect(fixture.observeCount).toBe(0);
    expect(fixture.projectionCount).toBe(0);
  });
});

async function createRuntimeFixture(
  options: { readonly terminal?: boolean } = {},
) {
  const terminal = options.terminal ?? true;
  const initialBody = analysisStateBody();
  const initialRun = initialBody.analysis.runsById["run-1"];
  if (initialRun === undefined) throw new Error("fixture run missing");
  const initialRevision =
    initialBody.analysis.revisionsById[
      initialBody.analysis.session.activeRevisionId
    ];
  if (initialRevision === undefined)
    throw new Error("fixture revision missing");
  const body = terminal
    ? {
        ...initialBody,
        analysis: {
          ...initialBody.analysis,
          session: {
            ...initialBody.analysis.session,
            status: "COMPLETED" as const,
          },
          revisionsById: {
            [initialRevision.revisionId]: {
              ...initialRevision,
              status: "COMPLETED" as const,
            },
          },
          runsById: {
            "run-1": {
              ...initialRun,
              status: "SUCCEEDED" as const,
              finishedAt: v05Now,
            },
          },
        },
      }
    : initialBody;
  const state = {
    ...body,
    meta: {
      stateRevision: 1,
      snapshotHash: analysisStateHash(1, body),
    },
  };
  const activity = {
    schemaVersion: "io.sacs/analysis-activity/v1",
    plan: null,
    nodesById: {},
  };
  const projection: AnalysisProjection = {
    schemaVersion: "sacs-analysis-projection/1.0",
    analysisId: "analysis-1",
    stateRevision: 1,
    activityRevision: 1,
    state,
    stateHash: hashCanonicalJson(state),
    activity,
    activityHash: hashCanonicalJson(activity),
    lastEventSequence: 0,
    updatedAt: v05Now,
  };
  const session = state.analysis.session;
  const revision = state.analysis.revisionsById[session.activeRevisionId];
  const run = state.analysis.runsById["run-1"];
  if (revision === undefined || run === undefined) {
    throw new Error("fixture lineage missing");
  }
  const adapter = new FixtureWsgsAnalysisAdapter({
    environment: {
      NODE_ENV: "test",
      SACS_ANALYSIS_ADAPTER_MODE: "fixture",
    },
  });
  const sourceSnapshot = await adapter.getAnalysisSnapshot("grounding-1");
  const started: AnalysisDevelopmentStartResult = {
    session,
    revision,
    run,
    projection,
    sourceSnapshot,
  };
  const startInputs: unknown[] = [];
  let observeCount = 0;
  let projectionCount = 0;
  let ensureCount = 0;
  const reconnectCalls: string[] = [];
  const runtime: AnalysisDevelopmentRuntimePort = {
    analysisControl: createUnavailableAnalysisControlService(),
    async startAnalysis(input) {
      startInputs.push(input);
      return started;
    },
    async getSnapshot() {
      return state;
    },
    async getProjection() {
      projectionCount += 1;
      reconnectCalls.push("getProjection");
      return projection;
    },
    async ensureAnalysisPump(scope) {
      ensureCount += 1;
      reconnectCalls.push("ensureAnalysisPump");
      return {
        ...scope,
        state: terminal ? "STOPPED" : "RUNNING",
        lastEventSequence: projection.lastEventSequence,
        subscriptionCount: terminal ? 0 : 1,
        ...(terminal ? { stopReason: "DURABLE_TERMINAL" as const } : {}),
      };
    },
    observeAnalysis() {
      observeCount += 1;
      reconnectCalls.push("observeAnalysis");
      return emptyObservations();
    },
  };
  return {
    runtime,
    startInputs,
    get observeCount() {
      return observeCount;
    },
    get ensureCount() {
      return ensureCount;
    },
    get projectionCount() {
      return projectionCount;
    },
    reconnectCalls,
  };
}

async function* emptyObservations(): AsyncGenerator<never> {
  yield* [] as never[];
}

function runContext(forwardedProps: unknown) {
  return {
    input: {
      threadId: "external-thread-1",
      runId: "run-1",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps,
    },
    principalId: "principal-1",
    internalThreadId: "thread-1",
    signal: new AbortController().signal,
    profile: SACS_AG_UI_V03_PROFILE_ID,
    disconnectSemantics: "DETACH_OBSERVER" as const,
  };
}

async function collect(events: AsyncIterable<AGUIEvent>): Promise<AGUIEvent[]> {
  const result: AGUIEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
