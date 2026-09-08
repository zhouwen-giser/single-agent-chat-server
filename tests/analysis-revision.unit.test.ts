import { describe, expect, it, jest } from "@jest/globals";

import type {
  AnalysisRevision,
  AnalysisRun,
} from "../packages/analysis-contract/src/index.js";
import {
  compileImmutableRevision,
  requestAnalysisRunCancellation,
  validateCompileResult,
  type WsgsCompileRevisionResult,
} from "../packages/analysis-runtime/src/revision-coordinator.js";

const hash1 = `sha256:${"1".repeat(64)}`;
const hash2 = `sha256:${"2".repeat(64)}`;
const now = "2026-08-30T00:00:00.000Z";

describe("v0.5 immutable analysis revision coordination", () => {
  it("accepts only WSGS-supplied reuse/invalidate/rerun sets", async () => {
    const compileRevision = jest.fn(async () => compileResult());
    const revision = await compileImmutableRevision(
      { compileRevision },
      {
        analysisId: "analysis-1",
        revisionId: "revision-2",
        commandId: "command-proposal-1",
        idempotencyKey: "proposal-key-1",
        currentRevision: currentRevision(),
        parentRunId: "run-1",
        cause: "USER_PROPOSAL",
        changedPaths: ["/radiusMeters"],
        patchedPublicArgs: { radiusMeters: 600 },
        mode: "SUGGEST_NEXT_REVISION",
        createdAt: now,
      },
    );
    expect(compileRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        parentPlanId: "plan-1",
        parentPlanHash: hash1,
        commandId: "command-proposal-1",
        idempotencyKey: "proposal-key-1",
        publicArgs: { radiusMeters: 600 },
      }),
    );
    expect(revision).toEqual(
      expect.objectContaining({
        revisionNumber: 2,
        parentRevisionId: "revision-1",
        status: "QUEUED",
        reusedNodeIds: ["reference"],
        rerunNodeIds: ["query"],
      }),
    );
  });

  it.each([
    [
      "parent mismatch",
      { parentPlanId: "other" },
      "WSGS_REVISION_PARENT_PLAN_MISMATCH",
    ],
    [
      "same plan identity",
      { planId: "plan-1" },
      "WSGS_REVISION_IDENTITY_INVALID",
    ],
    [
      "parent hash mismatch",
      { parentPlanHash: hash2 },
      "WSGS_REVISION_PARENT_PLAN_MISMATCH",
    ],
    [
      "revision regression",
      { planRevision: 1 },
      "WSGS_REVISION_NUMBER_INVALID",
    ],
    [
      "incomplete node classification",
      { rerunNodeIds: [] },
      "WSGS_REVISION_NODE_CLASSIFICATION_INCOMPLETE",
    ],
    [
      "unknown node",
      { rerunNodeIds: ["missing"] },
      "WSGS_REVISION_UNKNOWN_NODE",
    ],
    [
      "overlap",
      { reusedNodeIds: ["query"] },
      "WSGS_REVISION_NODE_SETS_OVERLAP",
    ],
  ])("fails closed on WSGS %s", (_label, override, code) => {
    expect(() =>
      validateCompileResult(
        { ...compileResult(), ...override },
        currentRevision(),
      ),
    ).toThrow(code);
  });

  it("moves to CANCELLED only after matching WSGS acknowledgement", async () => {
    const run = runningRun();
    const transition = await requestAnalysisRunCancellation(
      {
        cancelRun: async () => ({
          supported: true,
          acknowledged: true,
          upstreamRunId: "upstream-run-1",
        }),
      },
      run,
      {
        analysisId: "analysis-1",
        revisionId: "revision-1",
        commandId: "command-cancel-1",
        idempotencyKey: "cancel-key-1",
        reason: "USER_REQUESTED",
      },
      now,
    );
    expect(transition.requested.status).toBe("CANCEL_REQUESTED");
    expect(transition.settled.status).toBe("CANCELLED");
    expect(transition.queueRevision).toBe(false);
  });

  it("keeps cancellation requested and queues a revision until acknowledged", async () => {
    const transition = await requestAnalysisRunCancellation(
      {
        cancelRun: async () => ({
          supported: false,
          acknowledged: false,
          upstreamRunId: "upstream-run-1",
        }),
      },
      runningRun(),
      {
        analysisId: "analysis-1",
        revisionId: "revision-1",
        commandId: "command-restart-1",
        idempotencyKey: "restart-key-1",
        reason: "REVISION_RESTART",
      },
      now,
    );
    expect(transition.settled.status).toBe("CANCEL_REQUESTED");
    expect(transition.settled.finishedAt).toBeUndefined();
    expect(transition.queueRevision).toBe(true);
  });
});

function currentRevision(): AnalysisRevision {
  return {
    schemaVersion: "sacs-analysis-revision/1.0",
    revisionId: "revision-1",
    analysisId: "analysis-1",
    revisionNumber: 1,
    cause: "INITIAL_QUERY",
    wsgsPlanId: "plan-1",
    planHash: hash1,
    changedPaths: [],
    reusedNodeIds: [],
    invalidatedNodeIds: [],
    rerunNodeIds: ["reference", "query"],
    status: "RUNNING",
    createdAt: now,
  };
}

function compileResult(): WsgsCompileRevisionResult {
  return {
    upstreamAnalysisId: "upstream-analysis-1",
    planId: "plan-2",
    planHash: hash2,
    planRevision: 2,
    parentPlanId: "plan-1",
    parentPlanHash: hash1,
    nodeIds: ["reference", "query"],
    reusedNodeIds: ["reference"],
    invalidatedNodeIds: [],
    rerunNodeIds: ["query"],
  };
}

function runningRun(): AnalysisRun {
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
