import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { Ajv } from "ajv";
import { EventType } from "@ag-ui/core";
import { analysisSourceStatuses } from "../packages/analysis-contract/src/source.js";
import {
  createGroundingJobActivity,
  groundingJobActivityV1Schema,
  groundingActivityMessageId,
} from "../packages/analysis-contract/src/grounding-activity.js";
import {
  projectAnalysisActivitySnapshot,
  projectAnalysisActivityDelta,
} from "../packages/ag-ui-analysis-adapter/src/index.js";
import {
  assertSacsAgUiEvent,
  SACS_AG_UI_V03_PROFILE_ID,
} from "../packages/ag-ui-api-contract/src/index.js";

const input = {
  analysisId: "a-1",
  revisionId: "r-1",
  groundingId: "upstream-g-1",
  activityRevision: 3,
  cancelRequested: false,
};
const validate = new Ajv().compile(
  JSON.parse(
    readFileSync("contracts/v0.6/grounding-activity-v1.schema.json", "utf8"),
  ),
);
describe("frozen Grounding Job Activity v1", () => {
  it.each(analysisSourceStatuses)(
    "projects only public %s status with no invented DAG/phase/progress",
    (sourceStatus) => {
      const activity = createGroundingJobActivity({ ...input, sourceStatus });
      const expected = {
        ACCEPTED: "QUEUED",
        RUNNING: "RUNNING",
        COMPLETED: "COMPLETED",
        PARTIAL: "PARTIAL",
        UNRESOLVED: "PARTIAL",
        AMBIGUOUS: "WAITING_SELECTION",
        FAILED: "FAILED",
        CANCELLED: "CANCELLED",
      };
      expect(activity.status).toBe(expected[sourceStatus]);
      expect(activity.sourceStatus).toBe(sourceStatus);
      expect(validate(activity)).toBe(true);
      expect(Object.keys(activity).sort()).toEqual([
        "analysisId",
        "groundingId",
        "meta",
        "revisionId",
        "schemaVersion",
        "sourceStatus",
        "status",
      ]);
      const event = projectAnalysisActivitySnapshot({
        messageId: groundingActivityMessageId(activity),
        activityType: "grounding.job",
        activityRevision: 3,
        content: activity,
      });
      expect(event).toMatchObject({
        type: EventType.ACTIVITY_SNAPSHOT,
        activityType: "grounding.job",
        content: activity,
      });
      expect(() =>
        assertSacsAgUiEvent(event, SACS_AG_UI_V03_PROFILE_ID),
      ).not.toThrow();
    },
  );
  it("keeps local cancellation pending until an authoritative terminal observation", () => {
    for (const sourceStatus of ["ACCEPTED", "RUNNING"] as const)
      expect(
        createGroundingJobActivity({
          ...input,
          sourceStatus,
          cancelRequested: true,
        }).status,
      ).toBe("CANCEL_REQUESTED");
    for (const sourceStatus of [
      "COMPLETED",
      "PARTIAL",
      "FAILED",
      "CANCELLED",
    ] as const)
      expect(
        createGroundingJobActivity({
          ...input,
          sourceStatus,
          cancelRequested: true,
        }).status,
      ).toBe(sourceStatus);
  });
  it("uses one bounded message identity per analysis/revision, not per run/status", () => {
    const a = createGroundingJobActivity({ ...input, sourceStatus: "RUNNING" });
    expect(groundingActivityMessageId(a)).toBe(
      groundingActivityMessageId(input),
    );
    expect(
      groundingActivityMessageId({ ...input, revisionId: "r-2" }),
    ).not.toBe(groundingActivityMessageId(input));
    expect(
      groundingActivityMessageId({ ...input, analysisId: "a-2" }),
    ).not.toBe(groundingActivityMessageId(input));
  });
  it("rejects undeclared lifecycle, fields, identity and invalid progress", () => {
    const activity = createGroundingJobActivity({
      ...input,
      sourceStatus: "RUNNING",
    });
    for (const changed of [
      { ...activity, status: "PROVIDER_RUNNING" },
      { ...activity, dag: {} },
      { ...activity, groundingId: "" },
      { ...activity, meta: { activityRevision: -1 } },
    ]) {
      expect(groundingJobActivityV1Schema.safeParse(changed).success).toBe(
        false,
      );
      expect(validate(changed)).toBe(false);
    }
    expect(
      groundingJobActivityV1Schema.safeParse({
        ...activity,
        progress: { completed: 2, total: 1 },
      }).success,
    ).toBe(false);
    expect(() =>
      projectAnalysisActivitySnapshot({
        messageId: "wrong",
        activityType: "grounding.job",
        activityRevision: 3,
        content: activity,
      }),
    ).toThrow("GROUNDING_ACTIVITY_MESSAGE_ID_MISMATCH");
  });
  it("retains guarded Activity deltas and does not change real DAG adapters", () => {
    const event = projectAnalysisActivityDelta({
      messageId: groundingActivityMessageId(input),
      activityType: "grounding.job",
      expectedActivityRevision: 3,
      nextActivityRevision: 4,
      patch: [{ op: "replace", path: "/status", value: "CANCEL_REQUESTED" }],
    });
    expect(event).toMatchObject({
      type: EventType.ACTIVITY_DELTA,
      activityType: "grounding.job",
      patch: [
        { op: "test", path: "/meta/activityRevision", value: 3 },
        { op: "replace", path: "/status", value: "CANCEL_REQUESTED" },
        { op: "replace", path: "/meta/activityRevision", value: 4 },
      ],
    });
    expect(
      projectAnalysisActivitySnapshot({
        messageId: "dag-1",
        activityRevision: 1,
        content: { nodes: [] },
      }),
    ).toMatchObject({ activityType: "analysis.dag" });
  });
});
