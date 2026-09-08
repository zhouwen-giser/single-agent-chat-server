import type { Pool } from "pg";
import { describe, it, expect } from "@jest/globals";
import {
  AnalysisRepository,
  AnalysisDevelopmentRepository,
  GroundingPersistenceRepository,
} from "../packages/persistence/src/index.js";
import { publicCanonicalHash } from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import { frozenRequest } from "./helpers/frozen-wsgs-http.js";
const v12 = {
  contractVersion: "sacs-wsgs-grounding/1.2",
  resultProfile: "wsgs-world-analysis-findings/1.0",
} as const;
const v11 = {
  contractVersion: "sacs-wsgs-grounding/1.1",
  resultProfile: "sacs-wsgs-geospatial-findings/1.0",
} as const;
/** Scripted PostgreSQL driver boundary. Actual repository code executes; no DB claim. */
function sqlPort(
  reply: (
    sql: string,
    parameters: readonly unknown[],
  ) => Record<string, unknown>[],
) {
  const calls: { sql: string; parameters: readonly unknown[] }[] = [];
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    calls.push({ sql, parameters });
    const rows = reply(sql, parameters);
    return { rows, rowCount: rows.length };
  };
  const driver = {
    query,
    connect: async () => ({ query, release: () => undefined }),
  };
  return { pool: driver as unknown as Pool, calls };
}
describe("frozen persistence SQL driver boundaries ENV-001 NOT_RUN", () => {
  it("AC-005 loads saved contract identity through an authorized revision join", async () => {
    const db = sqlPort(() => [
      {
        source_kind: "WSGS_GROUNDING_JOB",
        source_id: "g1",
        source_hash: publicCanonicalHash(frozenRequest()),
        source_revision: null,
        source_upstream_run_id: "job1",
        contract_identity: v11,
      },
    ]);
    const repository = new AnalysisRepository(db.pool);
    expect(
      await repository.getRevisionSource(
        { analysisId: "a1", principalId: "p1", threadId: "t1" },
        "r1",
      ),
    ).toMatchObject({ contractIdentity: v11 });
    expect(db.calls[0]!.parameters).toEqual(["a1", "p1", "t1", "r1"]);
    expect(db.calls[0]!.sql).toContain(
      "g.principal_id=s.principal_id AND g.thread_id=s.thread_id",
    );
  });
  it.each([undefined, v11])(
    "AC-005 rejects mismatched or missing snapshot identity against saved 1.2 intent %#",
    async (contractIdentity) => {
      const db = sqlPort((sql) =>
        sql.includes("SELECT execution.*")
          ? [
              {
                grounding_id: "local1",
                canonical_request_json: frozenRequest(),
                analysis_intent_json: { contractIdentity: v12 },
                lease_owner: "owner",
                lease_until: new Date(Date.now() + 60000),
                request_hash: publicCanonicalHash(frozenRequest()).slice(7),
                wsgs_grounding_id: "g1",
                wsgs_request_id: frozenRequest().requestId,
              },
            ]
          : [],
      );
      const repository = new GroundingPersistenceRepository(db.pool, 180000);
      await expect(
        repository.recordSourceSnapshot({
          groundingId: "local1",
          principalId: "p1",
          threadId: "t1",
          leaseOwner: "owner",
          snapshot: {
            identity: {
              kind: "WSGS_GROUNDING_JOB",
              sourceId: "g1",
              sourceHash: publicCanonicalHash(frozenRequest()),
              ...(contractIdentity ? { contractIdentity } : {}),
            },
            sourceStatus: "ACCEPTED",
            terminal: false,
            observedAt: new Date().toISOString(),
          },
        }),
      ).rejects.toThrow("ANALYSIS_SOURCE_IDENTITY_INVALID");
      expect(
        db.calls.some((c) =>
          c.sql.includes("UPDATE chat_service.grounding_execution"),
        ),
      ).toBe(false);
      expect(db.calls.at(-1)!.sql).toBe("ROLLBACK");
    },
  );
  it("AC-010 same body/key cannot replay across changed profile identity", async () => {
    const db = sqlPort((sql) =>
      sql.includes("FROM chat_service.interaction_request")
        ? [{ request_id: "i1" }]
        : sql.includes("SELECT *")
          ? [
              {
                request_hash: publicCanonicalHash(frozenRequest()).slice(7),
                analysis_intent_json: {
                  analysisId: "a1",
                  revisionId: "r1",
                  contractIdentity: v11,
                },
              },
            ]
          : [],
    );
    const repository = new GroundingPersistenceRepository(db.pool, 180000);
    await expect(
      repository.claim({
        groundingId: "local1",
        principalId: "p1",
        threadId: "t1",
        interactionRequestId: "i1",
        wsgsRequestId: frozenRequest().requestId,
        idempotencyKey: "key1",
        requestHash: publicCanonicalHash(frozenRequest()).slice(7),
        wsgsOperation: frozenRequest().operation,
        requestedProducts: frozenRequest().requestedProducts,
        contextUsage: {},
        leaseOwner: "owner",
        canonicalRequest: JSON.parse(JSON.stringify(frozenRequest())),
        analysisIntent: {
          analysisId: "a1",
          revisionId: "r1",
          contractIdentity: v12,
        },
      }),
    ).rejects.toThrow("ANALYSIS_SOURCE_REPLAY_CONFLICT");
    const insert = db.calls.find((c) =>
      c.sql.includes("INSERT INTO chat_service.grounding_execution"),
    )!;
    expect(JSON.parse(String(insert.parameters[13]))).toMatchObject({
      contractIdentity: v12,
    });
    expect(JSON.parse(String(insert.parameters[12]))).toEqual(frozenRequest());
  });
  it.each(["SUCCEEDED", "CANCELLED", "PARTIAL", "WAITING_INTERVENTION"])(
    "AC-032 completion/cancel race keeps actual committed %s, never writes pending over it",
    async (status) => {
      const db = sqlPort((sql) => {
        if (sql.includes("SELECT session.analysis_id"))
          return [
            {
              analysis_id: "a1",
              principal_id: "p1",
              thread_id: "t1",
              active_revision_id: "r1",
              latest_revision_number: 0,
              status: status === "CANCELLED" ? "CANCELLED" : "COMPLETED",
            },
          ];
        if (sql.includes("SELECT * FROM chat_service.analysis_control_command"))
          return [
            {
              analysis_id: "a1",
              command_kind: "CANCEL",
              command_id: "c1",
              request_hash: "hash1",
              claim_token: "claim1",
              expected_revision_id: "r1",
              expected_revision_number: 0,
              expected_run_id: "run1",
              status: "CLAIMED",
            },
          ];
        if (sql.includes("SELECT run.run_id"))
          return [
            {
              run_id: "run1",
              revision_number: 0,
              status,
              source_kind: "WSGS_GROUNDING_JOB",
            },
          ];
        if (sql.includes("SELECT state_revision"))
          return [{ state_revision: 7 }];
        return [{}];
      });
      const repository = new AnalysisDevelopmentRepository(db.pool);
      const pending = {
        schemaVersion: "sacs-analysis-run/1.0" as const,
        runId: "run1",
        revisionId: "r1",
        attempt: 1,
        status: "CANCEL_REQUESTED" as const,
        startedAt: "2026-09-06T00:00:00Z",
      };
      const input = {
        scope: { analysisId: "a1", userId: "u1", userRole: "user" },
        commandId: "c1",
        claimToken: "claim1",
        sourceCancellation: true,
        transition: {
          requested: pending,
          settled: pending,
          queueRevision: false,
        },
      };
      expect(
        await repository.commitCancellation({
          ...input,
          deferCommandCompletion: true,
        }),
      ).toMatchObject({
        status,
        acknowledged: status === "CANCELLED",
        stateRevision: 7,
      });
      expect(
        db.calls.some((c) =>
          c.sql.includes("SET status = 'COMPLETED', result_json"),
        ),
      ).toBe(false);
      expect(
        await repository.commitCancellation({
          ...input,
          sourceObservationError: "WSGS_CANCEL_OBSERVATION_UNCONFIRMED",
        }),
      ).toMatchObject({
        status,
        acknowledged: status === "CANCELLED",
        reasonCode: "WSGS_CANCEL_OBSERVATION_UNCONFIRMED",
      });
      expect(
        db.calls.some((c) =>
          c.sql.includes("UPDATE chat_service.analysis_run"),
        ),
      ).toBe(false);
      expect(
        db.calls.some((c) =>
          c.sql.includes("SET status = 'COMPLETED', result_json"),
        ),
      ).toBe(true);
    },
  );
});
