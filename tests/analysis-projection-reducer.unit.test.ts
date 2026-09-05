import { describe, expect, it } from "@jest/globals";

import type {
  AnalysisEvent,
  AnalysisRevision,
  AnalysisRun,
  AnalysisSession,
} from "../packages/analysis-contract/src/index.js";
import {
  createInitialAnalysisProjection,
  reduceAnalysisProjection,
} from "../packages/analysis-runtime/src/projection-reducer.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";

const now = "2026-08-30T00:00:00.000Z";
const hash = `sha256:${"1".repeat(64)}`;

describe("v0.5 analysis projection reducer", () => {
  it("projects plan and node state with independent state/activity revisions", () => {
    let projection = initial();
    const plan = reduceAnalysisProjection(
      projection,
      event(1, "analysis.plan.published", {
        plan: { planId: "plan-1", planHash: hash, nodes: [], edges: [] },
      }),
    );
    projection = plan.projection;
    expect(plan).toMatchObject({
      stateChanged: true,
      activityChanged: true,
      auditOnly: false,
    });
    expect(projection.stateRevision).toBe(1);
    expect(projection.activityRevision).toBe(1);
    expect(projection.state).toMatchObject({
      meta: { stateRevision: 1 },
      analysis: {
        activeRevisionId: "revision-1",
        revisionsById: {
          "revision-1": { wsgsPlanId: "plan-1", planHash: hash },
        },
      },
    });

    const node = reduceAnalysisProjection(
      projection,
      event(2, "analysis.node.state", {
        node: {
          schemaVersion: "sacs-analysis-node-state/1.0",
          nodeId: "node-1",
          executionStatus: "RUNNING",
          relevanceStatus: "ACTIVE",
          currentness: "CURRENT",
          inputLayerIds: [],
          outputLayerIds: [],
          findingIds: [],
        },
      }),
    );
    expect(node.projection).toMatchObject({
      stateRevision: 2,
      activityRevision: 2,
      lastEventSequence: 2,
      state: {
        analysis: {
          nodesById: { "node-1": { executionStatus: "RUNNING" } },
        },
      },
    });
  });

  it("keeps late old-revision events audit-only", () => {
    const projection = initial();
    const late = reduceAnalysisProjection(
      projection,
      event(1, "analysis.run.status", { status: "FAILED" }, "revision-old"),
    );
    expect(late).toMatchObject({
      stateChanged: false,
      activityChanged: false,
      auditOnly: true,
      projection: {
        stateRevision: 0,
        activityRevision: 0,
        lastEventSequence: 1,
      },
    });
    expect(late.projection.state).toEqual(projection.state);
  });

  it("audits unknown internal events without inventing progress", () => {
    const projection = initial();
    const unknown = reduceAnalysisProjection(
      projection,
      event(1, "analysis.future.event", { opaque: true }),
    );
    expect(unknown.auditOnly).toBe(true);
    expect(unknown.projection.stateHash).toBe(projection.stateHash);
    expect(unknown.projection.activityHash).toBe(projection.activityHash);
  });

  it("rejects payload and sequence corruption before projection", () => {
    const projection = initial();
    const corrupted = event(1, "analysis.run.status", { status: "RUNNING" });
    expect(() =>
      reduceAnalysisProjection(projection, {
        ...corrupted,
        payloadHash: `sha256:${"f".repeat(64)}`,
      }),
    ).toThrow("ANALYSIS_EVENT_PAYLOAD_HASH_MISMATCH");
    expect(() =>
      reduceAnalysisProjection(
        projection,
        event(2, "analysis.run.status", { status: "RUNNING" }),
      ),
    ).toThrow("ANALYSIS_EVENT_SEQUENCE_NOT_NEXT");
  });
});

function initial() {
  return createInitialAnalysisProjection({
    session: session(),
    revision: revision(),
    run: run(),
    createdAt: now,
  });
}

function event(
  sequence: number,
  eventType: string,
  payload: Record<string, unknown>,
  revisionId = "revision-1",
): AnalysisEvent {
  return {
    schemaVersion: "sacs-analysis-event/1.0",
    eventId: `event-${sequence}`,
    analysisId: "analysis-1",
    revisionId,
    runId: "run-1",
    analysisSequence: sequence,
    runSequence: sequence,
    eventType,
    correlationId: "correlation-1",
    occurredAt: now,
    payload,
    payloadHash: hashCanonicalJson(payload),
  };
}

function session(): AnalysisSession {
  return {
    schemaVersion: "sacs-analysis-session/1.0",
    analysisId: "analysis-1",
    principalId: "principal-1",
    threadId: "thread-1",
    groundingId: "grounding-1",
    title: "Analysis",
    autonomyMode: "OBSERVER",
    status: "ACTIVE",
    activeRevisionId: "revision-1",
    latestRevisionNumber: 1,
    observerPolicyHash: hash,
    createdAt: now,
    updatedAt: now,
  };
}

function revision(): AnalysisRevision {
  return {
    schemaVersion: "sacs-analysis-revision/1.0",
    revisionId: "revision-1",
    analysisId: "analysis-1",
    revisionNumber: 1,
    cause: "INITIAL_QUERY",
    wsgsPlanId: "plan-1",
    planHash: hash,
    changedPaths: [],
    reusedNodeIds: [],
    invalidatedNodeIds: [],
    rerunNodeIds: ["node-1"],
    status: "RUNNING",
    createdAt: now,
  };
}

function run(): AnalysisRun {
  return {
    schemaVersion: "sacs-analysis-run/1.0",
    runId: "run-1",
    revisionId: "revision-1",
    attempt: 1,
    upstreamRunId: "upstream-run-1",
    status: "RUNNING",
    startedAt: now,
  };
}
