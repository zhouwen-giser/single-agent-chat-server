import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it, expect } from "@jest/globals";
import pg from "pg";
import {
  AnalysisRepository,
  runMigrations,
  type AnalysisScope,
  type AnalysisSession,
  type AnalysisRevision,
} from "../packages/persistence/src/index.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";
const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
suite("v0.6 source identity empty and v0.5 upgrade PostgreSQL", () => {
  const name = "sacs_v06_" + randomUUID().replaceAll("-", "");
  const url = new URL(connectionString!);
  url.pathname = "/" + name;
  const admin = new pg.Pool({ connectionString, max: 1 });
  const pool = new pg.Pool({ connectionString: url.href });
  const repository = new AnalysisRepository(pool);
  let legacy: ReturnType<typeof fixture>;
  let legacyDir: string;
  let legacySnapshot: unknown;
  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${name}"`);
    legacyDir = await mkdtemp(join(tmpdir(), "sacs-v06-upgrade-"));
    for (const f of (await readdir("migrations")).filter(
      (f) => f.endsWith(".sql") && f < "0017",
    ))
      await copyFile(join("migrations", f), join(legacyDir, f));
    await runMigrations(pool, legacyDir);
    legacy = await seed("legacy");
    await pool.query("BEGIN");
    await pool.query(
      `INSERT INTO chat_service.analysis_session(analysis_id,principal_id,thread_id,grounding_id,title,autonomy_mode,status,active_revision_id,latest_revision_number,observer_policy_hash,created_at,updated_at) VALUES ($1,$2,$3,$4,'legacy','OBSERVER','ACTIVE',$5,0,$6,now(),now())`,
      [
        legacy.scope.analysisId,
        legacy.scope.principalId,
        legacy.scope.threadId,
        "g-legacy",
        legacy.revision.revisionId,
        legacy.session.observerPolicyHash,
      ],
    );
    await pool.query(
      `INSERT INTO chat_service.analysis_revision(revision_id,analysis_id,revision_number,cause,wsgs_plan_id,plan_hash,changed_paths_json,reused_node_ids_json,invalidated_node_ids_json,rerun_node_ids_json,status,created_at) VALUES ($1,$2,0,'INITIAL_QUERY','legacy-plan',$3,'[]','[]','[]','[]','READY',now())`,
      [
        legacy.revision.revisionId,
        legacy.scope.analysisId,
        legacy.session.observerPolicyHash,
      ],
    );
    await pool.query("COMMIT");
    const now = new Date().toISOString();
    await repository.startRun({
      scope: legacy.scope,
      run: {
        schemaVersion: "sacs-analysis-run/1.0",
        runId: "run-legacy",
        analysisId: legacy.scope.analysisId,
        revisionId: legacy.revision.revisionId,
        attempt: 1,
        status: "RUNNING",
        startedAt: now,
      },
    });
    await repository.appendEventAndProject({
      scope: legacy.scope,
      event: {
        schemaVersion: "sacs-analysis-event/1.0",
        eventId: "event-legacy",
        analysisId: legacy.scope.analysisId,
        revisionId: legacy.revision.revisionId,
        runId: "run-legacy",
        analysisSequence: 1,
        runSequence: 1,
        eventType: "ANALYSIS_STARTED",
        correlationId: "correlation-legacy",
        occurredAt: now,
        payload: {},
        payloadHash: hashCanonicalJson({}),
      },
      projection: {
        schemaVersion: "sacs-analysis-projection/1.0",
        analysisId: legacy.scope.analysisId,
        stateRevision: 1,
        activityRevision: 1,
        state: { legacy: true },
        stateHash: hashCanonicalJson({ legacy: true }),
        activity: {},
        activityHash: hashCanonicalJson({}),
        lastEventSequence: 1,
        updatedAt: now,
      },
    });
    legacySnapshot = await pool.query(
      "SELECT row_to_json(e) AS value FROM chat_service.analysis_event e UNION ALL SELECT row_to_json(p) AS value FROM chat_service.analysis_projection p",
    );
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
    if (legacyDir) await rm(legacyDir, { recursive: true, force: true });
  });
  async function seed(label: string) {
    const f = fixture(label);
    await pool.query(
      `INSERT INTO chat_service.principal(principal_id,issuer,subject,role) VALUES ($1,'v06',$1,'user')`,
      [f.scope.principalId],
    );
    await pool.query(
      "INSERT INTO chat_service.conversation_thread(thread_id,principal_id) VALUES ($1,$2)",
      [f.scope.threadId, f.scope.principalId],
    );
    return f;
  }
  it("preserves existing Native fields while marking only existing rows read-only", async () => {
    expect((await runMigrations(pool)).at(-1)?.version).toBe(
      "0017_analysis_source_identity.sql",
    );
    expect(
      await repository.getRevisionSource(
        legacy.scope,
        legacy.revision.revisionId,
      ),
    ).toMatchObject({
      kind: "LEGACY_PLAN",
      sourceId: "legacy-plan",
      readOnly: true,
    });
    expect(
      (
        await pool.query(
          "SELECT wsgs_plan_id FROM chat_service.analysis_revision WHERE revision_id=$1",
          [legacy.revision.revisionId],
        )
      ).rows[0].wsgs_plan_id,
    ).toBe("legacy-plan");
    expect(
      await pool.query(
        "SELECT row_to_json(e) AS value FROM chat_service.analysis_event e UNION ALL SELECT row_to_json(p) AS value FROM chat_service.analysis_projection p",
      ),
    ).toEqual(legacySnapshot);
  });
  it("round trips a Grounding identity with NULL Native columns and scope protection", async () => {
    const f = await seed("job");
    await repository.createSessionWithInitialRevision(f);
    expect(
      await repository.getRevisionSource(f.scope, f.revision.revisionId),
    ).toEqual(f.revision.source);
    expect(
      await repository.getRevisionSource(
        { ...f.scope, threadId: legacy.scope.threadId },
        f.revision.revisionId,
      ),
    ).toBeUndefined();
    expect(
      (
        await pool.query(
          "SELECT wsgs_plan_id,plan_hash FROM chat_service.analysis_revision WHERE revision_id=$1",
          [f.revision.revisionId],
        )
      ).rows[0],
    ).toEqual({ wsgs_plan_id: null, plan_hash: null });
    await expect(
      pool.query(
        "UPDATE chat_service.analysis_revision SET source_id='changed' WHERE revision_id=$1",
        [f.revision.revisionId],
      ),
    ).rejects.toThrow("ANALYSIS_SOURCE_IDENTITY_IMMUTABLE");
  });
  it("rejects new LEGACY_PLAN through both repository and SQL", async () => {
    const f = await seed("forbidden");
    f.revision = {
      ...f.revision,
      wsgsPlanId: "p",
      planHash: f.session.observerPolicyHash,
      source: {
        kind: "LEGACY_PLAN",
        sourceId: "p",
        sourceHash: f.session.observerPolicyHash,
        readOnly: true,
      },
    };
    await expect(
      repository.createSessionWithInitialRevision(f),
    ).rejects.toThrow("ANALYSIS_SOURCE_LEGACY_WRITE_FORBIDDEN");
    await expect(
      pool.query(
        `INSERT INTO chat_service.analysis_revision(revision_id,analysis_id,revision_number,cause,wsgs_plan_id,plan_hash,changed_paths_json,reused_node_ids_json,invalidated_node_ids_json,rerun_node_ids_json,status,created_at,source_kind,source_id,source_hash) VALUES ('forbidden',$1,1,'USER_PROPOSAL','p',$2,'[]','[]','[]','[]','READY',now(),'LEGACY_PLAN','p',$2)`,
        [legacy.scope.analysisId, f.session.observerPolicyHash],
      ),
    ).rejects.toThrow("ANALYSIS_SOURCE_LEGACY_WRITE_FORBIDDEN");
  });
});
function fixture(label: string) {
  const scope: AnalysisScope = {
    analysisId: "a-" + label,
    principalId: "p-" + label,
    threadId: "t-" + label,
  };
  const now = new Date().toISOString();
  const hash = "sha256:" + "a".repeat(64);
  const revision: AnalysisRevision = {
    schemaVersion: "sacs-analysis-revision/1.0",
    revisionId: "r-" + label,
    analysisId: scope.analysisId,
    revisionNumber: 0,
    cause: "INITIAL_QUERY",
    source: {
      kind: "WSGS_GROUNDING_JOB",
      sourceId: "g-" + label,
      sourceHash: hash,
    },
    changedPaths: [],
    reusedNodeIds: [],
    invalidatedNodeIds: [],
    rerunNodeIds: [],
    status: "READY",
    createdAt: now,
  };
  const session: AnalysisSession = {
    schemaVersion: "sacs-analysis-session/1.0",
    ...scope,
    groundingId: "g-" + label,
    title: label,
    autonomyMode: "OBSERVER",
    status: "ACTIVE",
    activeRevisionId: revision.revisionId,
    latestRevisionNumber: 0,
    observerPolicyHash: hash,
    createdAt: now,
    updatedAt: now,
  };
  return { scope, session, revision };
}
