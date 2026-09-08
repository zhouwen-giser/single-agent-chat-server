import type { Pool } from "pg";
import { describe, expect, it } from "@jest/globals";

import { recordHistoricalGroundingSource } from "../packages/persistence/src/grounding-source-history.js";
import { hashJson } from "../packages/persistence/src/hash.js";

const input = {
  scope: {
    analysisId: "analysis-1",
    principalId: "principal-1",
    threadId: "thread-1",
  },
  groundingExecutionId: "grounding-local-1",
  revisionId: "revision-1",
  runId: "run-1",
  observationHash: "1".repeat(64),
};
const sourceRow = () => ({
  grounding_id: input.groundingExecutionId,
  principal_id: input.scope.principalId,
  thread_id: input.scope.threadId,
  analysis_id: input.scope.analysisId,
  analysis_revision_id: input.revisionId,
  analysis_run_id: input.runId,
  wsgs_grounding_id: "grounding-public-1",
  request_hash: "2".repeat(64),
  source_kind: "WSGS_GROUNDING_JOB",
  source_id: "grounding-public-1",
  source_hash: "sha256:" + "2".repeat(64),
  analysis_intent_json: {
    analysisId: input.scope.analysisId,
    revisionId: input.revisionId,
    contractIdentity: {
      contractVersion: "sacs-wsgs-grounding/1.2",
      resultProfile: "wsgs-world-analysis-findings/1.0",
    },
  },
  last_source_status: "COMPLETED",
  last_observation_hash: input.observationHash,
  grounding_result_hash: "sha256:" + "3".repeat(64),
  observed_at: new Date("2026-09-07T01:00:00.000Z"),
});

/** SQL driver boundary only. No PostgreSQL or process-restart environment claim. */
function driver(
  options: {
    current?: boolean;
    missingScope?: boolean;
    missingSource?: boolean;
    patch?: Record<string, unknown>;
    conflictEvent?: boolean;
    failUpdate?: boolean;
  } = {},
) {
  const row = { ...sourceRow(), ...options.patch };
  const calls: { sql: string; parameters: readonly unknown[] }[] = [];
  const committedEvents: Record<string, unknown>[] = [];
  let pendingEvents: Record<string, unknown>[] = [];
  let status = "RUNNING";
  let pendingStatus = status;
  let releases = 0;
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    calls.push({ sql, parameters });
    let rows: Record<string, unknown>[] = [];
    if (sql === "BEGIN") {
      pendingEvents = [];
      pendingStatus = status;
    } else if (sql === "COMMIT") {
      committedEvents.push(...pendingEvents);
      status = pendingStatus;
      pendingEvents = [];
    } else if (sql === "ROLLBACK") {
      pendingEvents = [];
      pendingStatus = status;
    } else if (sql.includes("FROM chat_service.analysis_session s"))
      rows = options.missingScope
        ? []
        : [
            {
              active_revision_id: options.current
                ? input.revisionId
                : "revision-2",
            },
          ];
    else if (sql.includes("FROM chat_service.grounding_execution g"))
      rows = options.missingSource ? [] : [row];
    else if (sql.includes("WHERE event_id=$1"))
      rows = options.conflictEvent
        ? [
            {
              analysis_id: "foreign",
              revision_id: input.revisionId,
              run_id: input.runId,
              event_type: "GROUNDING_SOURCE_OBSERVED",
              payload_hash: "sha256:" + "9".repeat(64),
            },
          ]
        : committedEvents.filter(
            (event) => event["event_id"] === parameters[0],
          );
    else if (sql.includes("MAX(analysis_sequence)"))
      rows = [{ analysis_sequence: "12", run_sequence: "4" }];
    else if (sql.includes("INSERT INTO chat_service.analysis_event"))
      pendingEvents.push({
        event_id: parameters[0],
        analysis_id: parameters[1],
        revision_id: parameters[2],
        run_id: parameters[3],
        event_type: "GROUNDING_SOURCE_OBSERVED",
        payload_hash: parameters[8],
      });
    else if (sql.includes("UPDATE chat_service.analysis_run")) {
      if (options.failUpdate) throw new Error("SQL_UPDATE_FAILED");
      pendingStatus = String(parameters[3]);
      rows = [{}];
    }
    return { rows, rowCount: rows.length };
  };
  return {
    pool: {
      connect: async () => ({
        query,
        release: () => {
          releases++;
        },
      }),
    } as unknown as Pool,
    calls,
    row,
    get events() {
      return committedEvents;
    },
    get status() {
      return status;
    },
    get releases() {
      return releases;
    },
  };
}

describe("frozen historical source persistence boundary (ENV-001 NOT_RUN)", () => {
  it.each([
    ["COMPLETED", "SUCCEEDED"],
    ["PARTIAL", "PARTIAL"],
    ["AMBIGUOUS", "WAITING_INTERVENTION"],
    ["UNRESOLVED", "PARTIAL"],
    ["FAILED", "FAILED"],
    ["CANCELLED", "CANCELLED"],
  ])(
    "AC-029 historical %s updates only its own run as %s and appends one audit event",
    async (publishedStatus, expectedRunStatus) => {
      const db = driver({ patch: { last_source_status: publishedStatus } });
      await recordHistoricalGroundingSource(db.pool, input);
      expect(db.status).toBe(expectedRunStatus);
      expect(db.events).toHaveLength(1);
      const [begin, sessionLock, sourceLock] = db.calls;
      expect(begin?.sql).toBe("BEGIN");
      expect(sessionLock?.sql).toContain("FOR UPDATE OF s");
      expect(sessionLock?.parameters).toEqual([
        "analysis-1",
        "principal-1",
        "thread-1",
      ]);
      expect(sourceLock?.sql).toContain("FOR UPDATE OF g,r");
      expect(sourceLock?.sql).toContain(
        "r.revision_id=v.revision_id AND r.analysis_id=v.analysis_id",
      );
      expect(sourceLock?.sql).toContain("newer.attempt>r.attempt");
      expect(sourceLock?.parameters).toEqual([
        "grounding-local-1",
        "principal-1",
        "thread-1",
        "analysis-1",
        "revision-1",
        "run-1",
      ]);
      const insert = db.calls.find((call) =>
        call.sql.includes("INSERT INTO chat_service.analysis_event"),
      );
      const payload = {
        sourceStatus: publishedStatus,
        resultHash: db.row.grounding_result_hash,
      };
      expect(insert?.parameters).toEqual([
        "event-" +
          hashJson({
            runId: input.runId,
            sourceObservation: input.observationHash,
          }),
        "analysis-1",
        "revision-1",
        "run-1",
        "12",
        "4",
        "2026-09-07T01:00:00.000Z",
        JSON.stringify(payload),
        "sha256:" + hashJson(payload),
      ]);
      expect(
        db.calls.find((call) => call.sql.includes("MAX(analysis_sequence)"))
          ?.sql,
      ).toContain("COALESCE(MAX(analysis_sequence),0)+1");
      expect(
        db.calls.some((call) =>
          /(?:UPDATE|INSERT INTO) chat_service.analysis_(?:projection|session|revision|intervention)\b/u.test(
            call.sql,
          ),
        ),
      ).toBe(false);
      expect(db.calls.at(-1)?.sql).toBe("COMMIT");
      expect(db.releases).toBe(1);
    },
  );

  it("AC-029 duplicate or formerly current observations retain the existing event identity without a second write", async () => {
    const db = driver();
    await recordHistoricalGroundingSource(db.pool, input);
    const count = db.calls.length;
    await recordHistoricalGroundingSource(db.pool, input);
    expect(db.events).toHaveLength(1);
    expect(
      db.calls
        .slice(count)
        .some((call) => /^(?:INSERT|UPDATE)/u.test(call.sql)),
    ).toBe(false);
    expect(db.status).toBe("SUCCEEDED");
    expect(db.releases).toBe(2);
  });

  it("AC-029 current revision is owned by the normal projector, never this history path", async () => {
    const db = driver({ current: true });
    await recordHistoricalGroundingSource(db.pool, input);
    expect(db.calls).toHaveLength(3);
    expect(db.calls.at(-1)?.sql).toBe("COMMIT");
    expect(db.status).toBe("RUNNING");
    expect(db.events).toEqual([]);
  });

  it.each(["ACCEPTED", "RUNNING"])(
    "AC-029 local supersession never converts published %s into cancelled/failed",
    async (status) => {
      const db = driver({ patch: { last_source_status: status } });
      await recordHistoricalGroundingSource(db.pool, input);
      expect(db.status).toBe("RUNNING");
      expect(db.events).toEqual([]);
      expect(
        db.calls.some((call) => /^(?:INSERT|UPDATE)/u.test(call.sql)),
      ).toBe(false);
    },
  );

  it("AC-029 stale observation cannot complete a different run", async () => {
    const db = driver({ patch: { last_observation_hash: "4".repeat(64) } });
    await recordHistoricalGroundingSource(db.pool, input);
    expect(db.status).toBe("RUNNING");
    expect(db.events).toEqual([]);
  });

  it.each([
    "grounding_id",
    "principal_id",
    "thread_id",
    "analysis_id",
    "analysis_revision_id",
    "analysis_run_id",
    "source_kind",
    "source_id",
    "source_hash",
  ])(
    "AC-029 rejects mismatched saved %s identity before any historical mutation",
    async (field) => {
      const db = driver({ patch: { [field]: "foreign" } });
      await expect(
        recordHistoricalGroundingSource(db.pool, input),
      ).rejects.toThrow("ANALYSIS_SOURCE_IDENTITY_INVALID");
      expect(db.events).toEqual([]);
      expect(db.status).toBe("RUNNING");
      expect(db.calls.at(-1)?.sql).toBe("ROLLBACK");
      expect(db.releases).toBe(1);
    },
  );

  it("AC-029 rejects missing user/thread ownership without exposing source history", async () => {
    const db = driver({ missingScope: true });
    await expect(
      recordHistoricalGroundingSource(db.pool, input),
    ).rejects.toThrow("ANALYSIS_NOT_FOUND");
    expect(
      db.calls.some((call) =>
        call.sql.includes("FROM chat_service.grounding_execution"),
      ),
    ).toBe(false);
    expect(db.events).toEqual([]);
  });

  it("AC-029 missing source remains a no-op, not invented completion", async () => {
    const db = driver({ missingSource: true });
    await recordHistoricalGroundingSource(db.pool, input);
    expect(db.status).toBe("RUNNING");
    expect(db.events).toEqual([]);
  });

  it("AC-005 unknown saved protocol is not silently upgraded for historical writes", async () => {
    const db = driver({
      patch: {
        analysis_intent_json: {
          analysisId: input.scope.analysisId,
          revisionId: input.revisionId,
        },
      },
    });
    await expect(
      recordHistoricalGroundingSource(db.pool, input),
    ).rejects.toThrow("ANALYSIS_SOURCE_CONTRACT_IDENTITY_INVALID");
    expect(db.events).toEqual([]);
  });

  it("AC-005 a saved legacy 1.1 source keeps its protocol during historical projection", async () => {
    const intent = sourceRow().analysis_intent_json;
    const legacy = {
      ...intent,
      contractIdentity: {
        contractVersion: "sacs-wsgs-grounding/1.1",
        resultProfile: "sacs-wsgs-geospatial-findings/1.0",
      },
    };
    const db = driver({ patch: { analysis_intent_json: legacy } });
    await recordHistoricalGroundingSource(db.pool, input);
    expect(db.status).toBe("SUCCEEDED");
    expect(db.row.analysis_intent_json).toEqual(legacy);
    expect(
      db.calls.some((call) =>
        call.sql.includes("UPDATE chat_service.grounding_execution"),
      ),
    ).toBe(false);
  });

  it.each<{ patch: Record<string, unknown>; code: string }>([
    {
      patch: { last_source_status: "ABORTED" },
      code: "ANALYSIS_SOURCE_RESPONSE_CONTRACT_VIOLATION",
    },
    {
      patch: { observed_at: "not-a-time" },
      code: "ANALYSIS_SOURCE_OBSERVATION_TIME_INVALID",
    },
  ])(
    "AC-029 invalid saved status/time is never promoted %#",
    async ({ patch, code }) => {
      const db = driver({ patch });
      await expect(
        recordHistoricalGroundingSource(db.pool, input),
      ).rejects.toThrow(code);
      expect(db.status).toBe("RUNNING");
      expect(db.events).toEqual([]);
      expect(db.calls.at(-1)?.sql).toBe("ROLLBACK");
    },
  );

  it("AC-029 event identity conflicts roll back without altering old or current facts", async () => {
    const db = driver({ conflictEvent: true });
    await expect(
      recordHistoricalGroundingSource(db.pool, input),
    ).rejects.toThrow("ANALYSIS_SOURCE_EVENT_IDENTITY_CONFLICT");
    expect(db.status).toBe("RUNNING");
    expect(db.events).toEqual([]);
    expect(db.calls.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("AC-029 run update failure rolls back the appended event and releases the connection", async () => {
    const db = driver({ failUpdate: true });
    await expect(
      recordHistoricalGroundingSource(db.pool, input),
    ).rejects.toThrow("SQL_UPDATE_FAILED");
    expect(db.events).toEqual([]);
    expect(db.status).toBe("RUNNING");
    expect(db.calls.at(-1)?.sql).toBe("ROLLBACK");
    expect(db.releases).toBe(1);
  });
});
