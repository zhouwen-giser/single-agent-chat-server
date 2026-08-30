import { describe, expect, it, jest } from "@jest/globals";
import { EventType } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";

import {
  projectAnalysisActivityDelta,
  projectAnalysisActivitySnapshot,
  projectAnalysisRunFinished,
  projectAnalysisRunInterrupted,
  projectAnalysisRunStarted,
  projectAnalysisStateDelta,
  projectAnalysisStateSnapshot,
} from "../packages/ag-ui-analysis-adapter/src/index.js";
import {
  AgUiV03HeadlessDecoder,
  AnalysisControlClient,
  HeadlessAnalysisReferenceClient,
  HeadlessMapEngineAdapter,
  createAnalysisReferenceClientState,
  reduceAnalysisClientEvent,
  type AnalysisControlTransport,
  type MapEngineAdapter,
} from "../packages/analysis-client/src/index.js";
import {
  analysisStateBody,
  analysisStateHash,
  v05Hash,
} from "./v05-analysis-fixtures.js";

const encoder = new EventEncoder({ accept: "text/event-stream" });

describe("headless v0.5 analysis reference client", () => {
  it("decodes official SSE incrementally and reduces revision-guarded state", () => {
    const decoder = new AgUiV03HeadlessDecoder();
    const firstState = analysisStateBody({
      threadId: "thread-1",
      focus: "vehicle-1",
    });
    const secondState = analysisStateBody({
      threadId: "thread-1",
      focus: "vehicle-2",
    });
    const snapshot = projectAnalysisStateSnapshot({
      stateRevision: 1,
      state: firstState,
    });
    const sse = encoder.encodeSSE(snapshot);
    const split = Math.floor(sse.length / 2);
    expect(decoder.push(sse.slice(0, split))).toEqual([]);
    const [decoded] = decoder.push(sse.slice(split));
    expect(decoded).toEqual(snapshot);

    let state = reduceAnalysisClientEvent(
      createAnalysisReferenceClientState(),
      decoded,
    ).state;
    const applied = reduceAnalysisClientEvent(
      state,
      projectAnalysisStateDelta({
        expectedStateRevision: 1,
        nextStateRevision: 2,
        nextSnapshotHash: analysisStateHash(2, secondState),
        operations: [
          {
            op: "replace",
            path: "/conversation/focus",
            value: "vehicle-2",
          },
        ],
      }),
    );
    state = applied.state;
    expect(applied.effects).toEqual([]);
    expect(state).toMatchObject({
      stateRevision: 2,
      sharedState: {
        conversation: { focus: "vehicle-2" },
        meta: { stateRevision: 2 },
      },
      needsFullStateSnapshot: false,
    });
  });

  it("does not apply a conflicting delta and requires a full snapshot", () => {
    const initial = reduceAnalysisClientEvent(
      createAnalysisReferenceClientState(),
      projectAnalysisStateSnapshot({
        stateRevision: 3,
        state: analysisStateBody({
          threadId: "thread-1",
          focus: "vehicle-1",
        }),
      }),
    ).state;
    const conflict = reduceAnalysisClientEvent(initial, {
      type: "STATE_DELTA",
      delta: [
        { op: "test", path: "/meta/stateRevision", value: 2 },
        {
          op: "replace",
          path: "/conversation/focus",
          value: "attacker-focus",
        },
        { op: "replace", path: "/meta/stateRevision", value: 3 },
      ],
    });

    expect(conflict.effects).toEqual(["REQUEST_FULL_STATE_SNAPSHOT"]);
    expect(conflict.state).toMatchObject({
      stateRevision: 3,
      sharedState: { conversation: { focus: "vehicle-1" } },
      needsFullStateSnapshot: true,
    });

    const refreshed = reduceAnalysisClientEvent(
      conflict.state,
      projectAnalysisStateSnapshot({
        stateRevision: 4,
        state: analysisStateBody({
          threadId: "thread-1",
          focus: "vehicle-3",
        }),
      }),
    );
    expect(refreshed.state).toMatchObject({
      stateRevision: 4,
      needsFullStateSnapshot: false,
    });
  });

  it("reduces activity snapshots and deltas without treating them as state authority", () => {
    let state = createAnalysisReferenceClientState();
    state = reduceAnalysisClientEvent(
      state,
      projectAnalysisActivitySnapshot({
        messageId: "activity-1",
        activityRevision: 1,
        content: { nodesById: { "node-1": { status: "RUNNING" } } },
      }),
    ).state;
    const updated = reduceAnalysisClientEvent(
      state,
      projectAnalysisActivityDelta({
        messageId: "activity-1",
        expectedActivityRevision: 1,
        nextActivityRevision: 2,
        patch: [
          {
            op: "replace",
            path: "/nodesById/node-1/status",
            value: "COMPLETED",
          },
        ],
      }),
    );
    expect(updated.effects).toEqual([]);
    expect(updated.state.activitiesByMessageId).toMatchObject({
      "activity-1": {
        activityRevision: 2,
        content: { nodesById: { "node-1": { status: "COMPLETED" } } },
      },
    });
    expect(updated.state.stateRevision).toBeUndefined();
  });

  it("retains independent activities and latches revision conflicts", () => {
    let state = createAnalysisReferenceClientState();
    for (const messageId of ["activity-1", "activity-2"]) {
      state = reduceAnalysisClientEvent(
        state,
        projectAnalysisActivitySnapshot({
          messageId,
          activityRevision: 1,
          content: { messageId },
        }),
      ).state;
    }
    const conflict = reduceAnalysisClientEvent(
      state,
      projectAnalysisActivityDelta({
        messageId: "activity-1",
        expectedActivityRevision: 2,
        nextActivityRevision: 3,
        patch: [{ op: "add", path: "/status", value: "COMPLETED" }],
      }),
    );

    expect(Object.keys(conflict.state.activitiesByMessageId)).toEqual([
      "activity-1",
      "activity-2",
    ]);
    expect(conflict.effects).toEqual(["REQUEST_FULL_ACTIVITY_SNAPSHOT"]);
    expect(conflict.state.needsFullActivitySnapshot).toBe(true);
  });

  it("rejects tampered snapshots and preserves interrupt lineage", () => {
    const snapshot = projectAnalysisStateSnapshot({
      stateRevision: 1,
      state: analysisStateBody({ threadId: "thread-1" }),
    });
    if (snapshot.type !== "STATE_SNAPSHOT") {
      throw new Error("Expected STATE_SNAPSHOT");
    }
    expect(() =>
      reduceAnalysisClientEvent(createAnalysisReferenceClientState(), {
        ...snapshot,
        snapshot: {
          ...snapshot.snapshot,
          meta: {
            ...(snapshot.snapshot as { meta: Record<string, unknown> }).meta,
            snapshotHash: v05Hash,
          },
        },
      }),
    ).toThrow();

    const initialRun = reduceAnalysisClientEvent(
      createAnalysisReferenceClientState(),
      projectAnalysisRunStarted({ threadId: "thread-1", runId: "run-1" }),
    ).state;
    expect(() =>
      reduceAnalysisClientEvent(initialRun, {
        type: EventType.RUN_FINISHED,
        threadId: "thread-1",
        runId: "run-1",
        outcome: {
          type: "interrupt",
          interrupts: [{ id: "intervention-1", reason: "AMBIGUITY" }],
        },
      }),
    ).toThrow("AG_UI_INTERRUPT_SNAPSHOTS_REQUIRED");

    let state = initialRun;
    for (const event of projectAnalysisRunInterrupted({
      identity: { threadId: "thread-1", runId: "run-1" },
      stateRevision: 1,
      state: analysisStateBody({ threadId: "thread-1" }),
      activityMessageId: "activity-1",
      activityRevision: 1,
      activity: { status: "WAITING_INTERVENTION" },
      interrupts: [{ id: "intervention-1", reason: "AMBIGUITY" }],
    })) {
      state = reduceAnalysisClientEvent(state, event).state;
    }
    expect(state).toMatchObject({
      runStatus: "INTERRUPTED",
      threadId: "thread-1",
      runId: "run-1",
      pendingInterrupts: [{ id: "intervention-1" }],
    });

    expect(() =>
      reduceAnalysisClientEvent(
        state,
        projectAnalysisRunStarted({
          threadId: "thread-1",
          runId: "run-invalid",
          parentRunId: "another-run",
        }),
      ),
    ).toThrow("AG_UI_INTERRUPT_RESUME_LINEAGE_INVALID");

    state = reduceAnalysisClientEvent(
      state,
      projectAnalysisRunStarted({
        threadId: "thread-1",
        runId: "run-2",
        parentRunId: "run-1",
      }),
    ).state;
    expect(state).toMatchObject({
      runStatus: "RUNNING",
      runId: "run-2",
      parentRunId: "run-1",
      pendingInterrupts: [],
    });
    expect(
      reduceAnalysisClientEvent(
        state,
        projectAnalysisRunFinished({
          threadId: "thread-1",
          runId: "run-1",
        }),
      ).state,
    ).toEqual(state);
  });

  it("resets partial SSE on reconnect and isolates map rendering failures", async () => {
    const snapshot = projectAnalysisStateSnapshot({
      stateRevision: 1,
      state: analysisStateBody({ threadId: "thread-1" }),
    });
    const encodedSnapshot = encoder.encodeSSE(snapshot);
    const client = new HeadlessAnalysisReferenceClient(
      new RejectingMapEngineAdapter(),
    );
    await client.acceptSseChunk(encodedSnapshot.slice(0, 17));
    await client.disconnect();
    expect(client.reconnect()).toEqual([
      "REQUEST_FULL_STATE_SNAPSHOT",
      "REQUEST_FULL_ACTIVITY_SNAPSHOT",
    ]);

    await expect(
      client.acceptSseChunk(
        encodedSnapshot +
          encoder.encodeSSE({
            type: EventType.TEXT_MESSAGE_CHUNK,
            messageId: "message-1",
            delta: "still reduced",
          }),
      ),
    ).resolves.toEqual([]);
    expect(client.state.textByMessageId).toEqual({
      "message-1": "still reduced",
    });
  });

  it("keeps map observation disconnect separate from explicit control calls", async () => {
    const send = jest.fn<AnalysisControlTransport["send"]>(async (request) => ({
      status: 200,
      body: { accepted: true, path: request.path },
    }));
    const control = new AnalysisControlClient({ send });
    const map = new HeadlessMapEngineAdapter();
    const client = new HeadlessAnalysisReferenceClient(map);
    const state = analysisStateBody();
    const snapshot = projectAnalysisStateSnapshot({
      stateRevision: 1,
      state: {
        ...state,
        map: { ...state.map, sceneRevision: 1 },
      },
    });
    await client.acceptSseChunk(encoder.encodeSSE(snapshot));
    expect(map.scenes).toEqual([
      {
        schemaVersion: "io.sacs/map-scene/v1",
        sceneRevision: 1,
        layersById: {},
        pinnedFocusById: {},
      },
    ]);

    await client.disconnect();
    expect(client.state.connected).toBe(false);
    expect(map.disconnected).toBe(true);
    expect(send).not.toHaveBeenCalled();

    await control.getAnalysis("analysis-1");
    await control.getSnapshot("analysis-1");
    await control.submitProposal("analysis-1", {
      commandId: "command-proposal",
      proposalId: "proposal-1",
      expectedRevisionId: "revision-1",
      expectedRevisionNumber: 1,
      targetNodeId: "node-1",
      publicArgsHash: v05Hash,
      editSchemaHash: v05Hash,
      patch: [{ op: "replace", path: "/radius", value: 600 }],
      mode: "SUGGEST_NEXT_REVISION",
      idempotencyKey: "proposal-key-1",
    });
    await control.resolveIntervention("analysis-1", "intervention-1", {
      commandId: "command-intervention",
      idempotencyKey: "intervention-key-1",
      response: { selection: "candidate-1" },
    });
    await control.cancelAnalysis("analysis-1", {
      commandId: "command-cancel",
      expectedRevisionId: "revision-1",
      expectedRevisionNumber: 1,
      idempotencyKey: "cancel-key-1",
      reason: "USER_REQUESTED",
    });
    expect(send.mock.calls.map(([request]) => request.path)).toEqual([
      "/api/v1/analyses/analysis-1",
      "/api/v1/analyses/analysis-1/snapshot",
      "/api/v1/analyses/analysis-1/proposals",
      "/api/v1/analyses/analysis-1/interventions/intervention-1:resolve",
      "/api/v1/analyses/analysis-1/cancel",
    ]);
    expect(
      send.mock.calls.slice(2).every(([request]) => {
        return (
          request.headers["idempotency-key"] === undefined &&
          typeof (request.body as { idempotencyKey?: unknown })
            .idempotencyKey === "string"
        );
      }),
    ).toBe(true);
  });
});

class RejectingMapEngineAdapter implements MapEngineAdapter {
  replaceScene(): Promise<void> {
    return Promise.reject(new Error("local map renderer failed"));
  }

  setInspectionFocus(): void {
    return undefined;
  }

  disconnect(): void {
    return undefined;
  }
}
