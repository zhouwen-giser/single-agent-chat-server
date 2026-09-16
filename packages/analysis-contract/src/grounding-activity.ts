import { z } from "zod";
import { hashCanonicalJson } from "../../world-explanation-contract/src/index.js";
import { analysisSourceStatuses, type AnalysisSourceStatus } from "./source.js";
import type { AgUiSharedStateV03 } from "./index.js";

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const GROUNDING_ACTIVITY_TYPE = "grounding.job" as const;
export const groundingJobActivityV1Schema = z.strictObject({
  schemaVersion: z.literal("io.sacs/grounding-activity/v1"),
  groundingId: identifier,
  analysisId: identifier,
  revisionId: identifier,
  status: z.enum([
    "QUEUED",
    "RUNNING",
    "WAITING_SELECTION",
    "COMPLETED",
    "PARTIAL",
    "FAILED",
    "CANCEL_REQUESTED",
    "CANCELLED",
  ]),
  // Preserve the published business status (including UNRESOLVED) separately.
  sourceStatus: z.enum(analysisSourceStatuses),
  phase: z.string().min(1).max(256).optional(),
  message: z.string().min(1).max(2000).optional(),
  progress: z
    .strictObject({
      completed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .refine((p) => p.completed <= p.total)
    .optional(),
  meta: z.strictObject({ activityRevision: z.number().int().nonnegative() }),
});
export type GroundingJobActivityV1 = z.infer<
  typeof groundingJobActivityV1Schema
>;

const statuses = {
  ACCEPTED: "QUEUED",
  RUNNING: "RUNNING",
  AMBIGUOUS: "WAITING_SELECTION",
  COMPLETED: "COMPLETED",
  PARTIAL: "PARTIAL",
  UNRESOLVED: "PARTIAL",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

/** Only public source observations and durable local cancellation intent enter this projection. */
export function createGroundingJobActivity(input: {
  groundingId: string;
  analysisId: string;
  revisionId: string;
  sourceStatus: AnalysisSourceStatus;
  cancelRequested: boolean;
  activityRevision: number;
}): GroundingJobActivityV1 {
  return groundingJobActivityV1Schema.parse({
    schemaVersion: "io.sacs/grounding-activity/v1",
    groundingId: input.groundingId,
    analysisId: input.analysisId,
    revisionId: input.revisionId,
    sourceStatus: input.sourceStatus,
    status:
      input.cancelRequested &&
      ["ACCEPTED", "RUNNING"].includes(input.sourceStatus)
        ? "CANCEL_REQUESTED"
        : statuses[input.sourceStatus],
    meta: { activityRevision: input.activityRevision },
  });
}

export function groundingActivityMessageId(input: {
  analysisId: string;
  revisionId: string;
}): string {
  identifier.parse(input.analysisId);
  identifier.parse(input.revisionId);
  return (
    "grounding-activity-" +
    hashCanonicalJson({
      analysisId: input.analysisId,
      revisionId: input.revisionId,
    }).slice(7)
  );
}

/** Read compatibility for persisted pre-v1 activities; never guesses upstream phases/progress. */
export function groundingActivityForState(
  state: AgUiSharedStateV03,
  activity: Readonly<Record<string, unknown>>,
  activityRevision: number,
): GroundingJobActivityV1 {
  const revisionId = state.analysis.activeRevisionId;
  const revision = revisionId
    ? state.analysis.revisionsById[revisionId]
    : undefined;
  if (!revision || revision.source?.kind !== "WSGS_GROUNDING_JOB")
    throw Error("GROUNDING_ACTIVITY_SOURCE_REQUIRED");
  if (activity["schemaVersion"] !== undefined) {
    const stored = groundingJobActivityV1Schema.parse(activity);
    if (
      stored.groundingId !== revision.source.sourceId ||
      stored.analysisId !== state.analysis.session.analysisId ||
      stored.revisionId !== revision.revisionId
    )
      throw Error("GROUNDING_ACTIVITY_IDENTITY_MISMATCH");
  }
  const run = Object.values(state.analysis.runsById)
    .filter((r) => r.revisionId === revision.revisionId)
    .sort((a, b) => b.attempt - a.attempt)[0];
  return createGroundingJobActivity({
    groundingId: revision.source.sourceId,
    analysisId: state.analysis.session.analysisId,
    revisionId: revision.revisionId,
    sourceStatus: z
      .enum(analysisSourceStatuses)
      .parse(activity["sourceStatus"]),
    cancelRequested: run?.status === "CANCEL_REQUESTED",
    activityRevision,
  });
}
