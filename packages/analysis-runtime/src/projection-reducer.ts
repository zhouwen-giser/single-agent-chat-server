import {
  ANALYSIS_MAX_ACTIVITY_BYTES,
  ANALYSIS_MAX_STATE_BYTES,
  agUiSharedStateV03Schema,
  analysisChangeProposalSchema,
  analysisInterventionSchema,
  analysisNodeStateSchema,
  analysisProjectionSchema,
  analysisRevisionSchema,
  analysisRunSchema,
  assertAnalysisPayloadHash,
  calculateAgUiStateSnapshotHash,
  focusTargetSchema,
  mapLayerDescriptorSchema,
  timelineProjectionSchema,
  type AnalysisEvent,
  type AnalysisProjection,
  type AnalysisRevision,
  type AnalysisRun,
  type AnalysisSession,
  type MapSharedState,
  type TimelineProjection,
} from "../../analysis-contract/src/index.js";
import {
  emptyMapSharedState,
  reduceMapSharedState,
} from "../../analysis-map/src/index.js";
import { projectSharedTimeline } from "../../analysis-timeline/src/index.js";
import {
  canonicalJson,
  hashCanonicalJson,
} from "../../world-explanation-contract/src/index.js";

export const ANALYSIS_INTERNAL_EVENT_TYPES = [
  "analysis.plan.published",
  "analysis.run.status",
  "analysis.node.state",
  "analysis.layer.available",
  "analysis.focus.execution",
  "analysis.focus.intervention",
  "analysis.focus.pinned",
  "analysis.proposal.changed",
  "analysis.intervention.required",
  "analysis.timeline.changed",
  "analysis.explanation.available",
] as const;

export interface InitialAnalysisProjectionInput {
  readonly session: AnalysisSession;
  readonly revision: AnalysisRevision;
  readonly run: AnalysisRun;
  readonly timeline?: TimelineProjection;
  readonly map?: MapSharedState;
  readonly createdAt: string;
}

export interface AnalysisProjectionReduction {
  readonly projection: AnalysisProjection;
  readonly stateChanged: boolean;
  readonly activityChanged: boolean;
  readonly auditOnly: boolean;
}

export function createInitialAnalysisProjection(
  input: InitialAnalysisProjectionInput,
): AnalysisProjection {
  if (
    input.session.analysisId !== input.revision.analysisId ||
    input.session.activeRevisionId !== input.revision.revisionId ||
    input.run.revisionId !== input.revision.revisionId
  ) {
    throw new Error("ANALYSIS_PROJECTION_LINEAGE_MISMATCH");
  }
  const stateBody = {
    schemaVersion: "io.sacs/agui-state/v0.3",
    conversation: { threadId: input.session.threadId },
    analysis: {
      session: input.session,
      activeRevisionId: input.revision.revisionId,
      revisionsById: { [input.revision.revisionId]: input.revision },
      runsById: { [input.run.runId]: input.run },
      nodesById: {},
    },
    map: input.map ?? emptyMapSharedState(),
    timeline:
      input.timeline ??
      ({ schemaVersion: "sacs-shared-timeline/1.0", sources: {} } as const),
    proposalsById: {},
  };
  const state = agUiSharedStateV03Schema.parse({
    ...stateBody,
    meta: {
      stateRevision: 0,
      snapshotHash: calculateAgUiStateSnapshotHash(stateBody, 0),
    },
  });
  const activity = {
    schemaVersion: "io.sacs/analysis-activity/v1",
    plan: null,
    nodesById: {},
  };
  assertProjectionBudget(state, ANALYSIS_MAX_STATE_BYTES, "ANALYSIS_STATE");
  assertProjectionBudget(
    activity,
    ANALYSIS_MAX_ACTIVITY_BYTES,
    "ANALYSIS_ACTIVITY",
  );
  return analysisProjectionSchema.parse({
    schemaVersion: "sacs-analysis-projection/1.0",
    analysisId: input.session.analysisId,
    stateRevision: 0,
    activityRevision: 0,
    state,
    stateHash: hashCanonicalJson(state),
    activity,
    activityHash: hashCanonicalJson(activity),
    lastEventSequence: 0,
    updatedAt: input.createdAt,
  });
}

export function reduceAnalysisProjection(
  current: AnalysisProjection,
  event: AnalysisEvent,
): AnalysisProjectionReduction {
  const projection = analysisProjectionSchema.parse(current);
  assertAnalysisPayloadHash(event);
  if (event.analysisId !== projection.analysisId) {
    throw new Error("ANALYSIS_EVENT_SCOPE_MISMATCH");
  }
  if (event.analysisSequence !== projection.lastEventSequence + 1) {
    throw new Error("ANALYSIS_EVENT_SEQUENCE_NOT_NEXT");
  }
  const state = cloneRecord(projection.state);
  const activity = cloneRecord(projection.activity);
  const analysis = requiredRecord(state["analysis"], "ANALYSIS_STATE_INVALID");
  if (event.revisionId !== analysis["activeRevisionId"]) {
    return {
      projection: analysisProjectionSchema.parse({
        ...projection,
        lastEventSequence: event.analysisSequence,
        updatedAt: event.occurredAt,
      }),
      stateChanged: false,
      activityChanged: false,
      auditOnly: true,
    };
  }
  if (!isActiveRunEvent(analysis, event.runId, event.revisionId)) {
    return {
      projection: analysisProjectionSchema.parse({
        ...projection,
        lastEventSequence: event.analysisSequence,
        updatedAt: event.occurredAt,
      }),
      stateChanged: false,
      activityChanged: false,
      auditOnly: true,
    };
  }

  let stateChanged = false;
  let activityChanged = false;
  switch (event.eventType) {
    case "analysis.plan.published": {
      const plan = requiredRecord(
        event.payload["plan"],
        "ANALYSIS_PLAN_INVALID",
      );
      const planId = requiredString(plan["planId"], "ANALYSIS_PLAN_INVALID");
      const planHash = requiredString(
        plan["planHash"],
        "ANALYSIS_PLAN_INVALID",
      );
      if (!/^sha256:[0-9a-f]{64}$/u.test(planHash)) {
        throw new Error("ANALYSIS_PLAN_INVALID");
      }
      const revisionsById = requiredRecord(
        analysis["revisionsById"],
        "ANALYSIS_REVISION_STATE_INVALID",
      );
      const activeRevisionId = requiredString(
        analysis["activeRevisionId"],
        "ANALYSIS_REVISION_STATE_INVALID",
      );
      const revision = analysisRevisionSchema.parse(
        revisionsById[activeRevisionId],
      );
      if (revision.wsgsPlanId !== planId || revision.planHash !== planHash) {
        throw new Error("ANALYSIS_PLAN_IDENTITY_MISMATCH");
      }
      activity["plan"] = plan;
      stateChanged = true;
      activityChanged = true;
      break;
    }
    case "analysis.run.status": {
      const status = requiredString(
        event.payload["status"],
        "ANALYSIS_RUN_STATUS_INVALID",
      );
      if (
        !new Set([
          "STARTING",
          "RUNNING",
          "WAITING_INTERVENTION",
          "SUCCEEDED",
          "PARTIAL",
          "FAILED",
          "CANCEL_REQUESTED",
          "CANCELLED",
        ]).has(status)
      ) {
        throw new Error("ANALYSIS_RUN_STATUS_INVALID");
      }
      const runsById = requiredRecord(
        analysis["runsById"],
        "ANALYSIS_RUN_STATE_INVALID",
      );
      const run = analysisRunSchema.parse(runsById[event.runId]);
      runsById[event.runId] = analysisRunSchema.parse({
        ...run,
        status,
        ...(["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"].includes(status)
          ? { finishedAt: event.occurredAt }
          : {}),
      });
      stateChanged = true;
      break;
    }
    case "analysis.node.state": {
      const node = analysisNodeStateSchema.parse(event.payload["node"]);
      const nodesById = requiredRecord(
        analysis["nodesById"],
        "ANALYSIS_NODE_STATE_INVALID",
      );
      nodesById[node.nodeId] = node;
      const activityNodes = requiredRecord(
        activity["nodesById"],
        "ANALYSIS_ACTIVITY_INVALID",
      );
      activityNodes[node.nodeId] = node;
      stateChanged = true;
      activityChanged = true;
      break;
    }
    case "analysis.layer.available": {
      const layer = mapLayerDescriptorSchema.parse(event.payload["layer"]);
      if (
        layer.analysisId !== projection.analysisId ||
        layer.revisionId !== event.revisionId
      ) {
        throw new Error("ANALYSIS_LAYER_SCOPE_MISMATCH");
      }
      state["map"] = reduceMapSharedState(state["map"] as MapSharedState, {
        type: "LAYER_UPSERT",
        layer,
      });
      stateChanged = true;
      break;
    }
    case "analysis.focus.execution":
    case "analysis.focus.intervention":
    case "analysis.focus.pinned": {
      const focus = focusTargetSchema.parse(event.payload["focus"]);
      const type =
        event.eventType === "analysis.focus.execution"
          ? "EXECUTION_FOCUS_SET"
          : event.eventType === "analysis.focus.intervention"
            ? "INTERVENTION_FOCUS_SET"
            : "FOCUS_PIN";
      state["map"] = reduceMapSharedState(
        state["map"] as MapSharedState,
        type === "FOCUS_PIN" ? { type, focus } : { type, focus },
      );
      stateChanged = true;
      break;
    }
    case "analysis.proposal.changed": {
      const proposal = analysisChangeProposalSchema.parse(
        event.payload["proposal"],
      );
      const proposalsById = requiredRecord(
        state["proposalsById"],
        "ANALYSIS_PROPOSAL_STATE_INVALID",
      );
      proposalsById[proposal.proposalId] = proposal;
      stateChanged = true;
      break;
    }
    case "analysis.intervention.required": {
      const intervention = analysisInterventionSchema.parse(
        event.payload["intervention"],
      );
      state["pendingIntervention"] = intervention;
      stateChanged = true;
      break;
    }
    case "analysis.timeline.changed": {
      state["timeline"] = projectSharedTimeline(
        timelineProjectionSchema.parse(event.payload["timeline"]),
      );
      stateChanged = true;
      break;
    }
    case "analysis.explanation.available": {
      state["worldExplanation"] = requiredRecord(
        event.payload["worldExplanation"],
        "ANALYSIS_EXPLANATION_INVALID",
      );
      stateChanged = true;
      break;
    }
    default:
      break;
  }

  if (stateChanged) {
    const meta = requiredRecord(state["meta"], "ANALYSIS_STATE_INVALID");
    meta["stateRevision"] = projection.stateRevision + 1;
    meta["snapshotHash"] = calculateAgUiStateSnapshotHash(state);
  }
  agUiSharedStateV03Schema.parse(state);
  assertProjectionBudget(state, ANALYSIS_MAX_STATE_BYTES, "ANALYSIS_STATE");
  assertProjectionBudget(
    activity,
    ANALYSIS_MAX_ACTIVITY_BYTES,
    "ANALYSIS_ACTIVITY",
  );
  const next = analysisProjectionSchema.parse({
    ...projection,
    stateRevision: projection.stateRevision + (stateChanged ? 1 : 0),
    activityRevision: projection.activityRevision + (activityChanged ? 1 : 0),
    state,
    stateHash: stateChanged ? hashCanonicalJson(state) : projection.stateHash,
    activity,
    activityHash: activityChanged
      ? hashCanonicalJson(activity)
      : projection.activityHash,
    lastEventSequence: event.analysisSequence,
    updatedAt: event.occurredAt,
  });
  return {
    projection: next,
    stateChanged,
    activityChanged,
    auditOnly: !stateChanged && !activityChanged,
  };
}

function isActiveRunEvent(
  analysis: Record<string, unknown>,
  runId: string,
  revisionId: string,
): boolean {
  const runsById = requiredRecord(
    analysis["runsById"],
    "ANALYSIS_RUN_STATE_INVALID",
  );
  const runs = Object.values(runsById)
    .map((run) => analysisRunSchema.parse(run))
    .filter((run) => run.revisionId === revisionId)
    .sort((left, right) => right.attempt - left.attempt);
  return runs[0]?.runId === runId;
}

function cloneRecord(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return JSON.parse(canonicalJson(value)) as Record<string, unknown>;
}

function requiredRecord(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error(code);
  }
  return value;
}

function assertProjectionBudget(
  value: Readonly<Record<string, unknown>>,
  maximum: number,
  label: string,
): void {
  if (Buffer.byteLength(canonicalJson(value), "utf8") > maximum) {
    throw new Error(`${label}_TOO_LARGE`);
  }
}
