import { describe, expect, it } from "@jest/globals";
import { EventEncoder } from "@ag-ui/encoder";
import {
  createAnalysisReferenceClientState,
  reduceAnalysisClientEvent,
  HeadlessAnalysisReferenceClient,
  HeadlessMapEngineAdapter,
} from "../packages/analysis-client/src/index.js";
import {
  projectAnalysisStateSnapshot,
  projectAnalysisStateDelta,
  projectAnalysisActivitySnapshot,
  projectAnalysisActivityDelta,
  projectAnalysisRunStarted,
  projectAnalysisRunFinished,
} from "../packages/ag-ui-analysis-adapter/src/index.js";
import {
  createGroundingJobActivity,
  groundingActivityMessageId,
} from "../packages/analysis-contract/src/grounding-activity.js";
import type { AnalysisSourceStatus } from "../packages/analysis-contract/src/source.js";
import {
  analysisStateBody,
  analysisStateHash,
  v05Hash,
} from "./v05-analysis-fixtures.js";

const encoder = new EventEncoder({ accept: "text/event-stream" });
function body(number = 1, attempt = 1) {
  const state = analysisStateBody(),
    id = "revision-" + number;
  const revision = {
    ...state.analysis.revisionsById["revision-1"]!,
    revisionId: id,
    revisionNumber: number,
    source: {
      kind: "WSGS_GROUNDING_JOB" as const,
      sourceId: "grounding-" + number,
      sourceHash: v05Hash,
    },
  };
  const runId = "run-" + number + "-" + attempt;
  delete revision.wsgsPlanId;
  delete revision.planHash;
  revision.rerunNodeIds = [];
  const run = {
    ...state.analysis.runsById["run-1"]!,
    revisionId: id,
    runId,
    attempt,
  };
  state.analysis = {
    ...state.analysis,
    session: {
      ...state.analysis.session,
      activeRevisionId: id,
      latestRevisionNumber: number,
    },
    activeRevisionId: id,
    revisionsById: { [id]: revision },
    runsById: { [runId]: run },
  };
  return state;
}
const snapshot = (number: number, stateRevision: number, attempt = 1) =>
  projectAnalysisStateSnapshot({ stateRevision, state: body(number, attempt) });
function activity(
  number = 1,
  activityRevision = 1,
  sourceStatus: AnalysisSourceStatus = "RUNNING",
  cancelRequested = false,
) {
  const content = createGroundingJobActivity({
    groundingId: "grounding-" + number,
    analysisId: "analysis-1",
    revisionId: "revision-" + number,
    sourceStatus,
    cancelRequested,
    activityRevision,
  });
  return projectAnalysisActivitySnapshot({
    messageId: groundingActivityMessageId(content),
    activityType: "grounding.job",
    activityRevision,
    content,
  });
}
const messageId = (number = 1) =>
  groundingActivityMessageId({
    analysisId: "analysis-1",
    revisionId: "revision-" + number,
  });
const reduce = reduceAnalysisClientEvent;
function initialized(number = 1, sequence = 1, attempt = 1) {
  return reduce(
    createAnalysisReferenceClientState(),
    snapshot(number, sequence, attempt),
  ).state;
}
describe("Grounding recovery guards", () => {
  it("G08 an older Revision Activity cannot satisfy a new Revision interrupt snapshot requirement", () => {
    let state = reduce(
      createAnalysisReferenceClientState(),
      projectAnalysisRunStarted({ threadId: "thread-1", runId: "observer" }),
    ).state;
    state = reduce(state, snapshot(1, 1)).state;
    state = reduce(state, activity()).state;
    state = reduce(state, snapshot(2, 2)).state;
    expect(state.currentRunHasActivitySnapshot).toBe(false);
    const finished = {
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "observer",
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "choice", reason: "AMBIGUITY" }],
      },
    };
    expect(() => reduce(state, finished)).toThrow(
      "AG_UI_INTERRUPT_SNAPSHOTS_REQUIRED",
    );
    state = reduce(state, activity(2, 3, "AMBIGUOUS")).state;
    expect(reduce(state, finished).state.runStatus).toBe("INTERRUPTED");
  });
  it.each([
    "lower-counter",
    "equal-conflict",
    "old-revision",
    "old-attempt",
    "foreign-analysis",
    "source-rebind",
  ])(
    "G08 rejects %s full Snapshot and retains the last authoritative State",
    (kind) => {
      const current = initialized(2, 10, 2);
      let next = body(2, 2),
        sequence = 11;
      if (kind === "lower-counter") sequence = 9;
      if (kind === "equal-conflict") {
        sequence = 10;
        next.conversation = { threadId: "thread-1", injected: true };
      }
      if (kind === "old-revision") next = body(1, 3);
      if (kind === "old-attempt") next = body(2, 1);
      if (kind === "foreign-analysis") {
        next.analysis.session.analysisId = "foreign";
        next.analysis.revisionsById["revision-2"]!.analysisId = "foreign";
      }
      if (kind === "source-rebind")
        next.analysis.revisionsById["revision-2"]!.source = {
          kind: "WSGS_GROUNDING_JOB",
          sourceId: "another-job",
          sourceHash: v05Hash,
        };
      const result = reduce(
        current,
        projectAnalysisStateSnapshot({ stateRevision: sequence, state: next }),
      );
      expect(result.effects).toEqual(["REQUEST_FULL_STATE_SNAPSHOT"]);
      expect(result.state.sharedState).toEqual(current.sharedState);
      expect(result.state.stateRevision).toBe(10);
      expect(
        reduce(result.state, snapshot(2, 12, 2)).state.needsFullStateSnapshot,
      ).toBe(false);
    },
  );
  it("G08 a correctly hashed next-counter delta still cannot resurrect an old Revision", () => {
    const current = initialized(2, 10);
    const stale = body(1);
    const result = reduce(
      current,
      projectAnalysisStateDelta({
        expectedStateRevision: 10,
        nextStateRevision: 11,
        nextSnapshotHash: analysisStateHash(11, stale),
        operations: [
          { op: "replace", path: "/analysis", value: stale.analysis },
        ],
      }),
    );
    expect(result.effects).toEqual(["REQUEST_FULL_STATE_SNAPSHOT"]);
    expect(result.state.sharedState).toEqual(current.sharedState);
  });
  it("accepts an identical full snapshot and a forward skip, but not terminal attempt regression", () => {
    let current = initialized();
    expect(reduce(current, snapshot(1, 1)).effects).toEqual([]);
    const terminal = body();
    terminal.analysis.runsById["run-1-1"]!.status = "SUCCEEDED";
    current = reduce(
      current,
      projectAnalysisStateSnapshot({ stateRevision: 3, state: terminal }),
    ).state;
    expect(reduce(current, snapshot(1, 4)).effects).toEqual([
      "REQUEST_FULL_STATE_SNAPSHOT",
    ]);
    expect(reduce(current, snapshot(1, 5, 2)).effects).toEqual([]);
    expect(
      reduce(current, snapshot(2, 9)).state.sharedState?.analysis
        .activeRevisionId,
    ).toBe("revision-2");
  });
  it("G08 stale Activity snapshots cannot overwrite a current Revision or clear its recovery latch", () => {
    const current = reduce(initialized(2, 10), activity(2, 5)).state;
    for (const event of [
      activity(2, 4),
      activity(2, 5, "COMPLETED"),
      activity(1, 99),
    ]) {
      const result = reduce(current, event);
      expect(result.effects).toEqual(["REQUEST_FULL_ACTIVITY_SNAPSHOT"]);
      expect(result.state.activitiesByMessageId).toEqual(
        current.activitiesByMessageId,
      );
      expect(
        reduce(result.state, activity(1, 100)).state.needsFullActivitySnapshot,
      ).toBe(true);
      expect(
        reduce(result.state, activity(2, 6)).state.needsFullActivitySnapshot,
      ).toBe(false);
    }
  });
  it.each([
    { op: "replace", path: "/groundingId", value: "foreign" },
    { op: "replace", path: "/analysisId", value: "foreign" },
    { op: "replace", path: "/revisionId", value: "revision-2" },
    { op: "replace", path: "/status", value: "COMPLETED" },
    { op: "add", path: "/providerInternals", value: {} },
    { op: "add", path: "/progress", value: { completed: 5, total: 1 } },
  ] as const)(
    "G08 validates the entire patched Grounding Activity: $path",
    (patch) => {
      const current = reduce(initialized(), activity()).state;
      const result = reduce(
        current,
        projectAnalysisActivityDelta({
          messageId: messageId(),
          activityType: "grounding.job",
          expectedActivityRevision: 1,
          nextActivityRevision: 2,
          patch: [patch],
        }),
      );
      expect(result.effects).toEqual(["REQUEST_FULL_ACTIVITY_SNAPSHOT"]);
      expect(result.state.activitiesByMessageId).toEqual(
        current.activitiesByMessageId,
      );
      expect(result.state.sharedState).toEqual(current.sharedState);
    },
  );
  it("G10 uncertainty stays CANCEL_REQUESTED; only a matching terminal source can settle it", () => {
    let current = reduce(initialized(), activity()).state;
    current = reduce(
      current,
      projectAnalysisActivityDelta({
        messageId: messageId(),
        activityType: "grounding.job",
        expectedActivityRevision: 1,
        nextActivityRevision: 2,
        patch: [{ op: "replace", path: "/status", value: "CANCEL_REQUESTED" }],
      }),
    ).state;
    expect(current.activitiesByMessageId[messageId()]?.content["status"]).toBe(
      "CANCEL_REQUESTED",
    );
    expect(reduce(current, activity(1, 3)).effects).toEqual([
      "REQUEST_FULL_ACTIVITY_SNAPSHOT",
    ]);
    const terminal = reduce(current, activity(1, 4, "CANCELLED"));
    expect(terminal.effects).toEqual([]);
    expect(
      terminal.state.activitiesByMessageId[messageId()]?.content["status"],
    ).toBe("CANCELLED");
    expect(terminal.state.sharedState).toEqual(current.sharedState);
    expect(reduce(terminal.state, activity(1, 5)).effects).toEqual([
      "REQUEST_FULL_ACTIVITY_SNAPSHOT",
    ]);
  });
  it("accepts a valid terminal delta but preserves the original UNRESOLVED source status", () => {
    const current = reduce(initialized(), activity()).state;
    const completed = reduce(
      current,
      projectAnalysisActivityDelta({
        messageId: messageId(),
        activityType: "grounding.job",
        expectedActivityRevision: 1,
        nextActivityRevision: 2,
        patch: [
          { op: "replace", path: "/status", value: "COMPLETED" },
          { op: "replace", path: "/sourceStatus", value: "COMPLETED" },
        ],
      }),
    );
    expect(completed.effects).toEqual([]);
    expect(
      completed.state.activitiesByMessageId[messageId()]?.content["status"],
    ).toBe("COMPLETED");
    const unresolved = reduce(
      initialized(),
      activity(1, 1, "UNRESOLVED"),
    ).state;
    expect(reduce(unresolved, activity(1, 2, "PARTIAL")).effects).toEqual([
      "REQUEST_FULL_ACTIVITY_SNAPSHOT",
    ]);
  });
  it("G09 old transport callbacks and partially decoded bytes cannot affect the new observer", async () => {
    const client = new HeadlessAnalysisReferenceClient(
      new HeadlessMapEngineAdapter(),
    );
    const generation = client.observationGeneration;
    await client.acceptSseChunk(encoder.encodeSSE(snapshot(1, 1)), generation);
    await client.acceptSseChunk("data: {", generation);
    await client.disconnect();
    client.reconnect();
    const fresh = client.observationGeneration;
    expect(fresh).not.toBe(generation);
    const before = client.state;
    await client.acceptSseChunk('"type":"RUN_ERROR"}\n\n', generation);
    await client.finishStream(generation);
    expect(client.state).toEqual(before);
    await client.acceptSseChunk(
      encoder.encodeSSE(snapshot(1, 2)) + encoder.encodeSSE(activity()),
      fresh,
    );
    expect(client.state).toMatchObject({
      stateRevision: 2,
      needsFullStateSnapshot: false,
      needsFullActivitySnapshot: false,
    });
    await client.acceptSseChunk(encoder.encodeSSE(snapshot(1, 99)), generation);
    expect(client.state.stateRevision).toBe(2);
  });
  it("deduplicates old/duplicate Run starts without resetting accumulated observation", () => {
    const start = projectAnalysisRunStarted({
      threadId: "thread-1",
      runId: "observer-1",
    });
    let state = reduce(createAnalysisReferenceClientState(), start).state;
    state = reduce(state, snapshot(1, 1)).state;
    expect(reduce(state, start).state).toEqual(state);
    expect(() =>
      reduce(
        state,
        projectAnalysisRunStarted({ threadId: "thread-1", runId: "other" }),
      ),
    ).toThrow("AG_UI_RUN_ALREADY_ACTIVE");
    state = reduce(
      state,
      projectAnalysisRunFinished({ threadId: "thread-1", runId: "observer-1" }),
    ).state;
    state = reduce(
      state,
      projectAnalysisRunStarted({ threadId: "thread-1", runId: "observer-2" }),
    ).state;
    expect(reduce(state, start).state).toEqual(state);
  });
});
