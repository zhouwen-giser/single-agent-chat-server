import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import pg from "pg";

import {
  AnalysisRepository,
  hashJson,
  PersistenceAuthorizationError,
  PersistenceConflictError,
  runMigrations,
  type AnalysisEvent,
  type AnalysisProjection,
  type AnalysisRevision,
  type AnalysisRun,
  type AnalysisScope,
  type AnalysisSession,
  type JsonValue,
} from "../packages/persistence/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const databaseName = "sacs_analysis_" + randomUUID().replaceAll("-", "");
const isolatedConnection =
  connectionString === undefined
    ? undefined
    : withDatabase(connectionString, databaseName);
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;
const now = "2026-08-30T01:00:00.000Z";

describeWithPostgres("SACS v0.5 analysis persistence on PostgreSQL", () => {
  const adminPool = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString: isolatedConnection, max: 8 });
  const repository = new AnalysisRepository(pool);
  let scope: AnalysisScope;
  let session: AnalysisSession;
  let revision: AnalysisRevision;
  let run: AnalysisRun;

  beforeAll(async () => {
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    await runMigrations(pool);
    scope = await seedThread(pool, "primary");
    ({ session, revision, run } = analysisFixture(scope));
    await repository.createSessionWithInitialRevision({ session, revision });
    await repository.startRun({ scope, run });
  });

  afterAll(async () => {
    await pool.end();
    if (connectionString !== undefined) {
      await adminPool
        .query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
        .catch(() => undefined);
    }
    await adminPool.end();
  });

  it("atomically appends an event and restores its exact projection snapshot", async () => {
    const state = { activeRevisionId: revision.revisionId, status: "RUNNING" };
    const activity = { nodesById: { "node-1": { status: "RUNNING" } } };
    const event = analysisEvent(scope, revision, run, 1, 1, {
      kind: "PLAN_PUBLISHED",
    });
    const projection = analysisProjection(scope, 1, 1, 1, state, activity);

    await expect(
      repository.appendEventAndProject({ scope, event, projection }),
    ).resolves.toMatchObject({
      created: true,
      projected: true,
      event: { eventId: event.eventId, analysisSequence: 1 },
      projection: { state, activity, lastEventSequence: 1 },
    });
    await expect(repository.getSnapshot(scope)).resolves.toEqual({
      session,
      projection,
    });
    await expect(
      pool.query(
        "SELECT count(*)::int AS count FROM chat_service.analysis_event WHERE analysis_id = $1",
        [scope.analysisId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("replays an exact duplicate but rejects event or sequence collisions", async () => {
    const state = { activeRevisionId: revision.revisionId, status: "RUNNING" };
    const activity = { nodesById: { "node-1": { status: "RUNNING" } } };
    const event = analysisEvent(scope, revision, run, 1, 1, {
      kind: "PLAN_PUBLISHED",
    });
    const projection = analysisProjection(scope, 1, 1, 1, state, activity);

    await expect(
      repository.appendEventAndProject({ scope, event, projection }),
    ).resolves.toMatchObject({ created: false, projected: false });

    const changed = {
      ...event,
      payload: { kind: "NODE_STARTED" },
      payloadHash: sha256({ kind: "NODE_STARTED" }),
    } as const;
    await expect(
      repository.appendEventAndProject({
        scope,
        event: changed,
        projection,
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
    await expect(
      repository.appendEventAndProject({
        scope,
        event: { ...event, eventId: "event-sequence-collision" },
        projection,
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
  });

  it("rolls back event insertion when the projection is invalid", async () => {
    const event = analysisEvent(scope, revision, run, 2, 2, {
      kind: "NODE_STARTED",
    });
    const invalidProjection = {
      ...analysisProjection(
        scope,
        2,
        2,
        2,
        { activeRevisionId: revision.revisionId, status: "RUNNING" },
        { nodesById: { "node-1": { status: "RUNNING" } } },
      ),
      stateHash: "sha256:" + "f".repeat(64),
    };
    await expect(
      repository.appendEventAndProject({
        scope,
        event,
        projection: invalidProjection,
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
    await expect(
      pool.query(
        "SELECT count(*)::int AS count FROM chat_service.analysis_event WHERE analysis_id = $1",
        [scope.analysisId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("switches active revisions with CAS and preserves late events as audit only", async () => {
    const nextRevision: AnalysisRevision = {
      ...revision,
      revisionId: "revision-2-" + scope.analysisId,
      revisionNumber: 2,
      parentRevisionId: revision.revisionId,
      cause: "USER_PROPOSAL",
      wsgsPlanId: "plan-2-" + scope.analysisId,
      planHash: "sha256:" + "2".repeat(64),
      changedPaths: ["/ranges/0/maximumInclusive"],
      reusedNodeIds: ["node-1"],
      rerunNodeIds: ["node-2"],
      createdAt: "2026-08-30T01:01:00.000Z",
    };
    await expect(
      repository.createRevision({
        scope,
        expectedRevisionId: revision.revisionId,
        expectedRevisionNumber: 1,
        revision: nextRevision,
        updatedAt: nextRevision.createdAt,
      }),
    ).resolves.toEqual(nextRevision);
    await expect(
      repository.createRevision({
        scope,
        expectedRevisionId: revision.revisionId,
        expectedRevisionNumber: 1,
        revision: { ...nextRevision, revisionId: "revision-stale" },
        updatedAt: nextRevision.createdAt,
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);

    const lateEvent = analysisEvent(scope, revision, run, 2, 2, {
      kind: "LATE_OLD_PLAN_EVENT",
    });
    await expect(
      repository.appendEventAndProject({ scope, event: lateEvent }),
    ).resolves.toMatchObject({
      created: true,
      projected: false,
      projection: {
        state: { activeRevisionId: revision.revisionId, status: "RUNNING" },
        lastEventSequence: 2,
      },
    });
    await expect(repository.findSession(scope)).resolves.toMatchObject({
      activeRevisionId: nextRevision.revisionId,
      latestRevisionNumber: 2,
    });
  });

  it("keeps a queued revision inactive until the old run is terminal, then activates and starts atomically", async () => {
    const queuedScope = await seedThread(pool, "queued");
    const queuedFixture = analysisFixture(queuedScope);
    await repository.createSessionWithInitialRevision({
      session: queuedFixture.session,
      revision: queuedFixture.revision,
    });
    await repository.startRun({
      scope: queuedScope,
      run: queuedFixture.run,
    });
    const queuedRevision: AnalysisRevision = {
      ...queuedFixture.revision,
      revisionId: "revision-2-" + queuedScope.analysisId,
      revisionNumber: 2,
      parentRevisionId: queuedFixture.revision.revisionId,
      parentRunId: queuedFixture.run.runId,
      cause: "USER_PROPOSAL",
      wsgsPlanId: "plan-2-" + queuedScope.analysisId,
      planHash: "sha256:" + "8".repeat(64),
      changedPaths: ["/radiusM"],
      status: "QUEUED",
      createdAt: "2026-08-30T01:03:00.000Z",
    };
    await repository.createRevision({
      scope: queuedScope,
      expectedRevisionId: queuedFixture.revision.revisionId,
      expectedRevisionNumber: 1,
      revision: queuedRevision,
      updatedAt: queuedRevision.createdAt,
    });
    await expect(repository.findSession(queuedScope)).resolves.toMatchObject({
      activeRevisionId: queuedFixture.revision.revisionId,
      latestRevisionNumber: 2,
    });

    const nextRun: AnalysisRun = {
      ...queuedFixture.run,
      runId: "run-2-" + queuedScope.analysisId,
      revisionId: queuedRevision.revisionId,
      parentRunId: queuedFixture.run.runId,
      upstreamRunId: "upstream-run-2-" + queuedScope.analysisId,
      startedAt: "2026-08-30T01:04:00.000Z",
    };
    const activation = {
      scope: queuedScope,
      expectedActiveRevisionId: queuedFixture.revision.revisionId,
      queuedRevisionId: queuedRevision.revisionId,
      queuedRevisionNumber: 2,
      run: nextRun,
      updatedAt: nextRun.startedAt,
    } as const;
    await expect(
      repository.activateQueuedRevisionAndStartRun(activation),
    ).rejects.toBeInstanceOf(PersistenceConflictError);

    await pool.query(
      `
        UPDATE chat_service.analysis_run
        SET status = 'SUCCEEDED',
            finished_at = $2::timestamptz
        WHERE run_id = $1
      `,
      [queuedFixture.run.runId, "2026-08-30T01:03:30.000Z"],
    );
    await expect(
      repository.activateQueuedRevisionAndStartRun(activation),
    ).resolves.toMatchObject({
      revision: { revisionId: queuedRevision.revisionId, status: "RUNNING" },
      run: { runId: nextRun.runId, parentRunId: queuedFixture.run.runId },
    });
    await expect(repository.findSession(queuedScope)).resolves.toMatchObject({
      activeRevisionId: queuedRevision.revisionId,
      latestRevisionNumber: 2,
    });
    await expect(
      pool.query(
        `
          SELECT revision_id, status
          FROM chat_service.analysis_revision
          WHERE analysis_id = $1
          ORDER BY revision_number
        `,
        [queuedScope.analysisId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          revision_id: queuedFixture.revision.revisionId,
          status: "SUPERSEDED",
        },
        { revision_id: queuedRevision.revisionId, status: "RUNNING" },
      ],
    });
  });

  it("enforces scoped proposal idempotency and one pending proposal", async () => {
    const active = await repository.findSession(scope);
    if (active === undefined) throw new Error("analysis session missing");
    const proposal = {
      scope,
      commandId: "command-1",
      proposalId: "proposal-1",
      expectedRevisionId: active.activeRevisionId,
      expectedRevisionNumber: active.latestRevisionNumber,
      targetNodeId: "node-2",
      publicArgsHash: "sha256:" + "3".repeat(64),
      editSchemaHash: "sha256:" + "4".repeat(64),
      patch: [
        { op: "replace", path: "/ranges/0/maximumInclusive", value: 25 },
      ] as const,
      mode: "SUGGEST_NEXT_REVISION" as const,
      idempotencyKey: "proposal-key-1",
      createdAt: "2026-08-30T01:02:00.000Z",
    };
    const first = await repository.saveProposal(proposal);
    const replay = await repository.saveProposal({
      ...proposal,
      proposalId: "proposal-replay-ignored",
    });
    expect(first).toMatchObject({ created: true });
    expect(replay).toEqual({ created: false, proposal: first.proposal });

    await expect(
      repository.saveProposal({
        ...proposal,
        patch: [
          { op: "replace", path: "/ranges/0/maximumInclusive", value: 24 },
        ],
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
    await expect(
      repository.saveProposal({
        ...proposal,
        commandId: "command-2",
        proposalId: "proposal-2",
        idempotencyKey: "proposal-key-2",
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);

    const foreign = await seedThread(pool, "foreign");
    await expect(
      repository.createRevision({
        scope: { ...scope, principalId: foreign.principalId },
        expectedRevisionId: active.activeRevisionId,
        expectedRevisionNumber: active.latestRevisionNumber,
        revision: {
          ...revision,
          revisionId: "foreign-revision",
          revisionNumber: active.latestRevisionNumber + 1,
          parentRevisionId: active.activeRevisionId,
        },
        updatedAt: now,
      }),
    ).rejects.toBeInstanceOf(PersistenceAuthorizationError);
    await expect(
      repository.getSnapshot({ ...scope, principalId: foreign.principalId }),
    ).resolves.toBeUndefined();
  });

  it("enforces run-attempt uniqueness and append-only events in PostgreSQL", async () => {
    await expect(
      repository.startRun({
        scope,
        run: { ...run, runId: "duplicate-attempt-run" },
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
    await expect(
      pool.query(
        "UPDATE chat_service.analysis_event SET event_type = 'MUTATED' WHERE event_id = $1",
        ["event-1-" + scope.analysisId],
      ),
    ).rejects.toThrow("analysis events are append-only");
    await expect(
      pool.query(
        "DELETE FROM chat_service.analysis_event WHERE event_id = $1",
        ["event-1-" + scope.analysisId],
      ),
    ).rejects.toThrow("analysis events are append-only");
  });
});

async function seedThread(
  pool: pg.Pool,
  label: string,
): Promise<AnalysisScope> {
  const suffix = label + "-" + randomUUID();
  const principalId = "principal-" + suffix;
  const threadId = "thread-" + suffix;
  await pool.query(
    "INSERT INTO chat_service.principal(principal_id, issuer, subject, role) VALUES ($1, 'analysis-test', $1, 'user')",
    [principalId],
  );
  await pool.query(
    "INSERT INTO chat_service.conversation_thread(thread_id, principal_id) VALUES ($1, $2)",
    [threadId, principalId],
  );
  return { analysisId: "analysis-" + suffix, principalId, threadId };
}

function analysisFixture(scope: AnalysisScope): {
  readonly session: AnalysisSession;
  readonly revision: AnalysisRevision;
  readonly run: AnalysisRun;
} {
  const revisionId = "revision-1-" + scope.analysisId;
  const session: AnalysisSession = {
    schemaVersion: "sacs-analysis-session/1.0",
    ...scope,
    groundingId: "grounding-" + scope.analysisId,
    title: "Observer-first analysis",
    autonomyMode: "OBSERVER",
    status: "ACTIVE",
    activeRevisionId: revisionId,
    latestRevisionNumber: 1,
    observerPolicyHash: "sha256:" + "0".repeat(64),
    createdAt: now,
    updatedAt: now,
  };
  const revision: AnalysisRevision = {
    schemaVersion: "sacs-analysis-revision/1.0",
    revisionId,
    analysisId: scope.analysisId,
    revisionNumber: 1,
    cause: "INITIAL_QUERY",
    wsgsPlanId: "plan-1-" + scope.analysisId,
    planHash: "sha256:" + "1".repeat(64),
    changedPaths: [],
    reusedNodeIds: [],
    invalidatedNodeIds: [],
    rerunNodeIds: ["node-1"],
    status: "RUNNING",
    createdAt: now,
  };
  const run: AnalysisRun = {
    schemaVersion: "sacs-analysis-run/1.0",
    runId: "run-1-" + scope.analysisId,
    analysisId: scope.analysisId,
    revisionId,
    attempt: 1,
    upstreamRunId: "upstream-run-1-" + scope.analysisId,
    status: "RUNNING",
    startedAt: now,
  };
  return { session, revision, run };
}

function analysisEvent(
  scope: AnalysisScope,
  revision: AnalysisRevision,
  run: AnalysisRun,
  analysisSequence: number,
  runSequence: number,
  payload: Readonly<Record<string, JsonValue>>,
): AnalysisEvent {
  return {
    schemaVersion: "sacs-analysis-event/1.0",
    eventId: `event-${analysisSequence}-${scope.analysisId}`,
    analysisId: scope.analysisId,
    revisionId: revision.revisionId,
    runId: run.runId,
    analysisSequence,
    runSequence,
    upstreamSequence: runSequence,
    eventType: String(payload.kind),
    correlationId: "correlation-" + scope.analysisId,
    occurredAt: new Date(
      Date.parse(now) + analysisSequence * 1000,
    ).toISOString(),
    payload,
    payloadHash: sha256(payload),
  };
}

function analysisProjection(
  scope: AnalysisScope,
  stateRevision: number,
  activityRevision: number,
  lastEventSequence: number,
  state: Readonly<Record<string, JsonValue>>,
  activity: Readonly<Record<string, JsonValue>>,
): AnalysisProjection {
  return {
    schemaVersion: "sacs-analysis-projection/1.0",
    analysisId: scope.analysisId,
    stateRevision,
    activityRevision,
    state,
    stateHash: sha256(state),
    activity,
    activityHash: sha256(activity),
    lastEventSequence,
    updatedAt: new Date(
      Date.parse(now) + lastEventSequence * 1000,
    ).toISOString(),
  };
}

function sha256(value: JsonValue): string {
  return "sha256:" + hashJson(value);
}

function withDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = "/" + database;
  return url.toString();
}
