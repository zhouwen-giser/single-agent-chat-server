import type { Pool } from "pg";
import { describe, expect, it } from "@jest/globals";
import {
  AnalysisDevelopmentRepository,
  AnalysisRepository,
  GroundingPersistenceRepository,
  ChatPersistenceRepository,
} from "../packages/persistence/src/index.js";
import { planFrozenGroundingRequest } from "../packages/grounding-request-planner/src/frozen-request.js";
import { publicCanonicalHash } from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";

const scope = { analysisId: "a1", principalId: "p1", threadId: "t1" };
const requestScope = { analysisId: "a1", userId: "u1", userRole: "user" };
const contractIdentity = {
  contractVersion: "sacs-wsgs-grounding/1.2",
  resultProfile: "wsgs-world-analysis-findings/1.0",
} as const;
const command = {
  kind: "GROUNDING_SOURCE_QUERY",
  commandId: "c1",
  idempotencyKey: "key1",
  expectedRevisionId: "r1",
  expectedRevisionNumber: 0,
  originalText: "排除暂停",
  contextMode: "CONTINUE",
} as const;
const requestHash = publicCanonicalHash(command);
const owned = {
  analysis_id: "a1",
  principal_id: "p1",
  thread_id: "t1",
  active_revision_id: "r1",
  latest_revision_number: 0,
  status: "COMPLETED",
};
const claimed = {
  analysis_id: "a1",
  command_kind: "SOURCE_REVISION",
  command_id: "c1",
  idempotency_key: "key1",
  request_hash: requestHash,
  claim_token: "claim1",
  expected_revision_id: "r1",
  expected_revision_number: 0,
  expected_run_id: "run1",
  intervention_id: null,
  status: "CLAIMED",
};

/** Real repository, scripted pg driver only. This is explicitly not ENV-001. */
function database(
  reply: (sql: string, p: readonly unknown[]) => Record<string, unknown>[],
) {
  const calls: { sql: string; p: readonly unknown[] }[] = [];
  const query = async (sql: string, p: readonly unknown[] = []) => {
    calls.push({ sql, p });
    const rows = reply(sql, p);
    return { rows, rowCount: rows.length };
  };
  return {
    pool: {
      query,
      connect: async () => ({ query, release: () => undefined }),
    } as unknown as Pool,
    calls,
  };
}
function claimDatabase(
  options: {
    foreign?: boolean;
    prior?: Record<string, unknown>;
    busy?: boolean;
    sourceKind?: string;
  } = {},
) {
  return database((sql) => {
    if (sql.includes("SELECT session.analysis_id"))
      return options.foreign ? [] : [owned];
    if (sql.includes("SELECT * FROM chat_service.analysis_control_command"))
      return options.prior ? [options.prior] : [];
    if (sql.includes("SELECT 1 FROM chat_service.analysis_control_command"))
      return options.busy ? [{}] : [];
    if (sql.includes("SELECT revision_number"))
      return [
        {
          revision_number: 0,
          source_kind: options.sourceKind ?? "WSGS_GROUNDING_JOB",
        },
      ];
    if (sql.includes("SELECT run_id, status"))
      return [{ run_id: "run1", status: "SUCCEEDED" }];
    return [{}];
  });
}
describe("C03 actual source revision persistence boundaries (ENV-001 NOT_RUN)", () => {
  it("Chat returns the resolved internal principal after AG-UI created a distinct identity", async () => {
    const db = database((sql) => {
      if (sql.includes("INSERT INTO chat_service.principal"))
        return [{ principal_id: "internal-principal" }];
      if (sql.includes("SELECT principal_id FROM chat_service.principal"))
        return [{ principal_id: "internal-principal" }];
      if (sql.includes("SELECT binding.internal_thread_id"))
        return [{ internal_thread_id: "shared-thread" }];
      if (sql.includes("INSERT INTO chat_service.chat_thread_binding"))
        return [
          {
            thread_id: "shared-thread",
            openwebui_chat_id: "external-thread",
            user_id: "external-user",
            user_role: "user",
          },
        ];
      return [{}];
    });
    const thread = await new ChatPersistenceRepository(
      db.pool,
      60000,
    ).getOrCreateThread({
      openWebUiChatId: "external-thread",
      userId: "external-user",
      userRole: "user",
    });
    expect(thread).toMatchObject({
      threadId: "shared-thread",
      principalId: "internal-principal",
      userId: "external-user",
    });
    const binding = db.calls.find((c) =>
      c.sql.includes("INSERT INTO chat_service.client_thread_binding"),
    )!;
    expect(binding.p.slice(1)).toEqual([
      "external-thread",
      "internal-principal",
      "shared-thread",
    ]);
  });
  it("recovery requires the actual revision/run terminal observation receipt, not any old projection", async () => {
    const db = database(() => []);
    expect(
      await new GroundingPersistenceRepository(
        db.pool,
        180000,
      ).claimRecoverable({ leaseOwner: "recover", sourceOnly: true }),
    ).toEqual([]);
    const select = db.calls.find((c) =>
      c.sql.includes("FOR UPDATE SKIP LOCKED"),
    )!;
    expect(select.sql).toContain(
      "e.revision_id=grounding_execution.analysis_revision_id",
    );
    expect(select.sql).toContain(
      "e.run_id=grounding_execution.analysis_run_id",
    );
    expect(select.sql).toContain(
      "IS NOT DISTINCT FROM grounding_execution.grounding_result_hash",
    );
    expect(select.sql).toContain("c.status='FAILED'");
    expect(select.sql).not.toContain("FROM chat_service.analysis_projection");
  });
  it("claims a new source query after the preceding result completed, with full original CAS", async () => {
    const db = claimDatabase();
    const repo = new AnalysisDevelopmentRepository(db.pool);
    expect(
      await repo.claimSourceRevision({
        scope: requestScope,
        command,
        requestHash,
      }),
    ).toMatchObject({ disposition: "CLAIMED" });
    const insert = db.calls.find((c) =>
      c.sql.includes("INSERT INTO chat_service.analysis_control_command"),
    )!;
    expect(insert.p.slice(0, 5)).toEqual([
      "a1",
      "SOURCE_REVISION",
      "c1",
      "key1",
      requestHash,
    ]);
    expect(insert.p.slice(6, 10)).toEqual(["r1", 0, "run1", null]);
    expect(db.calls.at(-1)?.sql).toBe("COMMIT");
  });
  it("replays before obsolete CAS/status checks and rejects changed semantic hashes", async () => {
    const result = { analysisId: "a1", revisionId: "r2", status: "ACCEPTED" };
    const db = claimDatabase({
      prior: { ...claimed, status: "COMPLETED", result_json: result },
    });
    const repo = new AnalysisDevelopmentRepository(db.pool);
    expect(
      await repo.claimSourceRevision({
        scope: requestScope,
        command,
        requestHash,
      }),
    ).toEqual({ disposition: "REPLAY", result });
    expect(
      await repo.claimSourceRevision({
        scope: requestScope,
        command,
        requestHash: publicCanonicalHash({
          ...command,
          originalText: "另一个条件",
        }),
      }),
    ).toEqual({ disposition: "IDEMPOTENCY_CONFLICT" });
    expect(db.calls.some((c) => c.sql.includes("INSERT INTO"))).toBe(false);
  });
  it.each(["foreign", "stale", "native", "busy"])(
    "rejects %s before source intent creation",
    async (kind) => {
      const db = claimDatabase({
        foreign: kind === "foreign",
        busy: kind === "busy",
        ...(kind === "native" ? { sourceKind: "WSGS_NATIVE_ANALYSIS" } : {}),
      });
      const promise = new AnalysisDevelopmentRepository(
        db.pool,
      ).claimSourceRevision({
        scope: requestScope,
        command:
          kind === "stale" ? { ...command, expectedRevisionId: "r0" } : command,
        requestHash,
      });
      if (kind === "busy")
        expect(await promise).toEqual({ disposition: "PENDING_CONFLICT" });
      else await expect(promise).rejects.toThrow();
      expect(db.calls.some((c) => c.sql.includes("INSERT INTO"))).toBe(false);
    },
  );
  it("stores the entire validated request and compact recovery intent in the existing transaction", async () => {
    const plan = planFrozenGroundingRequest({
      ...scope,
      commandId: "c1",
      text: "改查第二次任务/丢包率" + "条件".repeat(3000),
      contextMode: "REPLACE",
      createdAt: "2026-09-06T02:00:30Z",
      now: () => Date.parse("2026-09-06T02:00:30Z"),
    });
    if (plan.kind !== "QUERY") throw Error("query required");
    const db = database((sql, p) => {
      if (sql.includes("SELECT session.analysis_id")) return [owned];
      if (sql.includes("SELECT * FROM chat_service.analysis_control_command"))
        return [
          {
            ...claimed,
            command_kind: "INTERVENTION_RESOLUTION",
            intervention_id: "choice1",
          },
        ];
      if (sql.includes("SELECT interaction_request_id,analysis_run_id"))
        return [
          {
            interaction_request_id: "i1",
            analysis_run_id: "run1",
            contract_identity: contractIdentity,
          },
        ];
      if (sql.includes("INSERT INTO chat_service.grounding_execution"))
        return [
          {
            grounding_id: p[0],
            interaction_request_id: p[3],
            canonical_request_json: JSON.parse(String(p[10])),
            analysis_intent_json: JSON.parse(String(p[11])),
            idempotency_key: p[5],
            request_hash: p[6],
          },
        ];
      return [{}];
    });
    const repo = new AnalysisDevelopmentRepository(db.pool);
    const prepared = await repo.prepareSourceRevision({
      scope: requestScope,
      commandId: "c1",
      commandKind: "INTERVENTION_RESOLUTION",
      claimToken: "claim1",
      plan: { ...plan, parentRevisionId: "r1" },
      groundingExecutionId: "g2",
      revisionId: "r2",
      leaseOwner: "owner",
      response: { originalText: plan.request.source.originalText },
    });
    expect(prepared.request).toEqual(plan.request);
    expect(prepared.requestHash).toBe(publicCanonicalHash(plan.request));
    expect(prepared.analysisIntent).toMatchObject({
      analysisId: "a1",
      revisionId: "r2",
      contractIdentity,
      parentRevisionId: "r1",
      parentRunId: "run1",
      parentRevisionNumber: 0,
      commandId: "c1",
      commandKind: "INTERVENTION_RESOLUTION",
      interventionId: "choice1",
    });
    expect(
      Buffer.byteLength(JSON.stringify(prepared.analysisIntent)),
    ).toBeLessThan(4096);
    expect(prepared.analysisIntent).not.toHaveProperty("response");
    expect(db.calls.at(-1)?.sql).toBe("COMMIT");
  });
  it("does not store a request with mismatched canonical hash", async () => {
    const plan = planFrozenGroundingRequest({
      ...scope,
      commandId: "c1",
      text: "排除暂停",
      createdAt: "2026-09-06T02:00:30Z",
    });
    if (plan.kind !== "QUERY") throw Error("query required");
    const db = database(() => {
      throw Error("must reject before transaction");
    });
    await expect(
      new AnalysisDevelopmentRepository(db.pool).prepareSourceRevision({
        scope: requestScope,
        commandId: "c1",
        commandKind: "SOURCE_REVISION",
        claimToken: "claim1",
        plan: { ...plan, requestHash: publicCanonicalHash({}) },
        groundingExecutionId: "g2",
        revisionId: "r2",
        leaseOwner: "owner",
      }),
    ).rejects.toThrow("ANALYSIS_SOURCE_REQUEST_HASH_MISMATCH");
    expect(db.calls).toHaveLength(0);
  });
  it.each([false, true])(
    "binds new source under parent CAS and fencing, lost claim=%s",
    async (lost) => {
      const intent = {
        analysisId: "a1",
        revisionId: "r2",
        contractIdentity,
        parentRevisionId: "r1",
        parentRunId: "run1",
        parentRevisionNumber: 0,
        commandKind: "SOURCE_REVISION",
        commandId: "c1",
      };
      const db = database((sql) => {
        if (sql.includes("SELECT session.*"))
          return [
            {
              ...owned,
              grounding_id: "upstream1",
              title: "World",
              autonomy_mode: "OBSERVER",
              observer_policy_hash: publicCanonicalHash({}),
              created_at: new Date(),
              updated_at: new Date(),
            },
          ];
        if (sql.includes("SELECT * FROM chat_service.grounding_execution"))
          return [
            {
              wsgs_grounding_id: "upstream2",
              request_hash: publicCanonicalHash({}).slice(7),
              source_job_id: "job2",
              analysis_revision_id: null,
              analysis_run_id: null,
              analysis_intent_json: intent,
              lease_owner: "owner",
              lease_until: new Date(Date.now() + 60000),
            },
          ];
        if (sql.includes("SELECT c.claim_token,c.intervention_id"))
          return lost ? [] : [{ claim_token: "claim1", intervention_id: null }];
        return [{}];
      });
      const work = new AnalysisRepository(db.pool).bindGroundingSource({
        scope,
        groundingExecutionId: "g2",
        revisionId: "r2",
        runId: "run2",
        leaseOwner: "owner",
        title: "World",
      });
      if (lost) {
        await expect(work).rejects.toThrow("ANALYSIS_MUTATION_CLAIM_LOST");
        expect(db.calls.at(-1)?.sql).toBe("ROLLBACK");
        expect(db.calls.some((c) => c.sql.includes("INSERT INTO"))).toBe(false);
        return;
      }
      await work;
      const revision = db.calls.find((c) =>
        c.sql.includes("INSERT INTO chat_service.analysis_revision"),
      )!;
      expect(revision.p).toEqual(
        expect.arrayContaining([
          "r2",
          "a1",
          1,
          "r1",
          "run1",
          "USER_PROPOSAL",
          "WSGS_GROUNDING_JOB",
          "upstream2",
        ]),
      );
      const advanced = db.calls.find((c) =>
        c.sql.includes("SET active_revision_id=$4"),
      )!;
      expect(advanced.p.slice(0, 5)).toEqual(["a1", "r1", "claim1", "r2", 1]);
      const completed = db.calls.find((c) =>
        c.sql.includes("SET status='COMPLETED',result_json"),
      )!;
      expect(JSON.parse(String(completed.p[4]))).toEqual({
        analysisId: "a1",
        revisionId: "r2",
        revisionNumber: 1,
        runId: "run2",
        groundingExecutionId: "g2",
        status: "ACCEPTED",
      });
      expect(
        db.calls.findIndex((c) => c.sql.includes("SELECT session.*")),
      ).toBeLessThan(
        db.calls.findIndex((c) =>
          c.sql.includes("SELECT * FROM chat_service.grounding_execution"),
        ),
      );
      expect(db.calls.some((c) => c.sql.includes("DELETE"))).toBe(false);
      expect(db.calls.at(-1)?.sql).toBe("COMMIT");
    },
  );
  it("old revision observations never append a current projection or complete its run", async () => {
    const db = database((sql) =>
      sql.includes("SELECT session.*")
        ? [{ ...owned, active_revision_id: "r2" }]
        : [],
    );
    expect(
      await new AnalysisRepository(db.pool).projectGroundingSource({
        scope,
        groundingExecutionId: "g1",
        revisionId: "r1",
        runId: "run1",
        observationHash: publicCanonicalHash({}),
        state: {},
      }),
    ).toBeUndefined();
    expect(db.calls.some((c) => /UPDATE|INSERT INTO/u.test(c.sql))).toBe(true); // only SELECT ... FOR UPDATE locks ownership
    expect(db.calls.some((c) => /^\s*(UPDATE|INSERT INTO)/u.test(c.sql))).toBe(
      false,
    );
  });
});
