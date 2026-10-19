import type { AgUiSharedStateV03 } from "../../analysis-contract/src/index.js";
import {
  createGroundingJobActivity,
  groundingActivityMessageId,
  groundingJobActivityV1Schema,
} from "../../analysis-contract/src/grounding-activity.js";

const runTerminals = new Set(["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"]);
const activityTerminals = new Set([
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
  "WAITING_SELECTION",
]);

/** Full hydration can skip counters, but cannot move a known analysis backwards. */
export function acceptsStateTransition(
  previous: AgUiSharedStateV03 | undefined,
  next: AgUiSharedStateV03,
): boolean {
  if (!previous) return true;
  const old = previous.analysis,
    incoming = next.analysis;
  if (
    old.session.analysisId !== incoming.session.analysisId ||
    old.session.principalId !== incoming.session.principalId ||
    old.session.threadId !== incoming.session.threadId
  )
    return false;
  if (next.meta.stateRevision < previous.meta.stateRevision) return false;
  if (
    next.meta.stateRevision === previous.meta.stateRevision &&
    next.meta.snapshotHash !== previous.meta.snapshotHash
  )
    return false;
  if (incoming.session.latestRevisionNumber < old.session.latestRevisionNumber)
    return false;
  const before = old.revisionsById[old.activeRevisionId];
  const after = incoming.revisionsById[incoming.activeRevisionId];
  if (
    before &&
    (!after ||
      after.revisionNumber < before.revisionNumber ||
      (after.revisionNumber === before.revisionNumber &&
        after.revisionId !== before.revisionId))
  )
    return false;
  if (before?.revisionId !== after?.revisionId) return true;
  if (
    before?.source?.kind === "WSGS_GROUNDING_JOB" &&
    (after?.source?.kind !== before.source.kind ||
      after.source.sourceId !== before.source.sourceId)
  )
    return false;
  const oldRun = Object.values(old.runsById)
    .filter((r) => r.revisionId === old.activeRevisionId)
    .sort((a, b) => b.attempt - a.attempt)[0];
  const newRun = Object.values(incoming.runsById)
    .filter((r) => r.revisionId === incoming.activeRevisionId)
    .sort((a, b) => b.attempt - a.attempt)[0];
  if (oldRun && (!newRun || newRun.attempt < oldRun.attempt)) return false;
  if (
    oldRun &&
    newRun &&
    newRun.attempt === oldRun.attempt &&
    (newRun.runId !== oldRun.runId ||
      (runTerminals.has(oldRun.status) && newRun.status !== oldRun.status))
  )
    return false;
  return true;
}

/** Activity is presentation only, but its immutable identity must match State. */
export function acceptsGroundingActivity(
  state: AgUiSharedStateV03 | undefined,
  messageId: string,
  value: unknown,
  previous?: Readonly<Record<string, unknown>>,
): boolean {
  const parsed = groundingJobActivityV1Schema.safeParse(value);
  if (!parsed.success) return false;
  const activity = parsed.data;
  if (groundingActivityMessageId(activity) !== messageId) return false;
  if (
    createGroundingJobActivity({
      ...activity,
      activityRevision: activity.meta.activityRevision,
      cancelRequested: activity.status === "CANCEL_REQUESTED",
    }).status !== activity.status
  )
    return false;
  if (state) {
    const revision =
      state.analysis.revisionsById[state.analysis.activeRevisionId];
    if (
      activity.analysisId !== state.analysis.session.analysisId ||
      activity.revisionId !== state.analysis.activeRevisionId ||
      revision?.source?.kind !== "WSGS_GROUNDING_JOB" ||
      activity.groundingId !== revision.source.sourceId
    )
      return false;
  }
  if (previous) {
    if (
      activity.groundingId !== previous["groundingId"] ||
      activity.analysisId !== previous["analysisId"] ||
      activity.revisionId !== previous["revisionId"]
    )
      return false;
    if (
      activityTerminals.has(String(previous["status"])) &&
      (activity.status !== previous["status"] ||
        activity.sourceStatus !== previous["sourceStatus"])
    )
      return false;
    if (
      previous["status"] === "CANCEL_REQUESTED" &&
      ["QUEUED", "RUNNING"].includes(activity.status)
    )
      return false;
  }
  return true;
}
