import type { Pool, PoolClient } from "pg";

import { hashJson } from "./hash.js";
import {
  PersistenceAuthorizationError,
  PersistenceConflictError,
} from "./repository.js";
import type { JsonValue } from "./types.js";

export const ANALYSIS_STATE_MAX_BYTES = 4 * 1024 * 1024;
export const ANALYSIS_ACTIVITY_MAX_BYTES = 2 * 1024 * 1024;
export const ANALYSIS_EVENT_PAYLOAD_MAX_BYTES = 4 * 1024 * 1024;

export interface AnalysisScope {
  readonly analysisId: string;
  readonly principalId: string;
  readonly threadId: string;
}

export interface AnalysisSession extends AnalysisScope {
  readonly schemaVersion: "sacs-analysis-session/1.0";
  readonly groundingId: string;
  readonly title: string;
  readonly autonomyMode: "OBSERVER" | "ADVISORY" | "INTERVENTION";
  readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED" | "ARCHIVED";
  readonly activeRevisionId: string;
  readonly latestRevisionNumber: number;
  readonly observerPolicyHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalysisRevision {
  readonly schemaVersion: "sacs-analysis-revision/1.0";
  readonly revisionId: string;
  readonly analysisId: string;
  readonly revisionNumber: number;
  readonly parentRevisionId?: string;
  readonly parentRunId?: string;
  readonly cause:
    | "INITIAL_QUERY"
    | "USER_PROPOSAL"
    | "USER_INTERVENTION"
    | "AMBIGUITY_RESOLUTION"
    | "SOURCE_ADVANCED"
    | "AUTOMATIC_RETRY";
  readonly wsgsPlanId: string;
  readonly planHash: string;
  readonly changedPaths: readonly string[];
  readonly reusedNodeIds: readonly string[];
  readonly invalidatedNodeIds: readonly string[];
  readonly rerunNodeIds: readonly string[];
  readonly status:
    | "COMPILING"
    | "READY"
    | "QUEUED"
    | "RUNNING"
    | "SUPERSEDED"
    | "COMPLETED"
    | "PARTIAL"
    | "FAILED";
  readonly createdAt: string;
}

export interface AnalysisRun {
  readonly schemaVersion: "sacs-analysis-run/1.0";
  readonly runId: string;
  readonly analysisId: string;
  readonly revisionId: string;
  readonly attempt: number;
  readonly parentRunId?: string;
  readonly upstreamRunId?: string;
  readonly status:
    | "STARTING"
    | "RUNNING"
    | "WAITING_INTERVENTION"
    | "SUCCEEDED"
    | "PARTIAL"
    | "FAILED"
    | "CANCEL_REQUESTED"
    | "CANCELLED";
  readonly startedAt: string;
  readonly finishedAt?: string;
}

export interface AnalysisEvent {
  readonly schemaVersion: "sacs-analysis-event/1.0";
  readonly eventId: string;
  readonly analysisId: string;
  readonly revisionId: string;
  readonly runId: string;
  readonly analysisSequence: number;
  readonly runSequence: number;
  readonly upstreamSequence?: number;
  readonly eventType: string;
  readonly nodeId?: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly payloadHash: string;
}

export interface StoredAnalysisEvent extends AnalysisEvent {
  readonly createdAt: string;
}

export interface AnalysisProjection {
  readonly schemaVersion: "sacs-analysis-projection/1.0";
  readonly analysisId: string;
  readonly stateRevision: number;
  readonly activityRevision: number;
  readonly state: Readonly<Record<string, JsonValue>>;
  readonly stateHash: string;
  readonly activity: Readonly<Record<string, JsonValue>>;
  readonly activityHash: string;
  readonly lastEventSequence: number;
  readonly updatedAt: string;
}

export interface AnalysisChangeProposal {
  readonly schemaVersion: "sacs-analysis-change-proposal/1.0";
  readonly commandId: string;
  readonly proposalId: string;
  readonly analysisId: string;
  readonly expectedRevisionId: string;
  readonly expectedRevisionNumber: number;
  readonly targetNodeId: string;
  readonly publicArgsHash: string;
  readonly editSchemaHash: string;
  readonly patch: readonly JsonPatchOperation[];
  readonly mode: "SUGGEST_NEXT_REVISION" | "INTERRUPT_AND_APPLY";
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly status:
    | "SUBMITTED"
    | "VALIDATING"
    | "REJECTED"
    | "CONFLICT"
    | "ACCEPTED"
    | "COMPILING"
    | "COMPILE_FAILED"
    | "COMPILED"
    | "APPLIED";
  readonly createdAt: string;
  readonly appliedRevisionId?: string;
}

export interface JsonPatchOperation {
  readonly op: "add" | "remove" | "replace" | "test";
  readonly path: string;
  readonly value?: JsonValue;
}

export interface AnalysisIntervention {
  readonly schemaVersion: "sacs-analysis-intervention/1.0";
  readonly interventionId: string;
  readonly analysisId: string;
  readonly revisionId: string;
  readonly runId: string;
  readonly interruptId: string;
  readonly reason:
    "AMBIGUITY" | "PERMISSION" | "HIGH_RISK" | "BUDGET" | "USER_REQUESTED";
  readonly status: "OPEN" | "RESOLVED" | "EXPIRED" | "CANCELLED";
  readonly requestPayload: Readonly<Record<string, JsonValue>>;
  readonly requestHash: string;
  readonly responsePayload?: Readonly<Record<string, JsonValue>>;
  readonly responseHash?: string;
  readonly createdAt: string;
  readonly resolvedAt?: string;
}

export interface AnalysisPersistenceSnapshot {
  readonly session: AnalysisSession;
  readonly projection?: AnalysisProjection;
}

export interface AppendAnalysisEventResult {
  readonly created: boolean;
  readonly projected: boolean;
  readonly event: StoredAnalysisEvent;
  readonly projection: AnalysisProjection;
}

export class AnalysisRepository {
  constructor(private readonly pool: Pool) {}

  async createSessionWithInitialRevision(input: {
    readonly session: AnalysisSession;
    readonly revision: AnalysisRevision;
  }): Promise<AnalysisPersistenceSnapshot> {
    assertInitialSession(input.session, input.revision);
    return this.transaction(async (client) => {
      await assertThreadScope(client, input.session);
      try {
        await insertSession(client, input.session);
        await insertRevision(client, input.revision);
      } catch (error) {
        throw persistenceWriteError(
          error,
          "Analysis session identity conflict",
        );
      }
      return { session: input.session };
    });
  }

  async findSession(
    scope: AnalysisScope,
  ): Promise<AnalysisSession | undefined> {
    const result = await this.pool.query<AnalysisSessionRow>(
      `
        SELECT session.*
        FROM chat_service.analysis_session session
        JOIN chat_service.conversation_thread thread
          ON thread.thread_id = session.thread_id
         AND thread.principal_id = session.principal_id
        WHERE session.analysis_id = $1
          AND session.principal_id = $2
          AND session.thread_id = $3
      `,
      [scope.analysisId, scope.principalId, scope.threadId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapSession(result.rows[0]);
  }

  async createRevision(input: {
    readonly scope: AnalysisScope;
    readonly expectedRevisionId: string;
    readonly expectedRevisionNumber: number;
    readonly revision: AnalysisRevision;
    readonly updatedAt: string;
  }): Promise<AnalysisRevision> {
    assertRevision(input.revision);
    timestamp(input.updatedAt, "updatedAt");
    if (input.revision.analysisId !== input.scope.analysisId) {
      throw new PersistenceConflictError("Analysis revision scope mismatch");
    }
    return this.transaction(async (client) => {
      const session = await lockAuthorizedSession(client, input.scope);
      if (session.status !== "ACTIVE") {
        throw new PersistenceConflictError(
          "Inactive analysis cannot accept a revision",
        );
      }
      if (
        session.active_revision_id !== input.expectedRevisionId ||
        Number(session.latest_revision_number) !==
          input.expectedRevisionNumber ||
        input.revision.revisionNumber !== input.expectedRevisionNumber + 1 ||
        input.revision.parentRevisionId !== input.expectedRevisionId
      ) {
        throw new PersistenceConflictError("Analysis active revision conflict");
      }
      try {
        await insertRevision(client, input.revision);
      } catch (error) {
        throw persistenceWriteError(
          error,
          "Analysis revision identity conflict",
        );
      }
      const queued = input.revision.status === "QUEUED";
      const switched = await client.query(
        queued
          ? `
              UPDATE chat_service.analysis_session
              SET latest_revision_number = $4,
                  updated_at = $5::timestamptz
              WHERE analysis_id = $1
                AND principal_id = $2
                AND thread_id = $3
                AND active_revision_id = $6
                AND latest_revision_number = $7
                AND status = 'ACTIVE'
            `
          : `
              UPDATE chat_service.analysis_session
              SET active_revision_id = $4,
                  latest_revision_number = $5,
                  updated_at = $6::timestamptz
              WHERE analysis_id = $1
                AND principal_id = $2
                AND thread_id = $3
                AND active_revision_id = $7
                AND latest_revision_number = $8
                AND status = 'ACTIVE'
            `,
        queued
          ? [
              input.scope.analysisId,
              input.scope.principalId,
              input.scope.threadId,
              input.revision.revisionNumber,
              input.updatedAt,
              input.expectedRevisionId,
              input.expectedRevisionNumber,
            ]
          : [
              input.scope.analysisId,
              input.scope.principalId,
              input.scope.threadId,
              input.revision.revisionId,
              input.revision.revisionNumber,
              input.updatedAt,
              input.expectedRevisionId,
              input.expectedRevisionNumber,
            ],
      );
      if (switched.rowCount !== 1) {
        throw new PersistenceConflictError("Analysis active revision conflict");
      }
      return input.revision;
    });
  }

  async activateQueuedRevisionAndStartRun(input: {
    readonly scope: AnalysisScope;
    readonly expectedActiveRevisionId: string;
    readonly queuedRevisionId: string;
    readonly queuedRevisionNumber: number;
    readonly run: AnalysisRun;
    readonly updatedAt: string;
  }): Promise<{
    readonly revision: Pick<AnalysisRevision, "revisionId" | "status">;
    readonly run: AnalysisRun;
  }> {
    assertRun(input.run);
    timestamp(input.updatedAt, "updatedAt");
    if (
      input.run.analysisId !== input.scope.analysisId ||
      input.run.revisionId !== input.queuedRevisionId ||
      !["STARTING", "RUNNING"].includes(input.run.status)
    ) {
      throw new PersistenceConflictError(
        "Queued revision activation run mismatch",
      );
    }
    return this.transaction(async (client) => {
      const session = await lockAuthorizedSession(client, input.scope);
      if (
        session.status !== "ACTIVE" ||
        session.active_revision_id !== input.expectedActiveRevisionId ||
        Number(session.latest_revision_number) !== input.queuedRevisionNumber
      ) {
        throw new PersistenceConflictError(
          "Queued revision activation conflict",
        );
      }
      const queuedResult = await client.query<{
        revision_id: string;
        parent_revision_id: string | null;
        status: AnalysisRevision["status"];
      }>(
        `
          SELECT revision_id, parent_revision_id, status
          FROM chat_service.analysis_revision
          WHERE revision_id = $1
            AND analysis_id = $2
            AND revision_number = $3
          FOR UPDATE
        `,
        [
          input.queuedRevisionId,
          input.scope.analysisId,
          input.queuedRevisionNumber,
        ],
      );
      const queued = requiredRow(queuedResult.rows, "queued revision lookup");
      if (
        queued.status !== "QUEUED" ||
        queued.parent_revision_id !== input.expectedActiveRevisionId
      ) {
        throw new PersistenceConflictError(
          "Queued revision activation conflict",
        );
      }
      const previousRun = await client.query<{ status: AnalysisRun["status"] }>(
        `
          SELECT status
          FROM chat_service.analysis_run
          WHERE analysis_id = $1
            AND revision_id = $2
          ORDER BY attempt DESC
          LIMIT 1
          FOR UPDATE
        `,
        [input.scope.analysisId, input.expectedActiveRevisionId],
      );
      const terminalStatus = previousRun.rows[0]?.status;
      if (
        terminalStatus === undefined ||
        !["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"].includes(
          terminalStatus,
        )
      ) {
        throw new PersistenceConflictError(
          "Active analysis run is not terminal",
        );
      }
      await insertRun(client, input.run);
      const superseded = await client.query(
        `
          UPDATE chat_service.analysis_revision
          SET status = 'SUPERSEDED'
          WHERE revision_id = $1
            AND analysis_id = $2
        `,
        [input.expectedActiveRevisionId, input.scope.analysisId],
      );
      const activated = await client.query(
        `
          UPDATE chat_service.analysis_revision
          SET status = 'RUNNING'
          WHERE revision_id = $1
            AND analysis_id = $2
            AND status = 'QUEUED'
        `,
        [input.queuedRevisionId, input.scope.analysisId],
      );
      const switched = await client.query(
        `
          UPDATE chat_service.analysis_session
          SET active_revision_id = $4,
              updated_at = $5::timestamptz
          WHERE analysis_id = $1
            AND principal_id = $2
            AND thread_id = $3
            AND active_revision_id = $6
            AND latest_revision_number = $7
            AND status = 'ACTIVE'
        `,
        [
          input.scope.analysisId,
          input.scope.principalId,
          input.scope.threadId,
          input.queuedRevisionId,
          input.updatedAt,
          input.expectedActiveRevisionId,
          input.queuedRevisionNumber,
        ],
      );
      if (
        superseded.rowCount !== 1 ||
        activated.rowCount !== 1 ||
        switched.rowCount !== 1
      ) {
        throw new PersistenceConflictError(
          "Queued revision activation conflict",
        );
      }
      return {
        revision: {
          revisionId: queued.revision_id,
          status: "RUNNING",
        },
        run: input.run,
      };
    });
  }

  async startRun(input: {
    readonly scope: AnalysisScope;
    readonly run: AnalysisRun;
  }): Promise<AnalysisRun> {
    assertRun(input.run);
    if (input.run.analysisId !== input.scope.analysisId) {
      throw new PersistenceConflictError("Analysis run scope mismatch");
    }
    return this.transaction(async (client) => {
      await lockAuthorizedSession(client, input.scope);
      const revision = await client.query(
        `
          SELECT 1
          FROM chat_service.analysis_revision
          WHERE revision_id = $1 AND analysis_id = $2
        `,
        [input.run.revisionId, input.scope.analysisId],
      );
      if (revision.rows[0] === undefined) {
        throw new PersistenceConflictError("Analysis run revision is unknown");
      }
      try {
        await insertRun(client, input.run);
      } catch (error) {
        throw persistenceWriteError(error, "Analysis run identity conflict");
      }
      return input.run;
    });
  }

  async saveProposal(input: {
    readonly scope: AnalysisScope;
    readonly commandId: string;
    readonly proposalId: string;
    readonly expectedRevisionId: string;
    readonly expectedRevisionNumber: number;
    readonly targetNodeId: string;
    readonly publicArgsHash: string;
    readonly editSchemaHash: string;
    readonly patch: readonly JsonPatchOperation[];
    readonly mode: "SUGGEST_NEXT_REVISION" | "INTERRUPT_AND_APPLY";
    readonly idempotencyKey: string;
    readonly createdAt: string;
  }): Promise<{
    readonly created: boolean;
    readonly proposal: AnalysisChangeProposal;
  }> {
    assertIdentifier(input.commandId, "commandId");
    assertIdentifier(input.proposalId, "proposalId");
    assertIdentifier(input.targetNodeId, "targetNodeId");
    assertIdentifier(input.expectedRevisionId, "expectedRevisionId");
    assertSha256(input.publicArgsHash, "publicArgsHash");
    assertSha256(input.editSchemaHash, "editSchemaHash");
    timestamp(input.createdAt, "createdAt");
    if (
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 256 ||
      input.patch.length < 1 ||
      input.patch.length > 64
    ) {
      throw new PersistenceConflictError("Analysis proposal limits exceeded");
    }
    const requestHash = canonicalHash({
      commandId: input.commandId,
      analysisId: input.scope.analysisId,
      expectedRevisionId: input.expectedRevisionId,
      expectedRevisionNumber: input.expectedRevisionNumber,
      targetNodeId: input.targetNodeId,
      publicArgsHash: input.publicArgsHash,
      editSchemaHash: input.editSchemaHash,
      patch: [...input.patch] as unknown as JsonValue[],
      mode: input.mode,
    });
    return this.transaction(async (client) => {
      const session = await lockAuthorizedSession(client, input.scope);
      if (session.status !== "ACTIVE") {
        throw new PersistenceConflictError(
          "Inactive analysis cannot accept a proposal",
        );
      }
      const existing = await client.query<AnalysisProposalRow>(
        `
          SELECT *
          FROM chat_service.analysis_change_proposal
          WHERE analysis_id = $1 AND idempotency_key = $2
          FOR UPDATE
        `,
        [input.scope.analysisId, input.idempotencyKey],
      );
      if (existing.rows[0] !== undefined) {
        const proposal = mapProposal(existing.rows[0]);
        if (proposal.requestHash !== requestHash) {
          throw new PersistenceConflictError("Analysis idempotency conflict");
        }
        return { created: false, proposal };
      }
      if (
        session.active_revision_id !== input.expectedRevisionId ||
        Number(session.latest_revision_number) !== input.expectedRevisionNumber
      ) {
        throw new PersistenceConflictError("Analysis active revision conflict");
      }
      try {
        const inserted = await client.query<AnalysisProposalRow>(
          `
            INSERT INTO chat_service.analysis_change_proposal(
              proposal_id, command_id, analysis_id, expected_revision_id,
              expected_revision_number, target_node_id, public_args_hash,
              edit_schema_hash, patch_json, mode, idempotency_key,
              request_hash, status, created_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11,
              $12, 'SUBMITTED', $13::timestamptz
            )
            RETURNING *
          `,
          [
            input.proposalId,
            input.commandId,
            input.scope.analysisId,
            input.expectedRevisionId,
            input.expectedRevisionNumber,
            input.targetNodeId,
            input.publicArgsHash,
            input.editSchemaHash,
            JSON.stringify(input.patch),
            input.mode,
            input.idempotencyKey,
            requestHash,
            input.createdAt,
          ],
        );
        return {
          created: true,
          proposal: mapProposal(requiredRow(inserted.rows, "proposal insert")),
        };
      } catch (error) {
        throw persistenceWriteError(error, "Analysis proposal conflict");
      }
    });
  }

  async createIntervention(input: {
    readonly scope: AnalysisScope;
    readonly interventionId: string;
    readonly revisionId: string;
    readonly runId: string;
    readonly interruptId: string;
    readonly reason: AnalysisIntervention["reason"];
    readonly requestPayload: Readonly<Record<string, JsonValue>>;
    readonly createdAt: string;
  }): Promise<AnalysisIntervention> {
    for (const [value, label] of [
      [input.interventionId, "interventionId"],
      [input.revisionId, "revisionId"],
      [input.runId, "runId"],
      [input.interruptId, "interruptId"],
    ] as const) {
      assertIdentifier(value, label);
    }
    timestamp(input.createdAt, "createdAt");
    assertJsonBudget(input.requestPayload, 1024 * 1024, "requestPayload");
    const requestHash = canonicalHash(input.requestPayload);
    return this.transaction(async (client) => {
      await lockAuthorizedSession(client, input.scope);
      try {
        const inserted = await client.query<AnalysisInterventionRow>(
          `
            INSERT INTO chat_service.analysis_intervention(
              intervention_id, analysis_id, revision_id, run_id,
              interrupt_id, reason, status, request_payload_json,
              request_hash, created_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, 'OPEN', $7::jsonb, $8,
              $9::timestamptz
            )
            RETURNING *
          `,
          [
            input.interventionId,
            input.scope.analysisId,
            input.revisionId,
            input.runId,
            input.interruptId,
            input.reason,
            JSON.stringify(input.requestPayload),
            requestHash,
            input.createdAt,
          ],
        );
        return mapIntervention(
          requiredRow(inserted.rows, "intervention insert"),
        );
      } catch (error) {
        throw persistenceWriteError(error, "Analysis intervention conflict");
      }
    });
  }

  async appendEventAndProject(input: {
    readonly scope: AnalysisScope;
    readonly event: AnalysisEvent;
    readonly projection?: AnalysisProjection;
  }): Promise<AppendAnalysisEventResult> {
    assertEvent(input.event);
    if (input.event.analysisId !== input.scope.analysisId) {
      throw new PersistenceConflictError("Analysis event scope mismatch");
    }
    return this.transaction(async (client) => {
      const session = await lockAuthorizedSession(client, input.scope);
      const collision = await findEventCollision(client, input.event);
      if (collision !== undefined) {
        if (!sameEvent(collision, input.event)) {
          throw new PersistenceConflictError(
            "Analysis event sequence conflict",
          );
        }
        const projection = await requiredProjection(
          client,
          input.scope.analysisId,
        );
        return {
          created: false,
          projected: false,
          event: collision,
          projection,
        };
      }
      await assertEventLineage(client, input.event);
      await assertNextSequences(client, input.event);
      const currentProjection = await findProjectionForUpdate(
        client,
        input.scope.analysisId,
      );
      const isActiveRevision =
        session.active_revision_id === input.event.revisionId;
      const nextProjection = isActiveRevision
        ? requireNextProjection(
            input.scope.analysisId,
            input.event.analysisSequence,
            currentProjection,
            input.projection,
          )
        : auditOnlyProjection(
            input.event.analysisSequence,
            currentProjection,
            input.event.occurredAt,
          );
      try {
        const inserted = await client.query<AnalysisEventRow>(
          `
          INSERT INTO chat_service.analysis_event(
            event_id, analysis_id, revision_id, run_id, analysis_sequence,
            run_sequence, upstream_sequence, event_type, node_id,
            correlation_id, causation_id, occurred_at, payload_json,
            payload_hash
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12::timestamptz, $13::jsonb, $14
          )
          RETURNING *
        `,
          [
            input.event.eventId,
            input.event.analysisId,
            input.event.revisionId,
            input.event.runId,
            input.event.analysisSequence,
            input.event.runSequence,
            input.event.upstreamSequence ?? null,
            input.event.eventType,
            input.event.nodeId ?? null,
            input.event.correlationId,
            input.event.causationId ?? null,
            input.event.occurredAt,
            JSON.stringify(input.event.payload),
            input.event.payloadHash,
          ],
        );
        const storedProjection = await upsertProjection(client, nextProjection);
        return {
          created: true,
          projected: isActiveRevision,
          event: mapEvent(requiredRow(inserted.rows, "analysis event insert")),
          projection: storedProjection,
        };
      } catch (error) {
        throw persistenceWriteError(error, "Analysis event commit conflict");
      }
    });
  }

  async getProjection(
    scope: AnalysisScope,
  ): Promise<AnalysisProjection | undefined> {
    const result = await this.pool.query<AnalysisProjectionRow>(
      `
        SELECT projection.*
        FROM chat_service.analysis_projection projection
        JOIN chat_service.analysis_session session
          ON session.analysis_id = projection.analysis_id
        JOIN chat_service.conversation_thread thread
          ON thread.thread_id = session.thread_id
         AND thread.principal_id = session.principal_id
        WHERE projection.analysis_id = $1
          AND session.principal_id = $2
          AND session.thread_id = $3
      `,
      [scope.analysisId, scope.principalId, scope.threadId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapProjection(result.rows[0]);
  }

  async getSnapshot(
    scope: AnalysisScope,
  ): Promise<AnalysisPersistenceSnapshot | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const session = await findAuthorizedSession(client, scope);
      if (session === undefined) {
        await client.query("COMMIT");
        return undefined;
      }
      const projection = await findProjection(client, scope.analysisId);
      await client.query("COMMIT");
      return {
        session: mapSession(session),
        ...(projection === undefined
          ? {}
          : { projection: mapProjection(projection) }),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

interface AnalysisSessionRow {
  analysis_id: string;
  principal_id: string;
  thread_id: string;
  grounding_id: string;
  title: string;
  autonomy_mode: AnalysisSession["autonomyMode"];
  status: AnalysisSession["status"];
  active_revision_id: string;
  latest_revision_number: number | string;
  observer_policy_hash: string;
  created_at: Date;
  updated_at: Date;
}

interface AnalysisEventRow {
  event_id: string;
  analysis_id: string;
  revision_id: string;
  run_id: string;
  analysis_sequence: number | string;
  run_sequence: number | string;
  upstream_sequence: number | string | null;
  event_type: string;
  node_id: string | null;
  correlation_id: string;
  causation_id: string | null;
  occurred_at: Date;
  payload_json: unknown;
  payload_hash: string;
  created_at: Date;
}

interface AnalysisProjectionRow {
  analysis_id: string;
  state_revision: number | string;
  activity_revision: number | string;
  state_json: unknown;
  state_hash: string;
  activity_json: unknown;
  activity_hash: string;
  last_event_sequence: number | string;
  updated_at: Date;
}

interface AnalysisProposalRow {
  proposal_id: string;
  command_id: string;
  analysis_id: string;
  expected_revision_id: string;
  expected_revision_number: number | string;
  target_node_id: string;
  public_args_hash: string;
  edit_schema_hash: string;
  patch_json: unknown;
  mode: AnalysisChangeProposal["mode"];
  idempotency_key: string;
  request_hash: string;
  status: AnalysisChangeProposal["status"];
  created_at: Date;
  applied_revision_id: string | null;
}

interface AnalysisInterventionRow {
  intervention_id: string;
  analysis_id: string;
  revision_id: string;
  run_id: string;
  interrupt_id: string;
  reason: AnalysisIntervention["reason"];
  status: AnalysisIntervention["status"];
  request_payload_json: unknown;
  request_hash: string;
  response_payload_json: unknown | null;
  response_hash: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

async function insertSession(
  client: PoolClient,
  session: AnalysisSession,
): Promise<void> {
  await client.query(
    `
      INSERT INTO chat_service.analysis_session(
        analysis_id, principal_id, thread_id, grounding_id, title,
        autonomy_mode, status, active_revision_id, latest_revision_number,
        observer_policy_hash, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11::timestamptz, $12::timestamptz
      )
    `,
    [
      session.analysisId,
      session.principalId,
      session.threadId,
      session.groundingId,
      session.title,
      session.autonomyMode,
      session.status,
      session.activeRevisionId,
      session.latestRevisionNumber,
      session.observerPolicyHash,
      session.createdAt,
      session.updatedAt,
    ],
  );
}

async function insertRevision(
  client: PoolClient,
  revision: AnalysisRevision,
): Promise<void> {
  await client.query(
    `
      INSERT INTO chat_service.analysis_revision(
        revision_id, analysis_id, revision_number, parent_revision_id,
        parent_run_id, cause, wsgs_plan_id, plan_hash, changed_paths_json,
        reused_node_ids_json, invalidated_node_ids_json, rerun_node_ids_json,
        status, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
        $11::jsonb, $12::jsonb, $13, $14::timestamptz
      )
    `,
    [
      revision.revisionId,
      revision.analysisId,
      revision.revisionNumber,
      revision.parentRevisionId ?? null,
      revision.parentRunId ?? null,
      revision.cause,
      revision.wsgsPlanId,
      revision.planHash,
      JSON.stringify(revision.changedPaths),
      JSON.stringify(revision.reusedNodeIds),
      JSON.stringify(revision.invalidatedNodeIds),
      JSON.stringify(revision.rerunNodeIds),
      revision.status,
      revision.createdAt,
    ],
  );
}

async function insertRun(client: PoolClient, run: AnalysisRun): Promise<void> {
  await client.query(
    `
      INSERT INTO chat_service.analysis_run(
        run_id, analysis_id, revision_id, attempt, parent_run_id,
        upstream_run_id, status, started_at, finished_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz,
        $9::timestamptz)
    `,
    [
      run.runId,
      run.analysisId,
      run.revisionId,
      run.attempt,
      run.parentRunId ?? null,
      run.upstreamRunId ?? null,
      run.status,
      run.startedAt,
      run.finishedAt ?? null,
    ],
  );
}

async function assertThreadScope(
  client: PoolClient,
  scope: Pick<AnalysisScope, "principalId" | "threadId">,
): Promise<void> {
  const authorized = await client.query(
    `
      SELECT 1 FROM chat_service.conversation_thread
      WHERE thread_id = $1 AND principal_id = $2
    `,
    [scope.threadId, scope.principalId],
  );
  if (authorized.rows[0] === undefined) {
    throw new PersistenceAuthorizationError(
      "Analysis scope is not authorized for principal",
    );
  }
}

async function findAuthorizedSession(
  client: PoolClient,
  scope: AnalysisScope,
  lock = false,
): Promise<AnalysisSessionRow | undefined> {
  const result = await client.query<AnalysisSessionRow>(
    `
      SELECT session.*
      FROM chat_service.analysis_session session
      JOIN chat_service.conversation_thread thread
        ON thread.thread_id = session.thread_id
       AND thread.principal_id = session.principal_id
      WHERE session.analysis_id = $1
        AND session.principal_id = $2
        AND session.thread_id = $3
      ${lock ? "FOR UPDATE OF session" : ""}
    `,
    [scope.analysisId, scope.principalId, scope.threadId],
  );
  return result.rows[0];
}

async function lockAuthorizedSession(
  client: PoolClient,
  scope: AnalysisScope,
): Promise<AnalysisSessionRow> {
  const session = await findAuthorizedSession(client, scope, true);
  if (session === undefined) {
    throw new PersistenceAuthorizationError(
      "Analysis is not authorized for principal and thread",
    );
  }
  return session;
}

async function findEventCollision(
  client: PoolClient,
  event: AnalysisEvent,
): Promise<StoredAnalysisEvent | undefined> {
  const result = await client.query<AnalysisEventRow>(
    `
      SELECT *
      FROM chat_service.analysis_event
      WHERE analysis_id = $1
        AND (
          event_id = $2
          OR analysis_sequence = $3
          OR (run_id = $4 AND run_sequence = $5)
          OR (
            $6::bigint IS NOT NULL
            AND run_id = $4
            AND upstream_sequence = $6
          )
        )
      ORDER BY analysis_sequence
      FOR UPDATE
    `,
    [
      event.analysisId,
      event.eventId,
      event.analysisSequence,
      event.runId,
      event.runSequence,
      event.upstreamSequence ?? null,
    ],
  );
  if (result.rows.length === 0) return undefined;
  if (result.rows.length !== 1) {
    throw new PersistenceConflictError("Analysis event identity collision");
  }
  return mapEvent(result.rows[0] as AnalysisEventRow);
}

async function assertEventLineage(
  client: PoolClient,
  event: AnalysisEvent,
): Promise<void> {
  const result = await client.query(
    `
      SELECT 1
      FROM chat_service.analysis_run run
      WHERE run.run_id = $1
        AND run.revision_id = $2
        AND run.analysis_id = $3
    `,
    [event.runId, event.revisionId, event.analysisId],
  );
  if (result.rows[0] === undefined) {
    throw new PersistenceConflictError("Analysis event lineage mismatch");
  }
}

async function assertNextSequences(
  client: PoolClient,
  event: AnalysisEvent,
): Promise<void> {
  const result = await client.query<{
    analysis_sequence: number | string;
    run_sequence: number | string;
    upstream_sequence: number | string;
  }>(
    `
      SELECT
        COALESCE(max(analysis_sequence), 0) AS analysis_sequence,
        COALESCE(max(run_sequence) FILTER (WHERE run_id = $2), 0) AS run_sequence,
        COALESCE(max(upstream_sequence) FILTER (WHERE run_id = $2), 0)
          AS upstream_sequence
      FROM chat_service.analysis_event
      WHERE analysis_id = $1
    `,
    [event.analysisId, event.runId],
  );
  const row = requiredRow(result.rows, "analysis sequence lookup");
  if (
    event.analysisSequence !== Number(row.analysis_sequence) + 1 ||
    event.runSequence !== Number(row.run_sequence) + 1 ||
    (event.upstreamSequence !== undefined &&
      event.upstreamSequence <= Number(row.upstream_sequence))
  ) {
    throw new PersistenceConflictError("Analysis event sequence is not next");
  }
}

async function findProjectionForUpdate(
  client: PoolClient,
  analysisId: string,
): Promise<AnalysisProjection | undefined> {
  const result = await client.query<AnalysisProjectionRow>(
    `
      SELECT * FROM chat_service.analysis_projection
      WHERE analysis_id = $1
      FOR UPDATE
    `,
    [analysisId],
  );
  return result.rows[0] === undefined
    ? undefined
    : mapProjection(result.rows[0]);
}

async function findProjection(
  client: PoolClient,
  analysisId: string,
): Promise<AnalysisProjectionRow | undefined> {
  const result = await client.query<AnalysisProjectionRow>(
    "SELECT * FROM chat_service.analysis_projection WHERE analysis_id = $1",
    [analysisId],
  );
  return result.rows[0];
}

async function requiredProjection(
  client: PoolClient,
  analysisId: string,
): Promise<AnalysisProjection> {
  const projection = await findProjectionForUpdate(client, analysisId);
  if (projection === undefined) {
    throw new PersistenceConflictError("Analysis projection is unavailable");
  }
  return projection;
}

function requireNextProjection(
  analysisId: string,
  eventSequence: number,
  current: AnalysisProjection | undefined,
  next: AnalysisProjection | undefined,
): AnalysisProjection {
  if (next === undefined) {
    throw new PersistenceConflictError(
      "Active analysis event requires a projection",
    );
  }
  assertProjection(next);
  if (
    next.analysisId !== analysisId ||
    next.lastEventSequence !== eventSequence
  ) {
    throw new PersistenceConflictError("Analysis projection identity mismatch");
  }
  if (current === undefined) return next;
  if (
    next.stateRevision < current.stateRevision ||
    next.stateRevision > current.stateRevision + 1 ||
    next.activityRevision < current.activityRevision ||
    next.activityRevision > current.activityRevision + 1
  ) {
    throw new PersistenceConflictError("Analysis projection revision conflict");
  }
  if (
    (next.stateRevision === current.stateRevision &&
      (next.stateHash !== current.stateHash ||
        canonicalHash(next.state) !== canonicalHash(current.state))) ||
    (next.activityRevision === current.activityRevision &&
      (next.activityHash !== current.activityHash ||
        canonicalHash(next.activity) !== canonicalHash(current.activity)))
  ) {
    throw new PersistenceConflictError(
      "Analysis projection changed without a revision",
    );
  }
  return next;
}

function auditOnlyProjection(
  eventSequence: number,
  current: AnalysisProjection | undefined,
  occurredAt: string,
): AnalysisProjection {
  if (current === undefined) {
    throw new PersistenceConflictError(
      "Late analysis event requires an existing projection",
    );
  }
  return {
    ...current,
    lastEventSequence: eventSequence,
    updatedAt: timestamp(occurredAt, "occurredAt"),
  };
}

async function upsertProjection(
  client: PoolClient,
  projection: AnalysisProjection,
): Promise<AnalysisProjection> {
  const result = await client.query<AnalysisProjectionRow>(
    `
      INSERT INTO chat_service.analysis_projection(
        analysis_id, state_revision, activity_revision, state_json,
        state_hash, activity_json, activity_hash, last_event_sequence,
        updated_at
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9::timestamptz
      )
      ON CONFLICT (analysis_id) DO UPDATE
      SET state_revision = EXCLUDED.state_revision,
          activity_revision = EXCLUDED.activity_revision,
          state_json = EXCLUDED.state_json,
          state_hash = EXCLUDED.state_hash,
          activity_json = EXCLUDED.activity_json,
          activity_hash = EXCLUDED.activity_hash,
          last_event_sequence = EXCLUDED.last_event_sequence,
          updated_at = EXCLUDED.updated_at
      RETURNING *
    `,
    [
      projection.analysisId,
      projection.stateRevision,
      projection.activityRevision,
      JSON.stringify(projection.state),
      projection.stateHash,
      JSON.stringify(projection.activity),
      projection.activityHash,
      projection.lastEventSequence,
      projection.updatedAt,
    ],
  );
  return mapProjection(requiredRow(result.rows, "projection upsert"));
}

function mapSession(row: AnalysisSessionRow): AnalysisSession {
  return {
    schemaVersion: "sacs-analysis-session/1.0",
    analysisId: row.analysis_id,
    principalId: row.principal_id,
    threadId: row.thread_id,
    groundingId: row.grounding_id,
    title: row.title,
    autonomyMode: row.autonomy_mode,
    status: row.status,
    activeRevisionId: row.active_revision_id,
    latestRevisionNumber: Number(row.latest_revision_number),
    observerPolicyHash: row.observer_policy_hash,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapEvent(row: AnalysisEventRow): StoredAnalysisEvent {
  return {
    schemaVersion: "sacs-analysis-event/1.0",
    eventId: row.event_id,
    analysisId: row.analysis_id,
    revisionId: row.revision_id,
    runId: row.run_id,
    analysisSequence: Number(row.analysis_sequence),
    runSequence: Number(row.run_sequence),
    ...(row.upstream_sequence === null
      ? {}
      : { upstreamSequence: Number(row.upstream_sequence) }),
    eventType: row.event_type,
    ...(row.node_id === null ? {} : { nodeId: row.node_id }),
    correlationId: row.correlation_id,
    ...(row.causation_id === null ? {} : { causationId: row.causation_id }),
    occurredAt: row.occurred_at.toISOString(),
    payload: jsonObject(row.payload_json, "event payload"),
    payloadHash: row.payload_hash,
    createdAt: row.created_at.toISOString(),
  };
}

function mapProjection(row: AnalysisProjectionRow): AnalysisProjection {
  const projection = {
    schemaVersion: "sacs-analysis-projection/1.0" as const,
    analysisId: row.analysis_id,
    stateRevision: Number(row.state_revision),
    activityRevision: Number(row.activity_revision),
    state: jsonObject(row.state_json, "analysis state"),
    stateHash: row.state_hash,
    activity: jsonObject(row.activity_json, "analysis activity"),
    activityHash: row.activity_hash,
    lastEventSequence: Number(row.last_event_sequence),
    updatedAt: row.updated_at.toISOString(),
  };
  assertProjection(projection);
  return projection;
}

function mapProposal(row: AnalysisProposalRow): AnalysisChangeProposal {
  const patch = jsonArray(row.patch_json, "analysis proposal patch").map(
    (value) => value as unknown as JsonPatchOperation,
  );
  return {
    schemaVersion: "sacs-analysis-change-proposal/1.0",
    commandId: row.command_id,
    proposalId: row.proposal_id,
    analysisId: row.analysis_id,
    expectedRevisionId: row.expected_revision_id,
    expectedRevisionNumber: Number(row.expected_revision_number),
    targetNodeId: row.target_node_id,
    publicArgsHash: row.public_args_hash,
    editSchemaHash: row.edit_schema_hash,
    patch,
    mode: row.mode,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    ...(row.applied_revision_id === null
      ? {}
      : { appliedRevisionId: row.applied_revision_id }),
  };
}

function mapIntervention(row: AnalysisInterventionRow): AnalysisIntervention {
  return {
    schemaVersion: "sacs-analysis-intervention/1.0",
    interventionId: row.intervention_id,
    analysisId: row.analysis_id,
    revisionId: row.revision_id,
    runId: row.run_id,
    interruptId: row.interrupt_id,
    reason: row.reason,
    status: row.status,
    requestPayload: jsonObject(
      row.request_payload_json,
      "intervention request",
    ),
    requestHash: row.request_hash,
    ...(row.response_payload_json === null
      ? {}
      : {
          responsePayload: jsonObject(
            row.response_payload_json,
            "intervention response",
          ),
        }),
    ...(row.response_hash === null ? {} : { responseHash: row.response_hash }),
    createdAt: row.created_at.toISOString(),
    ...(row.resolved_at === null
      ? {}
      : { resolvedAt: row.resolved_at.toISOString() }),
  };
}

function assertInitialSession(
  session: AnalysisSession,
  revision: AnalysisRevision,
): void {
  assertScope(session);
  assertIdentifier(session.groundingId, "groundingId");
  assertIdentifier(session.activeRevisionId, "activeRevisionId");
  assertSha256(session.observerPolicyHash, "observerPolicyHash");
  timestamp(session.createdAt, "createdAt");
  timestamp(session.updatedAt, "updatedAt");
  assertRevision(revision);
  if (
    session.title.length < 1 ||
    session.title.length > 512 ||
    revision.analysisId !== session.analysisId ||
    revision.revisionId !== session.activeRevisionId ||
    revision.revisionNumber !== session.latestRevisionNumber ||
    revision.parentRevisionId !== undefined
  ) {
    throw new PersistenceConflictError(
      "Initial analysis session and revision do not match",
    );
  }
}

function assertRevision(revision: AnalysisRevision): void {
  assertIdentifier(revision.revisionId, "revisionId");
  assertIdentifier(revision.analysisId, "analysisId");
  assertIdentifier(revision.wsgsPlanId, "wsgsPlanId");
  assertSha256(revision.planHash, "planHash");
  timestamp(revision.createdAt, "createdAt");
  if (
    !Number.isInteger(revision.revisionNumber) ||
    revision.revisionNumber < 0
  ) {
    throw new PersistenceConflictError("Invalid analysis revision number");
  }
  if (
    revision.changedPaths.length > 128 ||
    revision.changedPaths.some((path) => !path.startsWith("/"))
  ) {
    throw new PersistenceConflictError("Invalid analysis changed paths");
  }
  for (const values of [
    revision.reusedNodeIds,
    revision.invalidatedNodeIds,
    revision.rerunNodeIds,
  ]) {
    if (values.length > 256 || new Set(values).size !== values.length) {
      throw new PersistenceConflictError("Invalid analysis node decision set");
    }
    values.forEach((value) => assertIdentifier(value, "nodeId"));
  }
  const decisions = [
    ...revision.reusedNodeIds,
    ...revision.invalidatedNodeIds,
    ...revision.rerunNodeIds,
  ];
  if (new Set(decisions).size !== decisions.length) {
    throw new PersistenceConflictError(
      "Analysis node decision sets must be disjoint",
    );
  }
}

function assertRun(run: AnalysisRun): void {
  assertIdentifier(run.runId, "runId");
  assertIdentifier(run.analysisId, "analysisId");
  assertIdentifier(run.revisionId, "revisionId");
  if (run.parentRunId !== undefined)
    assertIdentifier(run.parentRunId, "parentRunId");
  if (run.upstreamRunId !== undefined) {
    assertIdentifier(run.upstreamRunId, "upstreamRunId");
  }
  if (!Number.isInteger(run.attempt) || run.attempt < 1) {
    throw new PersistenceConflictError("Invalid analysis run attempt");
  }
  timestamp(run.startedAt, "startedAt");
  if (run.finishedAt !== undefined) timestamp(run.finishedAt, "finishedAt");
}

function assertEvent(event: AnalysisEvent): void {
  assertIdentifier(event.eventId, "eventId");
  assertIdentifier(event.analysisId, "analysisId");
  assertIdentifier(event.revisionId, "revisionId");
  assertIdentifier(event.runId, "runId");
  assertIdentifier(event.correlationId, "correlationId");
  if (event.nodeId !== undefined) assertIdentifier(event.nodeId, "nodeId");
  if (event.causationId !== undefined) {
    assertIdentifier(event.causationId, "causationId");
  }
  timestamp(event.occurredAt, "occurredAt");
  if (
    !Number.isSafeInteger(event.analysisSequence) ||
    event.analysisSequence < 1 ||
    !Number.isSafeInteger(event.runSequence) ||
    event.runSequence < 1 ||
    (event.upstreamSequence !== undefined &&
      (!Number.isSafeInteger(event.upstreamSequence) ||
        event.upstreamSequence < 1)) ||
    event.eventType.length < 1 ||
    event.eventType.length > 128
  ) {
    throw new PersistenceConflictError("Invalid analysis event sequence");
  }
  assertJsonBudget(
    event.payload,
    ANALYSIS_EVENT_PAYLOAD_MAX_BYTES,
    "event payload",
  );
  if (event.payloadHash !== canonicalHash(event.payload)) {
    throw new PersistenceConflictError("Analysis event payload hash mismatch");
  }
}

function assertProjection(projection: AnalysisProjection): void {
  assertIdentifier(projection.analysisId, "analysisId");
  timestamp(projection.updatedAt, "updatedAt");
  if (
    !Number.isSafeInteger(projection.stateRevision) ||
    projection.stateRevision < 0 ||
    !Number.isSafeInteger(projection.activityRevision) ||
    projection.activityRevision < 0 ||
    !Number.isSafeInteger(projection.lastEventSequence) ||
    projection.lastEventSequence < 0
  ) {
    throw new PersistenceConflictError("Invalid analysis projection revision");
  }
  assertJsonBudget(
    projection.state,
    ANALYSIS_STATE_MAX_BYTES,
    "analysis state",
  );
  assertJsonBudget(
    projection.activity,
    ANALYSIS_ACTIVITY_MAX_BYTES,
    "analysis activity",
  );
  if (
    projection.stateHash !== canonicalHash(projection.state) ||
    projection.activityHash !== canonicalHash(projection.activity)
  ) {
    throw new PersistenceConflictError("Analysis projection hash mismatch");
  }
}

function assertScope(scope: AnalysisScope): void {
  assertIdentifier(scope.analysisId, "analysisId");
  assertIdentifier(scope.principalId, "principalId");
  assertIdentifier(scope.threadId, "threadId");
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw new PersistenceConflictError(`Invalid ${label}`);
  }
}

function assertSha256(value: string, label: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new PersistenceConflictError(`Invalid ${label}`);
  }
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) {
    throw new PersistenceConflictError(`Invalid ${label}`);
  }
  return parsed.toISOString();
}

function assertJsonBudget(
  value: JsonValue,
  maximum: number,
  label: string,
): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maximum) {
    throw new PersistenceConflictError(`${label} exceeds persistence budget`);
  }
}

function canonicalHash(value: JsonValue): string {
  return "sha256:" + hashJson(value);
}

function sameEvent(stored: StoredAnalysisEvent, input: AnalysisEvent): boolean {
  return (
    stored.eventId === input.eventId &&
    stored.analysisId === input.analysisId &&
    stored.revisionId === input.revisionId &&
    stored.runId === input.runId &&
    stored.analysisSequence === input.analysisSequence &&
    stored.runSequence === input.runSequence &&
    stored.upstreamSequence === input.upstreamSequence &&
    stored.eventType === input.eventType &&
    stored.nodeId === input.nodeId &&
    stored.correlationId === input.correlationId &&
    stored.causationId === input.causationId &&
    stored.occurredAt === timestamp(input.occurredAt, "occurredAt") &&
    stored.payloadHash === input.payloadHash &&
    canonicalHash(stored.payload) === canonicalHash(input.payload)
  );
}

function jsonObject(
  value: unknown,
  label: string,
): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PersistenceConflictError(`${label} is not an object`);
  }
  return value as Readonly<Record<string, JsonValue>>;
}

function jsonArray(value: unknown, label: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    throw new PersistenceConflictError(`${label} is not an array`);
  }
  return value as readonly JsonValue[];
}

function requiredRow<T>(rows: readonly T[], operation: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new PersistenceConflictError(`${operation} did not return a row`);
  }
  return row;
}

function persistenceWriteError(error: unknown, message: string): Error {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  return code === "23503"
    ? new PersistenceAuthorizationError(message)
    : code === "23505" || code === "23514" || code === "23P01"
      ? new PersistenceConflictError(message)
      : error instanceof Error
        ? error
        : new Error(message);
}
