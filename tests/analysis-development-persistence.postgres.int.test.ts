import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import pg from "pg";

import {
  AnalysisDevelopmentPumpError,
  createAnalysisDevelopmentRuntime,
} from "../packages/analysis-development-runtime/src/index.js";
import { createAnalysisControlCoordinator } from "../packages/analysis-control-runtime/src/index.js";
import { ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION } from "../packages/analysis-contract/src/index.js";
import {
  AnalysisDevelopmentRepository,
  AnalysisRepository,
  PersistenceConflictError,
  runMigrations,
} from "../packages/persistence/src/index.js";
import { FixtureWsgsAnalysisAdapter } from "../packages/wsgs-analysis-adapter/src/index.js";
import { hashCanonicalJson } from "../packages/world-explanation-contract/src/index.js";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const databaseName = "sacs_analysis_dev_" + randomUUID().replaceAll("-", "");
const isolatedConnection =
  connectionString === undefined
    ? undefined
    : withDatabase(connectionString, databaseName);
const describeWithPostgres =
  connectionString === undefined ? describe.skip : describe;
const now = "2026-09-05T02:00:00.000Z";
const environment = { nodeEnv: "test", adapterMode: "fixture" } as const;
const adapterEnvironment = {
  NODE_ENV: "test",
  SACS_ANALYSIS_ADAPTER_MODE: "fixture",
} as const;

describeWithPostgres(
  "v0.5 analysis development runtime with real PostgreSQL",
  () => {
    const adminPool = new Pool({ connectionString, max: 1 });
    const pool = new Pool({ connectionString: isolatedConnection, max: 8 });
    const repository = new AnalysisDevelopmentRepository(
      pool,
      new AnalysisRepository(pool),
    );

    beforeAll(async () => {
      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
      await runMigrations(pool);
    });

    afterAll(async () => {
      await pool.end();
      if (connectionString !== undefined) {
        await waitForDatabaseDisconnect(adminPool, databaseName);
        await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      }
      await adminPool.end();
    });

    it("installs database uniqueness backstops for claimed control commands", async () => {
      const indexes = await pool.query<{ indexname: string; indexdef: string }>(
        `
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE schemaname = 'chat_service'
            AND indexname IN (
              'analysis_one_claimed_cancel',
              'analysis_one_claimed_intervention_resolution'
            )
          ORDER BY indexname
        `,
      );
      expect(indexes.rows).toHaveLength(2);
      expect(indexes.rows).toEqual([
        expect.objectContaining({
          indexname: "analysis_one_claimed_cancel",
          indexdef: expect.stringContaining("UNIQUE INDEX"),
        }),
        expect.objectContaining({
          indexname: "analysis_one_claimed_intervention_resolution",
          indexdef: expect.stringContaining("UNIQUE INDEX"),
        }),
      ]);
      expect(indexes.rows[0]?.indexdef).toContain("status = 'CLAIMED'");
      expect(indexes.rows[1]?.indexdef).toContain("status = 'CLAIMED'");
    });

    it("persists an immutable queued proposal revision while its current run remains active", async () => {
      const identity = await seedIdentity(pool, "proposal");
      const adapter = fixtureAdapter();
      const runtime = createAnalysisDevelopmentRuntime({
        repository,
        adapter,
        environment,
        now: () => now,
        nextId: (kind) => `${kind}-proposal-next`,
      });
      const started = await runtime.startAnalysis({
        ...identity.scope,
        groundingId: "grounding-proposal",
        revisionId: "revision-proposal-active",
        runId: "run-proposal-active",
        scenario: "SUCCESS",
      });
      const descriptor = started.sourceSnapshot.toolInteractions[0];
      if (descriptor === undefined)
        throw new Error("fixture descriptor missing");
      const requestScope = {
        analysisId: identity.scope.analysisId,
        userId: identity.userId,
        userRole: "user",
      } as const;
      const command = {
        commandId: "command-proposal",
        proposalId: "proposal-development",
        expectedRevisionId: started.revision.revisionId,
        expectedRevisionNumber: started.revision.revisionNumber,
        targetNodeId: descriptor.nodeId,
        publicArgsHash: descriptor.publicArgsHash,
        editSchemaHash: descriptor.publicEditSchemaHash,
        patch: [{ op: "replace" as const, path: "/radiusMeters", value: 750 }],
        mode: "SUGGEST_NEXT_REVISION" as const,
        idempotencyKey: "proposal-development-key",
      };

      const result = await runtime.analysisControl.submitProposal(
        requestScope,
        command,
      );
      expect(result).toEqual({
        status: "COMPILED",
        proposalId: command.proposalId,
        revisionId: "revision-proposal-next",
        appliedRevisionId: "revision-proposal-next",
      });
      const persisted = await pool.query<{
        active_revision_id: string;
        latest_revision_number: number;
        current_run_status: string;
        queued_status: string;
        proposal_status: string;
      }>(
        `
          SELECT session.active_revision_id, session.latest_revision_number,
                 run.status AS current_run_status,
                 queued.status AS queued_status,
                 proposal.status AS proposal_status
          FROM chat_service.analysis_session session
          JOIN chat_service.analysis_run run
            ON run.analysis_id = session.analysis_id
           AND run.run_id = $2
          JOIN chat_service.analysis_revision queued
            ON queued.analysis_id = session.analysis_id
           AND queued.revision_id = $3
          JOIN chat_service.analysis_change_proposal proposal
            ON proposal.analysis_id = session.analysis_id
           AND proposal.proposal_id = $4
          WHERE session.analysis_id = $1
        `,
        [
          identity.scope.analysisId,
          started.run.runId,
          "revision-proposal-next",
          command.proposalId,
        ],
      );
      expect(persisted.rows[0]).toEqual({
        active_revision_id: started.revision.revisionId,
        latest_revision_number: 1,
        current_run_status: "RUNNING",
        queued_status: "QUEUED",
        proposal_status: "APPLIED",
      });
      await expect(
        runtime.analysisControl.submitProposal(requestScope, {
          ...command,
          commandId: "command-stale",
          proposalId: "proposal-stale",
          idempotencyKey: "proposal-stale-key",
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "ANALYSIS_REVISION_CONFLICT",
      });
      const beforeReplay = adapter.getCounters();
      await expect(
        runtime.analysisControl.submitProposal(requestScope, command),
      ).resolves.toEqual(result);
      expect(adapter.getCounters().executions.COMPILE_REVISION).toBe(
        beforeReplay.executions.COMPILE_REVISION,
      );
      await expect(
        runtime.analysisControl.requestCancel(requestScope, {
          commandId: "command-cancel-active-with-queued",
          expectedRevisionId: started.revision.revisionId,
          expectedRevisionNumber: started.revision.revisionNumber,
          idempotencyKey: "cancel-active-with-queued-key",
          reason: "USER_REQUESTED",
        }),
      ).resolves.toMatchObject({
        status: "CANCELLED",
        acknowledged: true,
      });
      await expect(
        runtime.analysisControl.getAnalysis({
          ...requestScope,
          userId: "another-user",
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects a sensitive Proposal patch before any claim or proposal row is durable", async () => {
      const identity = await seedIdentity(pool, "proposal-non-disclosure");
      const runtime = createAnalysisDevelopmentRuntime({
        repository,
        adapter: fixtureAdapter(),
        environment,
        now: () => now,
      });
      const started = await runtime.startAnalysis({
        ...identity.scope,
        groundingId: "grounding-proposal-non-disclosure",
        revisionId: "revision-proposal-non-disclosure",
        runId: "run-proposal-non-disclosure",
        scenario: "AMBIGUITY",
      });
      const descriptor = started.sourceSnapshot.toolInteractions[0];
      if (descriptor === undefined)
        throw new Error("fixture descriptor missing");
      const proposal = {
        schemaVersion: "sacs-analysis-change-proposal/1.0" as const,
        commandId: "command-proposal-non-disclosure",
        proposalId: "proposal-non-disclosure",
        analysisId: identity.scope.analysisId,
        expectedRevisionId: started.revision.revisionId,
        expectedRevisionNumber: started.revision.revisionNumber,
        targetNodeId: descriptor.nodeId,
        publicArgsHash: descriptor.publicArgsHash,
        editSchemaHash: descriptor.publicEditSchemaHash,
        patch: [
          { op: "add" as const, path: "/auth", value: "credential-material" },
        ],
        mode: "SUGGEST_NEXT_REVISION" as const,
        idempotencyKey: "proposal-non-disclosure-key",
        status: "SUBMITTED" as const,
        createdAt: now,
      };
      await expect(
        repository.claimProposal({
          scope: {
            analysisId: identity.scope.analysisId,
            userId: identity.userId,
            userRole: "user",
          },
          proposal,
          requestHash: hashCanonicalJson(proposal),
        }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
        message: ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
      });
      await expect(
        pool.query(
          `
            SELECT 1 FROM chat_service.analysis_change_proposal
            WHERE analysis_id = $1 AND proposal_id = $2
          `,
          [identity.scope.analysisId, proposal.proposalId],
        ),
      ).resolves.toMatchObject({ rows: [] });
      await expect(
        pool.query(
          `
            SELECT 1 FROM chat_service.analysis_session
            WHERE analysis_id = $1 AND mutation_claim_token IS NOT NULL
          `,
          [identity.scope.analysisId],
        ),
      ).resolves.toMatchObject({ rows: [] });
    });

    it("atomically activates an acknowledged interrupt revision with a replacement Run", async () => {
      const identity = await seedIdentity(pool, "interrupt");
      const adapter = fixtureAdapter();
      const runtime = createAnalysisDevelopmentRuntime({
        repository,
        adapter,
        environment,
        now: () => now,
        nextId: (kind) => `${kind}-interrupt-next`,
      });
      const started = await runtime.startAnalysis({
        ...identity.scope,
        groundingId: "grounding-interrupt",
        revisionId: "revision-interrupt-active",
        runId: "run-interrupt-active",
      });
      const descriptor = started.sourceSnapshot.toolInteractions[0];
      if (descriptor === undefined)
        throw new Error("fixture descriptor missing");
      const interruptDescriptor = {
        ...descriptor,
        editPolicy: "CANCEL_AND_RESTART_ALLOWED" as const,
      };
      await pool.query(
        `
          UPDATE chat_service.analysis_tool_interaction_descriptor
          SET descriptor_json = $3::jsonb, descriptor_hash = $4
          WHERE analysis_id = $1 AND tool_call_id = $2
        `,
        [
          identity.scope.analysisId,
          descriptor.toolCallId,
          JSON.stringify(interruptDescriptor),
          hashCanonicalJson(interruptDescriptor),
        ],
      );
      const requestScope = {
        analysisId: identity.scope.analysisId,
        userId: identity.userId,
        userRole: "user",
      } as const;
      await expect(
        runtime.analysisControl.submitProposal(requestScope, {
          commandId: "command-interrupt",
          proposalId: "proposal-interrupt",
          expectedRevisionId: started.revision.revisionId,
          expectedRevisionNumber: started.revision.revisionNumber,
          targetNodeId: descriptor.nodeId,
          publicArgsHash: descriptor.publicArgsHash,
          editSchemaHash: descriptor.publicEditSchemaHash,
          patch: [
            { op: "replace" as const, path: "/radiusMeters", value: 800 },
          ],
          mode: "INTERRUPT_AND_APPLY",
          idempotencyKey: "proposal-interrupt-key",
        }),
      ).resolves.toEqual({
        status: "COMPILED",
        proposalId: "proposal-interrupt",
        revisionId: "revision-interrupt-next",
        appliedRevisionId: "revision-interrupt-next",
        replacementRunId: "run-interrupt-next",
      });
      const persisted = await pool.query<{
        active_revision_id: string;
        latest_revision_number: number;
        prior_revision_status: string;
        next_revision_status: string;
        prior_run_status: string;
        next_run_status: string;
        parent_run_id: string;
      }>(
        `
          SELECT session.active_revision_id, session.latest_revision_number,
                 prior_revision.status AS prior_revision_status,
                 next_revision.status AS next_revision_status,
                 prior_run.status AS prior_run_status,
                 next_run.status AS next_run_status,
                 next_run.parent_run_id
          FROM chat_service.analysis_session session
          JOIN chat_service.analysis_revision prior_revision
            ON prior_revision.revision_id = $2
          JOIN chat_service.analysis_revision next_revision
            ON next_revision.revision_id = $3
          JOIN chat_service.analysis_run prior_run
            ON prior_run.run_id = $4
          JOIN chat_service.analysis_run next_run
            ON next_run.run_id = $5
          WHERE session.analysis_id = $1
        `,
        [
          identity.scope.analysisId,
          started.revision.revisionId,
          "revision-interrupt-next",
          started.run.runId,
          "run-interrupt-next",
        ],
      );
      expect(persisted.rows[0]).toEqual({
        active_revision_id: "revision-interrupt-next",
        latest_revision_number: 1,
        prior_revision_status: "SUPERSEDED",
        next_revision_status: "READY",
        prior_run_status: "CANCELLED",
        next_run_status: "STARTING",
        parent_run_id: started.run.runId,
      });
      await expect(
        repository.getDevelopmentSnapshot(identity.scope),
      ).resolves.toMatchObject({
        currentRevision: { revisionId: "revision-interrupt-next" },
        currentRun: { runId: "run-interrupt-next", status: "STARTING" },
        projection: {
          state: {
            analysis: {
              activeRevisionId: "revision-interrupt-next",
            },
          },
        },
      });
    });

    it("keeps an unacknowledged cancellation durably CANCEL_REQUESTED", async () => {
      const identity = await seedIdentity(pool, "cancel");
      const adapter = fixtureAdapter(false);
      const runtime = createAnalysisDevelopmentRuntime({
        repository,
        adapter,
        environment,
        now: () => now,
      });
      const started = await runtime.startAnalysis({
        ...identity.scope,
        groundingId: "grounding-cancel",
        revisionId: "revision-cancel-active",
        runId: "run-cancel-active",
      });
      const requestScope = {
        analysisId: identity.scope.analysisId,
        userId: identity.userId,
        userRole: "user",
      } as const;
      const command = {
        commandId: "command-cancel",
        expectedRevisionId: started.revision.revisionId,
        expectedRevisionNumber: started.revision.revisionNumber,
        idempotencyKey: "cancel-development-key",
        reason: "USER_REQUESTED" as const,
      };
      const result = await runtime.analysisControl.requestCancel(
        requestScope,
        command,
      );

      expect(result).toMatchObject({
        status: "CANCEL_REQUESTED",
        acknowledged: false,
        queueRevision: true,
      });
      await expect(
        pool.query<{ status: string }>(
          "SELECT status FROM chat_service.analysis_run WHERE run_id = $1",
          [started.run.runId],
        ),
      ).resolves.toMatchObject({ rows: [{ status: "CANCEL_REQUESTED" }] });
      const beforeReplay = adapter.getCounters();
      await expect(
        runtime.analysisControl.requestCancel(requestScope, command),
      ).resolves.toEqual(result);
      expect(adapter.getCounters().executions.CANCEL).toBe(
        beforeReplay.executions.CANCEL,
      );
      const reconnectAdapter = fixtureAdapter(false);
      const reconnectRuntime = createAnalysisDevelopmentRuntime({
        repository,
        adapter: reconnectAdapter,
        environment,
        now: () => now,
      });
      await expect(
        reconnectRuntime.ensureAnalysisPump(identity.scope),
      ).resolves.toMatchObject({
        state: "STOPPED",
        stopReason: "DURABLE_TERMINAL",
        subscriptionCount: 0,
      });
      expect(reconnectAdapter.getCounters().commands.EVENTS).toBe(0);
    });

    it("persists ambiguity, resumes with parent lineage, and isolates old-Run events from the new cursor", async () => {
      const identity = await seedIdentity(pool, "ambiguity");
      const adapter = fixtureAdapter();
      const runtime = createAnalysisDevelopmentRuntime({
        repository,
        adapter,
        environment,
        now: () => now,
        nextId: (kind) => `${kind}-ambiguity-resumed`,
      });
      const started = await runtime.startAnalysis({
        ...identity.scope,
        groundingId: "grounding-ambiguity",
        revisionId: "revision-ambiguity-active",
        runId: "run-ambiguity-active",
        scenario: "AMBIGUITY",
      });
      let lastSnapshot;
      for await (const observation of runtime.observeAnalysis(identity.scope)) {
        lastSnapshot = observation.snapshot;
      }
      const intervention = lastSnapshot?.pendingIntervention;
      if (intervention === undefined) {
        throw new Error("persisted intervention missing");
      }
      const beforeRejectedResponses = adapter.getCounters();
      await expect(
        runtime.analysisControl.resolveIntervention(
          {
            analysisId: identity.scope.analysisId,
            userId: identity.userId,
            userRole: "user",
            interventionId: intervention.interventionId,
          },
          {
            commandId: "command-intervention-extra",
            idempotencyKey: "intervention-extra-key",
            response: {
              candidateId: "fixture-candidate-a",
              note: "not part of the trusted response shape",
            },
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INTERVENTION_RESPONSE_SCHEMA_INVALID",
      });
      await expect(
        runtime.analysisControl.resolveIntervention(
          {
            analysisId: identity.scope.analysisId,
            userId: identity.userId,
            userRole: "user",
            interventionId: intervention.interventionId,
          },
          {
            commandId: "command-intervention-sensitive",
            idempotencyKey: "intervention-sensitive-key",
            response: {
              candidateId: "fixture-candidate-a",
              auth: "credential-material",
            },
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
        message: ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
      });
      expect(adapter.getCounters().executions.INTERVENTION).toBe(
        beforeRejectedResponses.executions.INTERVENTION,
      );
      await expect(
        pool.query<{ response_payload_json: unknown | null }>(
          `
            SELECT response_payload_json
            FROM chat_service.analysis_intervention
            WHERE analysis_id = $1 AND intervention_id = $2
          `,
          [identity.scope.analysisId, intervention.interventionId],
        ),
      ).resolves.toMatchObject({ rows: [{ response_payload_json: null }] });
      const result = await runtime.analysisControl.resolveIntervention(
        {
          analysisId: identity.scope.analysisId,
          userId: identity.userId,
          userRole: "user",
          interventionId: intervention.interventionId,
        },
        {
          commandId: "command-intervention",
          idempotencyKey: "intervention-development-key",
          response: { candidateId: "fixture-candidate-a" },
        },
      );
      expect(result).toMatchObject({
        status: "RESOLVED",
        parentRunId: "run-ambiguity-active",
        resumedRunId: "run-ambiguity-resumed",
      });
      const lineage = await pool.query<{
        status: string;
        parent_run_id: string;
        attempt: number;
      }>(
        `
          SELECT intervention.status, run.parent_run_id, run.attempt
          FROM chat_service.analysis_intervention intervention
          JOIN chat_service.analysis_run run
            ON run.analysis_id = intervention.analysis_id
           AND run.run_id = $2
          WHERE intervention.intervention_id = $1
        `,
        [intervention.interventionId, "run-ambiguity-resumed"],
      );
      expect(lineage.rows[0]).toEqual({
        status: "RESOLVED",
        parent_run_id: "run-ambiguity-active",
        attempt: 2,
      });
      const afterResume = await repository.getDevelopmentSnapshot(
        identity.scope,
      );
      if (afterResume?.currentRun.upstreamRunId === undefined) {
        throw new Error("resumed upstream Run identity missing");
      }
      expect(afterResume.projection.lastEventSequence).toBe(0);

      const oldPayload = { executionStatus: "RUNNING" };
      const lateOldRunEvent = {
        schemaVersion: "sacs-wsgs-analysis-event/1.0" as const,
        eventId: "event-ambiguity-old-run-late",
        upstreamAnalysisId: started.sourceSnapshot.upstreamAnalysisId,
        planId: started.sourceSnapshot.planId,
        planHash: started.sourceSnapshot.planHash,
        planRevision: started.sourceSnapshot.planRevision,
        sequence: 5,
        eventType: "NODE_STARTED" as const,
        nodeId: "query",
        correlationId: started.sourceSnapshot.upstreamRunId,
        occurredAt: "2026-09-05T02:00:10.000Z",
        payload: oldPayload,
        payloadHash: hashCanonicalJson(oldPayload),
      };
      const oldCommit = await repository.commitUpstreamEvent({
        scope: identity.scope,
        decision: {
          disposition: "APPLY_TO_ACTIVE_PLAN",
          event: lateOldRunEvent,
        },
      });
      expect(oldCommit).toMatchObject({
        created: true,
        disposition: "AUDIT_ONLY_INACTIVE_PLAN",
        projection: { lastEventSequence: 0 },
      });
      expect(oldCommit.projection).toEqual(afterResume.projection);

      const unboundEvent = {
        ...lateOldRunEvent,
        eventId: "event-ambiguity-unbound-run",
        sequence: 6,
        correlationId: "upstream-run-not-durable",
      };
      await expect(
        repository.commitUpstreamEvent({
          scope: identity.scope,
          decision: {
            disposition: "AUDIT_ONLY_INACTIVE_PLAN",
            event: unboundEvent,
          },
        }),
      ).rejects.toBeInstanceOf(PersistenceConflictError);
      await expect(
        repository.getDevelopmentSnapshot(identity.scope),
      ).resolves.toEqual(afterResume);

      const resumedPayload = { executionStatus: "READY" };
      const resumedRunEvent = {
        schemaVersion: "sacs-wsgs-analysis-event/1.0" as const,
        eventId: "event-ambiguity-resumed-run-1",
        upstreamAnalysisId: started.sourceSnapshot.upstreamAnalysisId,
        planId: started.sourceSnapshot.planId,
        planHash: started.sourceSnapshot.planHash,
        planRevision: started.sourceSnapshot.planRevision,
        sequence: 1,
        eventType: "NODE_READY" as const,
        nodeId: "query",
        correlationId: afterResume.currentRun.upstreamRunId,
        occurredAt: "2026-09-05T02:00:11.000Z",
        payload: resumedPayload,
        payloadHash: hashCanonicalJson(resumedPayload),
      };
      const resumedCommit = await repository.commitUpstreamEvent({
        scope: identity.scope,
        decision: {
          disposition: "APPLY_TO_ACTIVE_PLAN",
          event: resumedRunEvent,
        },
      });
      expect(resumedCommit).toMatchObject({
        created: true,
        disposition: "APPLY_TO_ACTIVE_PLAN",
        projection: { lastEventSequence: 1 },
      });
      const sameUpstreamSequence = await pool.query<{
        run_id: string;
        upstream_sequence: string;
      }>(
        `
          SELECT run_id, upstream_sequence
          FROM chat_service.analysis_event
          WHERE analysis_id = $1
            AND upstream_sequence = 1
            AND run_id IN ($2, $3)
          ORDER BY run_id
        `,
        [
          identity.scope.analysisId,
          started.run.runId,
          afterResume.currentRun.runId,
        ],
      );
      expect(sameUpstreamSequence.rows).toEqual(
        expect.arrayContaining([
          { run_id: started.run.runId, upstream_sequence: "1" },
          {
            run_id: afterResume.currentRun.runId,
            upstream_sequence: "1",
          },
        ]),
      );
      expect(sameUpstreamSequence.rows).toHaveLength(2);

      const oldReplay = await repository.commitUpstreamEvent({
        scope: identity.scope,
        decision: {
          disposition: "APPLY_TO_ACTIVE_PLAN",
          event: lateOldRunEvent,
        },
      });
      expect(oldReplay).toMatchObject({
        created: false,
        disposition: "IDEMPOTENT_DUPLICATE",
        projection: { lastEventSequence: 1 },
      });
      expect(oldReplay.projection).toEqual(resumedCommit.projection);
      await expect(
        pool.query<{ run_id: string; upstream_sequence: string }>(
          `
            SELECT run_id, upstream_sequence
            FROM chat_service.analysis_event
            WHERE analysis_id = $1 AND event_id = $2
          `,
          [identity.scope.analysisId, lateOldRunEvent.eventId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            run_id: started.run.runId,
            upstream_sequence: "5",
          },
        ],
      });
      const counters = adapter.getCounters();
      const projection = await runtime.getProjection(identity.scope);
      expect(projection?.state).not.toHaveProperty("pendingIntervention");
      expect(adapter.getCounters()).toEqual(counters);
      expect(adapter.getCounters().clientPublicArgsExecutions).toBe(0);
    });

    it("cancels open interventions and cannot resume a cancelled analysis", async () => {
      const identity = await seedIdentity(pool, "ambiguity-cancel");
      const adapter = fixtureAdapter();
      const runtime = createAnalysisDevelopmentRuntime({
        repository,
        adapter,
        environment,
        now: () => now,
      });
      const started = await runtime.startAnalysis({
        ...identity.scope,
        groundingId: "grounding-ambiguity-cancel",
        revisionId: "revision-ambiguity-cancel",
        runId: "run-ambiguity-cancel",
        scenario: "AMBIGUITY",
      });
      await drain(runtime.observeAnalysis(identity.scope));
      const snapshot = await runtime.getSnapshot(identity.scope);
      const intervention = snapshot?.pendingIntervention;
      if (intervention === undefined) {
        throw new Error("persisted intervention missing");
      }
      const requestScope = {
        analysisId: identity.scope.analysisId,
        userId: identity.userId,
        userRole: "user",
      } as const;
      await expect(
        runtime.analysisControl.requestCancel(requestScope, {
          commandId: "command-ambiguity-cancel",
          expectedRevisionId: started.revision.revisionId,
          expectedRevisionNumber: started.revision.revisionNumber,
          idempotencyKey: "ambiguity-cancel-key",
          reason: "USER_REQUESTED",
        }),
      ).resolves.toMatchObject({ status: "CANCELLED", acknowledged: true });
      const beforeResolve = adapter.getCounters();
      await expect(
        runtime.analysisControl.resolveIntervention(
          { ...requestScope, interventionId: intervention.interventionId },
          {
            commandId: "command-resolve-after-cancel",
            idempotencyKey: "resolve-after-cancel-key",
            response: { candidateId: "fixture-candidate-a" },
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "ANALYSIS_INTERVENTION_NOT_FOUND",
      });
      expect(adapter.getCounters().executions.INTERVENTION).toBe(
        beforeResolve.executions.INTERVENTION,
      );
      await expect(
        pool.query<{ session_status: string; intervention_status: string }>(
          `
            SELECT session.status AS session_status,
                   intervention.status AS intervention_status
            FROM chat_service.analysis_session session
            JOIN chat_service.analysis_intervention intervention
              ON intervention.analysis_id = session.analysis_id
            WHERE session.analysis_id = $1
          `,
          [identity.scope.analysisId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            session_status: "CANCELLED",
            intervention_status: "CANCELLED",
          },
        ],
      });

      const beforeLateEvent = await repository.getDevelopmentSnapshot(
        identity.scope,
      );
      const latePayload = {
        status: "SUCCEEDED" as const,
        terminalGap: null,
        interruptRequired: false,
      };
      const lateCompletion = {
        schemaVersion: "sacs-wsgs-analysis-event/1.0" as const,
        eventId: "event-late-completion-after-cancel",
        upstreamAnalysisId: started.sourceSnapshot.upstreamAnalysisId,
        planId: started.sourceSnapshot.planId,
        planHash: started.sourceSnapshot.planHash,
        planRevision: started.sourceSnapshot.planRevision,
        sequence: 5,
        eventType: "ANALYSIS_COMPLETED" as const,
        correlationId: started.sourceSnapshot.upstreamRunId,
        occurredAt: "2026-09-05T02:00:05.000Z",
        payload: latePayload,
        payloadHash: hashCanonicalJson(latePayload),
      };
      await expect(
        repository.commitUpstreamEvent({
          scope: identity.scope,
          decision: {
            disposition: "APPLY_TO_ACTIVE_PLAN",
            event: lateCompletion,
          },
        }),
      ).resolves.toMatchObject({
        created: true,
        disposition: "AUDIT_ONLY_INACTIVE_PLAN",
        projection: {
          lastEventSequence: 5,
          stateRevision: beforeLateEvent?.projection.stateRevision,
          activityRevision: beforeLateEvent?.projection.activityRevision,
          state: beforeLateEvent?.projection.state,
          activity: beforeLateEvent?.projection.activity,
        },
      });
      const afterLateEvent = await repository.getDevelopmentSnapshot(
        identity.scope,
      );
      expect(afterLateEvent).toMatchObject({
        session: beforeLateEvent?.session,
        currentRevision: beforeLateEvent?.currentRevision,
        currentRun: beforeLateEvent?.currentRun,
        projection: {
          lastEventSequence: 5,
          stateRevision: beforeLateEvent?.projection.stateRevision,
          activityRevision: beforeLateEvent?.projection.activityRevision,
          state: beforeLateEvent?.projection.state,
          activity: beforeLateEvent?.projection.activity,
          stateHash: beforeLateEvent?.projection.stateHash,
          activityHash: beforeLateEvent?.projection.activityHash,
        },
      });
      await expect(
        repository.commitUpstreamEvent({
          scope: identity.scope,
          decision: {
            disposition: "APPLY_TO_ACTIVE_PLAN",
            event: lateCompletion,
          },
        }),
      ).resolves.toMatchObject({
        created: false,
        disposition: "IDEMPOTENT_DUPLICATE",
        projection: afterLateEvent?.projection,
      });
    });

    it("serializes cancellation and intervention resolution before upstream side effects", async () => {
      const identity = await seedIdentity(pool, "cancel-toctou");
      const adapter = fixtureAdapter();
      const runtime = createAnalysisDevelopmentRuntime({
        repository,
        adapter,
        environment,
        now: () => now,
        nextId: (kind) => `${kind}-cancel-toctou-resumed`,
      });
      const started = await runtime.startAnalysis({
        ...identity.scope,
        groundingId: "grounding-cancel-toctou",
        revisionId: "revision-cancel-toctou",
        runId: "run-cancel-toctou",
        scenario: "AMBIGUITY",
      });
      await drain(runtime.observeAnalysis(identity.scope));
      const intervention = (await runtime.getSnapshot(identity.scope))
        ?.pendingIntervention;
      if (intervention === undefined) {
        throw new Error("persisted intervention missing");
      }

      let signalCancelStarted: (() => void) | undefined;
      const cancelStarted = new Promise<void>((resolve) => {
        signalCancelStarted = resolve;
      });
      let releaseCancel: (() => void) | undefined;
      const cancelRelease = new Promise<void>((resolve) => {
        releaseCancel = resolve;
      });
      adapter.cancelRun = async (request) => {
        signalCancelStarted?.();
        await cancelRelease;
        return {
          supported: true,
          acknowledged: true,
          upstreamRunId: request.upstreamRunId,
        };
      };
      const requestScope = {
        analysisId: identity.scope.analysisId,
        userId: identity.userId,
        userRole: "user",
      } as const;
      const cancelOutcome = runtime.analysisControl
        .requestCancel(requestScope, {
          commandId: "command-cancel-toctou",
          expectedRevisionId: started.revision.revisionId,
          expectedRevisionNumber: started.revision.revisionNumber,
          idempotencyKey: "cancel-toctou-key",
          reason: "USER_REQUESTED",
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await cancelStarted;
      const beforeResolve = adapter.getCounters();
      await expect(
        runtime.analysisControl.resolveIntervention(
          { ...requestScope, interventionId: intervention.interventionId },
          {
            commandId: "command-resolve-during-cancel",
            idempotencyKey: "resolve-during-cancel-key",
            response: { candidateId: "fixture-candidate-a" },
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "ANALYSIS_MUTATION_PENDING",
      });
      expect(adapter.getCounters().executions.INTERVENTION).toBe(
        beforeResolve.executions.INTERVENTION,
      );
      releaseCancel?.();
      const outcome = await cancelOutcome;
      if (!("value" in outcome)) {
        throw outcome.error;
      }
      expect(outcome.value).toMatchObject({
        status: "CANCELLED",
        acknowledged: true,
      });
      await expect(
        pool.query<{
          session_status: string;
          original_run_status: string;
          command_status: string;
          resolution_count: string;
          mutation_claim_token: string | null;
        }>(
          `
            SELECT session.status AS session_status,
                   run.status AS original_run_status,
                   command.status AS command_status,
                   session.mutation_claim_token,
                   count(resolution.command_id)::text AS resolution_count
            FROM chat_service.analysis_session session
            JOIN chat_service.analysis_run run
              ON run.analysis_id = session.analysis_id
             AND run.run_id = $2
            JOIN chat_service.analysis_control_command command
              ON command.analysis_id = session.analysis_id
             AND command.command_id = $3
            LEFT JOIN chat_service.analysis_control_command resolution
              ON resolution.analysis_id = session.analysis_id
             AND resolution.command_id = $4
            WHERE session.analysis_id = $1
            GROUP BY session.status, run.status, command.status,
                     session.mutation_claim_token
          `,
          [
            identity.scope.analysisId,
            started.run.runId,
            "command-cancel-toctou",
            "command-resolve-during-cancel",
          ],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            session_status: "CANCELLED",
            original_run_status: "CANCELLED",
            command_status: "COMPLETED",
            resolution_count: "0",
            mutation_claim_token: null,
          },
        ],
      });
    });

    it("rejects claim-to-load Run advancement before invoking WSGS", async () => {
      const identity = await seedIdentity(pool, "claim-load-run-window");
      const adapter = fixtureAdapter();
      const seedRuntime = createAnalysisDevelopmentRuntime({
        repository,
        adapter,
        environment,
        now: () => now,
      });
      const started = await seedRuntime.startAnalysis({
        ...identity.scope,
        groundingId: "grounding-claim-load-run-window",
        revisionId: "revision-claim-load-run-window",
        runId: "run-claim-load-run-window",
        scenario: "AMBIGUITY",
      });
      await drain(seedRuntime.observeAnalysis(identity.scope));
      const windowRepository = new AnalysisDevelopmentRepository(
        pool,
        new AnalysisRepository(pool),
      );
      const originalClaimCancel =
        windowRepository.claimCancel.bind(windowRepository);
      windowRepository.claimCancel = async (input) => {
        const claim = await originalClaimCancel(input);
        if (claim.disposition === "CLAIMED") {
          await pool.query(
            `
              INSERT INTO chat_service.analysis_run(
                run_id, analysis_id, revision_id, attempt, parent_run_id,
                upstream_run_id, status, started_at
              ) VALUES ($1, $2, $3, $4, $5, $6, 'RUNNING', $7::timestamptz)
            `,
            [
              "run-claim-load-advanced",
              identity.scope.analysisId,
              started.revision.revisionId,
              started.run.attempt + 1,
              started.run.runId,
              "upstream-run-claim-load-advanced",
              now,
            ],
          );
        }
        return claim;
      };
      const coordinator = createAnalysisControlCoordinator({
        store: windowRepository,
        wsgs: adapter,
        now: () => now,
      });
      const beforeCancel = adapter.getCounters();
      await expect(
        coordinator.requestCancel(
          {
            analysisId: identity.scope.analysisId,
            userId: identity.userId,
            userRole: "user",
          },
          {
            commandId: "command-claim-load-window",
            expectedRevisionId: started.revision.revisionId,
            expectedRevisionNumber: started.revision.revisionNumber,
            idempotencyKey: "claim-load-window-key",
            reason: "USER_REQUESTED",
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "ANALYSIS_REVISION_CONFLICT",
      });
      expect(adapter.getCounters().executions.CANCEL).toBe(
        beforeCancel.executions.CANCEL,
      );
    });

    it("recovers abandoned command claims and replays a safe failure", async () => {
      const identity = await seedIdentity(pool, "claim-recovery");
      const runtime = createAnalysisDevelopmentRuntime({
        repository,
        adapter: fixtureAdapter(),
        environment,
        now: () => now,
      });
      const started = await runtime.startAnalysis({
        ...identity.scope,
        groundingId: "grounding-claim-recovery",
        revisionId: "revision-claim-recovery",
        runId: "run-claim-recovery",
        scenario: "AMBIGUITY",
      });
      await drain(runtime.observeAnalysis(identity.scope));
      const requestScope = {
        analysisId: identity.scope.analysisId,
        userId: identity.userId,
        userRole: "user",
      } as const;
      const command = {
        commandId: "command-claim-recovery",
        expectedRevisionId: started.revision.revisionId,
        expectedRevisionNumber: started.revision.revisionNumber,
        idempotencyKey: "claim-recovery-key",
        reason: "USER_REQUESTED" as const,
      };
      const requestHash = hashCanonicalJson(command);
      const firstClaim = await repository.claimCancel({
        scope: requestScope,
        command,
        requestHash,
      });
      expect(firstClaim.disposition).toBe("CLAIMED");
      if (firstClaim.disposition !== "CLAIMED") {
        throw new Error("initial cancel claim missing");
      }
      await expect(
        repository.claimCancel({ scope: requestScope, command, requestHash }),
      ).resolves.toEqual({ disposition: "PENDING_CONFLICT" });
      await pool.query(
        `
          UPDATE chat_service.analysis_control_command
          SET updated_at = now() - interval '6 minutes'
          WHERE analysis_id = $1 AND command_id = $2
        `,
        [identity.scope.analysisId, command.commandId],
      );
      await pool.query(
        `
          UPDATE chat_service.analysis_session
          SET mutation_claimed_at = now() - interval '6 minutes'
          WHERE analysis_id = $1 AND mutation_claim_kind = 'CANCEL'
            AND mutation_claim_id = $2 AND mutation_claim_token = $3
        `,
        [identity.scope.analysisId, command.commandId, firstClaim.claimToken],
      );
      const reclaimed = await repository.claimCancel({
        scope: requestScope,
        command,
        requestHash,
      });
      expect(reclaimed.disposition).toBe("CLAIMED");
      if (reclaimed.disposition !== "CLAIMED") {
        throw new Error("stale cancel claim was not reclaimed");
      }
      expect(reclaimed.claimToken).not.toBe(firstClaim.claimToken);
      await expect(
        repository.loadCancelContext(
          requestScope,
          command.commandId,
          firstClaim.claimToken,
        ),
      ).rejects.toBeInstanceOf(PersistenceConflictError);
      await expect(
        repository.commitCancellation({
          scope: requestScope,
          commandId: command.commandId,
          claimToken: firstClaim.claimToken,
          transition: {
            requested: { ...started.run, status: "CANCEL_REQUESTED" },
            settled: {
              ...started.run,
              status: "CANCELLED",
              finishedAt: now,
            },
            queueRevision: false,
          },
        }),
      ).rejects.toBeInstanceOf(PersistenceConflictError);
      await repository.markCancelFailed({
        scope: requestScope,
        commandId: command.commandId,
        claimToken: firstClaim.claimToken,
        safeCode: "STALE_WORKER_MUST_NOT_WIN",
        statusCode: 409,
      });
      await expect(
        pool.query<{
          command_status: string;
          command_claim_token: string;
          mutation_claim_token: string;
        }>(
          `
            SELECT command.status AS command_status,
                   command.claim_token AS command_claim_token,
                   session.mutation_claim_token
            FROM chat_service.analysis_control_command command
            JOIN chat_service.analysis_session session
              ON session.analysis_id = command.analysis_id
            WHERE command.analysis_id = $1 AND command.command_id = $2
          `,
          [identity.scope.analysisId, command.commandId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            command_status: "CLAIMED",
            command_claim_token: reclaimed.claimToken,
            mutation_claim_token: reclaimed.claimToken,
          },
        ],
      });
      await repository.markCancelFailed({
        scope: requestScope,
        commandId: command.commandId,
        claimToken: reclaimed.claimToken,
        safeCode: "WSGS_CANCEL_UNAVAILABLE",
        statusCode: 503,
      });
      await expect(
        pool.query(
          `
            SELECT 1 FROM chat_service.analysis_session
            WHERE analysis_id = $1
              AND num_nonnulls(
                mutation_claim_kind, mutation_claim_id,
                mutation_claim_token, mutation_claimed_at
              ) <> 0
          `,
          [identity.scope.analysisId],
        ),
      ).resolves.toMatchObject({ rows: [] });
      await expect(
        repository.claimCancel({ scope: requestScope, command, requestHash }),
      ).resolves.toEqual({
        disposition: "FAILED_REPLAY",
        safeCode: "WSGS_CANCEL_UNAVAILABLE",
        statusCode: 503,
      });
    });

    it("serializes proposal and cancel claims through one durable analysis mutation slot", async () => {
      const identity = await seedIdentity(pool, "proposal-cancel-slot");
      const runtime = createAnalysisDevelopmentRuntime({
        repository,
        adapter: fixtureAdapter(),
        environment,
        now: () => now,
      });
      const started = await runtime.startAnalysis({
        ...identity.scope,
        groundingId: "grounding-proposal-cancel-slot",
        revisionId: "revision-proposal-cancel-slot",
        runId: "run-proposal-cancel-slot",
        scenario: "AMBIGUITY",
      });
      await drain(runtime.observeAnalysis(identity.scope));
      const descriptor = started.sourceSnapshot.toolInteractions[0];
      if (descriptor === undefined)
        throw new Error("fixture descriptor missing");
      const requestScope = {
        analysisId: identity.scope.analysisId,
        userId: identity.userId,
        userRole: "user",
      } as const;
      const proposalCommand = {
        commandId: "command-proposal-slot",
        proposalId: "proposal-slot",
        expectedRevisionId: started.revision.revisionId,
        expectedRevisionNumber: started.revision.revisionNumber,
        targetNodeId: descriptor.nodeId,
        publicArgsHash: descriptor.publicArgsHash,
        editSchemaHash: descriptor.publicEditSchemaHash,
        patch: [{ op: "replace" as const, path: "/radiusMeters", value: 800 }],
        mode: "SUGGEST_NEXT_REVISION" as const,
        idempotencyKey: "proposal-slot-key",
      };
      const proposalClaim = await repository.claimProposal({
        scope: requestScope,
        proposal: {
          schemaVersion: "sacs-analysis-change-proposal/1.0",
          ...proposalCommand,
          analysisId: identity.scope.analysisId,
          status: "SUBMITTED",
          createdAt: now,
        },
        requestHash: hashCanonicalJson(proposalCommand),
      });
      if (proposalClaim.disposition !== "CLAIMED") {
        throw new Error("proposal mutation slot was not claimed");
      }
      const cancelCommand = {
        commandId: "command-cancel-after-proposal-slot",
        expectedRevisionId: started.revision.revisionId,
        expectedRevisionNumber: started.revision.revisionNumber,
        idempotencyKey: "cancel-after-proposal-slot-key",
        reason: "USER_REQUESTED" as const,
      };
      await expect(
        repository.claimCancel({
          scope: requestScope,
          command: cancelCommand,
          requestHash: hashCanonicalJson(cancelCommand),
        }),
      ).resolves.toEqual({ disposition: "PENDING_CONFLICT" });
      await repository.markProposalFailed({
        scope: requestScope,
        proposalId: proposalCommand.proposalId,
        claimToken: proposalClaim.claimToken,
        safeCode: "ANALYSIS_REVISION_CONFLICT",
        statusCode: 409,
      });
      const cancelClaim = await repository.claimCancel({
        scope: requestScope,
        command: cancelCommand,
        requestHash: hashCanonicalJson(cancelCommand),
      });
      expect(cancelClaim.disposition).toBe("CLAIMED");
      if (cancelClaim.disposition !== "CLAIMED") {
        throw new Error("cancel mutation slot was not claimed after release");
      }
      await repository.markCancelFailed({
        scope: requestScope,
        commandId: cancelCommand.commandId,
        claimToken: cancelClaim.claimToken,
        safeCode: "TEST_PRE_DISPATCH_ABORT",
        statusCode: 409,
      });
    });

    it("reclaims a crashed proposal with the same compile identity and one upstream execution", async () => {
      const identity = await seedIdentity(pool, "proposal-crash-reclaim");
      const adapter = fixtureAdapter();
      const seedRuntime = createAnalysisDevelopmentRuntime({
        repository,
        adapter,
        environment,
        now: () => now,
      });
      const started = await seedRuntime.startAnalysis({
        ...identity.scope,
        groundingId: "grounding-proposal-crash-reclaim",
        revisionId: "revision-proposal-crash-reclaim",
        runId: "run-proposal-crash-reclaim",
        scenario: "AMBIGUITY",
      });
      await drain(seedRuntime.observeAnalysis(identity.scope));
      const descriptor = started.sourceSnapshot.toolInteractions[0];
      if (descriptor === undefined)
        throw new Error("fixture descriptor missing");
      const crashRepository = new AnalysisDevelopmentRepository(
        pool,
        new AnalysisRepository(pool),
      );
      const originalCommit =
        crashRepository.commitCompiledRevision.bind(crashRepository);
      let injectPostDispatchCrash = true;
      crashRepository.commitCompiledRevision = async (input) => {
        if (injectPostDispatchCrash) {
          injectPostDispatchCrash = false;
          throw new Error("INJECTED_LOCAL_COMMIT_FAILURE");
        }
        return originalCommit(input);
      };
      let revisionNumber = 0;
      const coordinator = createAnalysisControlCoordinator({
        store: crashRepository,
        wsgs: adapter,
        now: () => now,
        nextId: (kind) =>
          kind === "revision"
            ? `revision-proposal-reclaim-${++revisionNumber}`
            : "run-proposal-reclaim",
      });
      const requestScope = {
        analysisId: identity.scope.analysisId,
        userId: identity.userId,
        userRole: "user",
      } as const;
      const command = {
        commandId: "command-proposal-crash-reclaim",
        proposalId: "proposal-crash-reclaim",
        expectedRevisionId: started.revision.revisionId,
        expectedRevisionNumber: started.revision.revisionNumber,
        targetNodeId: descriptor.nodeId,
        publicArgsHash: descriptor.publicArgsHash,
        editSchemaHash: descriptor.publicEditSchemaHash,
        patch: [{ op: "replace" as const, path: "/radiusMeters", value: 825 }],
        mode: "SUGGEST_NEXT_REVISION" as const,
        idempotencyKey: "proposal-crash-reclaim-key",
      };
      await expect(
        coordinator.submitProposal(requestScope, command),
      ).rejects.toMatchObject({
        statusCode: 503,
        code: "INJECTED_LOCAL_COMMIT_FAILURE",
      });
      expect(adapter.getCounters().executions.COMPILE_REVISION).toBe(1);
      await expect(
        coordinator.submitProposal(requestScope, command),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "ANALYSIS_MUTATION_PENDING",
      });
      await pool.query(
        `
          UPDATE chat_service.analysis_session
          SET mutation_claimed_at = now() - interval '6 minutes'
          WHERE analysis_id = $1 AND mutation_claim_kind = 'PROPOSAL'
            AND mutation_claim_id = $2
        `,
        [identity.scope.analysisId, command.proposalId],
      );
      await expect(
        coordinator.submitProposal(requestScope, command),
      ).resolves.toMatchObject({
        status: "COMPILED",
        proposalId: command.proposalId,
      });
      expect(adapter.getCounters().commands.COMPILE_REVISION).toBe(2);
      expect(adapter.getCounters().executions.COMPILE_REVISION).toBe(1);
      await expect(
        pool.query(
          `
            SELECT 1 FROM chat_service.analysis_session
            WHERE analysis_id = $1 AND mutation_claim_token IS NOT NULL
          `,
          [identity.scope.analysisId],
        ),
      ).resolves.toMatchObject({ rows: [] });
    });

    it("rejects descriptor collisions and non-exact upstream event replays", async () => {
      const descriptorIdentity = await seedIdentity(
        pool,
        "descriptor-integrity",
      );
      const descriptorAdapter = fixtureAdapter();
      const descriptorRuntime = createAnalysisDevelopmentRuntime({
        repository,
        adapter: descriptorAdapter,
        environment,
        now: () => now,
      });
      const descriptorStarted = await descriptorRuntime.startAnalysis({
        ...descriptorIdentity.scope,
        groundingId: "grounding-descriptor-integrity",
        revisionId: "revision-descriptor-integrity",
        runId: "run-descriptor-integrity",
      });
      const descriptor = descriptorStarted.sourceSnapshot.toolInteractions[0];
      if (descriptor === undefined)
        throw new Error("fixture descriptor missing");
      const conflictingPublicArgs = {
        ...descriptor.publicArgs,
        radiusMeters: 999,
      };
      const conflictingDescriptor = {
        ...descriptor,
        publicArgs: conflictingPublicArgs,
        publicArgsHash: hashCanonicalJson(conflictingPublicArgs),
      };
      await pool.query(
        `
          UPDATE chat_service.analysis_tool_interaction_descriptor
          SET descriptor_json = $3::jsonb, descriptor_hash = $4
          WHERE analysis_id = $1 AND tool_call_id = $2
        `,
        [
          descriptorIdentity.scope.analysisId,
          descriptor.toolCallId,
          JSON.stringify(conflictingDescriptor),
          hashCanonicalJson(conflictingDescriptor),
        ],
      );
      await expect(
        drain(descriptorRuntime.observeAnalysis(descriptorIdentity.scope)),
      ).rejects.toBeInstanceOf(AnalysisDevelopmentPumpError);
      const descriptorProjection = await descriptorRuntime.getProjection(
        descriptorIdentity.scope,
      );
      expect(descriptorProjection?.lastEventSequence).toBe(5);

      const eventIdentity = await seedIdentity(pool, "event-integrity");
      const eventAdapter = fixtureAdapter();
      const eventRuntime = createAnalysisDevelopmentRuntime({
        repository,
        adapter: eventAdapter,
        environment,
        now: () => now,
      });
      await eventRuntime.startAnalysis({
        ...eventIdentity.scope,
        groundingId: "grounding-event-integrity",
        revisionId: "revision-event-integrity",
        runId: "run-event-integrity",
      });
      await drain(eventRuntime.observeAnalysis(eventIdentity.scope));
      let completionEvent;
      for await (const event of eventAdapter.subscribeAnalysisEvents(
        "grounding-event-integrity",
        8,
      )) {
        completionEvent = event;
      }
      if (completionEvent === undefined)
        throw new Error("completion event missing");
      await expect(
        repository.commitUpstreamEvent({
          scope: eventIdentity.scope,
          decision: {
            disposition: "APPLY_TO_ACTIVE_PLAN",
            event: { ...completionEvent, eventType: "NODE_READY" },
          },
        }),
      ).rejects.toBeInstanceOf(PersistenceConflictError);
    });
  },
);

function fixtureAdapter(cancelSupported = true): FixtureWsgsAnalysisAdapter {
  return new FixtureWsgsAnalysisAdapter({
    environment: adapterEnvironment,
    generatedAt: now,
    cancelSupported,
  });
}

async function seedIdentity(
  pool: pg.Pool,
  label: string,
): Promise<{
  readonly userId: string;
  readonly scope: {
    readonly analysisId: string;
    readonly principalId: string;
    readonly threadId: string;
  };
}> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const userId = `user-${suffix}`;
  const principalId = `principal-${suffix}`;
  const threadId = `thread-${suffix}`;
  await pool.query(
    `
      INSERT INTO chat_service.principal(
        principal_id, issuer, subject, role
      ) VALUES ($1, 'openwebui-jwt', $2, 'user')
    `,
    [principalId, userId],
  );
  await pool.query(
    `
      INSERT INTO chat_service.conversation_thread(thread_id, principal_id)
      VALUES ($1, $2)
    `,
    [threadId, principalId],
  );
  return {
    userId,
    scope: {
      analysisId: `analysis-${suffix}`,
      principalId,
      threadId,
    },
  };
}

function withDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = "/" + database;
  return url.toString();
}

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const ignored of iterable) void ignored;
}

async function waitForDatabaseDisconnect(
  adminPool: pg.Pool,
  database: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const result = await adminPool.query<{ connection_count: string }>(
      `
        SELECT count(*) AS connection_count
        FROM pg_stat_activity
        WHERE datname = $1
      `,
      [database],
    );
    if (Number(result.rows[0]?.connection_count ?? 0) === 0) return;
    if (Date.now() >= deadline) {
      throw new Error("v0.5 development PostgreSQL connections did not close");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
