import {
  calculateAgUiStateSnapshotHash,
  type AgUiSharedStateV03,
} from "../packages/analysis-contract/src/index.js";

export const v05Now = "2026-08-30T00:00:00.000Z";
export const v05Hash = `sha256:${"1".repeat(64)}`;

export type AgUiSharedStateV03Body = Omit<AgUiSharedStateV03, "meta">;

export function analysisStateBody(
  conversation: Readonly<Record<string, unknown>> = { threadId: "thread-1" },
): AgUiSharedStateV03Body {
  const session = {
    schemaVersion: "sacs-analysis-session/1.0" as const,
    analysisId: "analysis-1",
    principalId: "principal-1",
    threadId: "thread-1",
    groundingId: "grounding-1",
    title: "Analysis",
    autonomyMode: "OBSERVER" as const,
    status: "ACTIVE" as const,
    activeRevisionId: "revision-1",
    latestRevisionNumber: 1,
    observerPolicyHash: v05Hash,
    createdAt: v05Now,
    updatedAt: v05Now,
  };
  const revision = {
    schemaVersion: "sacs-analysis-revision/1.0" as const,
    revisionId: "revision-1",
    analysisId: "analysis-1",
    revisionNumber: 1,
    cause: "INITIAL_QUERY" as const,
    wsgsPlanId: "plan-1",
    planHash: v05Hash,
    changedPaths: [],
    reusedNodeIds: [],
    invalidatedNodeIds: [],
    rerunNodeIds: ["node-1"],
    status: "RUNNING" as const,
    createdAt: v05Now,
  };
  const run = {
    schemaVersion: "sacs-analysis-run/1.0" as const,
    runId: "run-1",
    revisionId: "revision-1",
    attempt: 1,
    status: "RUNNING" as const,
    startedAt: v05Now,
  };
  return {
    schemaVersion: "io.sacs/agui-state/v0.3",
    conversation,
    analysis: {
      session,
      activeRevisionId: revision.revisionId,
      revisionsById: { [revision.revisionId]: revision },
      runsById: { [run.runId]: run },
      nodesById: {},
    },
    map: {
      schemaVersion: "io.sacs/map-scene/v1",
      sceneRevision: 0,
      layersById: {},
      pinnedFocusById: {},
    },
    timeline: {
      schemaVersion: "sacs-shared-timeline/1.0",
      sources: {},
    },
    proposalsById: {},
  };
}

export function analysisStateHash(
  stateRevision: number,
  body: AgUiSharedStateV03Body,
): string {
  return calculateAgUiStateSnapshotHash(body, stateRevision);
}
