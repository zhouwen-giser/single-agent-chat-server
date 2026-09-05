import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
  ANALYSIS_MAX_PUBLIC_ARGS_BYTES,
  ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
  agUiSharedStateV03Schema,
  analysisChangeProposalSchema,
  analysisInterventionSchema,
  analysisProjectionSchema,
  analysisRevisionSchema,
  analysisRunSchema,
  analysisSessionSchema,
  calculateAgUiStateSnapshotHash,
  assertAnalysisPublicArgsNonDisclosure,
  assertAnalysisPublicPatchNonDisclosure,
  toolInteractionDescriptorSchema,
  type AgUiSharedStateV03,
  type AnalysisChangeProposal,
  type AnalysisIntervention,
  type AnalysisProjection,
  type AnalysisRevision,
  type AnalysisRun,
  type AnalysisSession,
  type ToolInteractionDescriptor,
} from "../../analysis-contract/src/index.js";
import {
  AnalysisServiceError,
  type AnalysisCancelCommand,
  type AnalysisCoordinatorStore,
  type AnalysisInterventionResolutionCommand,
  type AnalysisRequestScope,
  type CommandClaim,
} from "../../analysis-control-runtime/src/index.js";
import type { CancelTransition } from "../../analysis-runtime/src/revision-coordinator.js";
import { compilePublicArgsSchemaValidator } from "../../analysis-tool-interaction/src/index.js";
import type {
  WsgsAnalysisEventDecision,
  WsgsAnalysisEventEnvelope,
} from "../../wsgs-analysis-consumer/src/index.js";
import {
  canonicalJson,
  hashCanonicalJson,
} from "../../world-explanation-contract/src/index.js";

import {
  ANALYSIS_ACTIVITY_MAX_BYTES,
  ANALYSIS_STATE_MAX_BYTES,
  AnalysisRepository,
  type AnalysisScope,
} from "./analysis-repository.js";
import {
  PersistenceAuthorizationError,
  PersistenceConflictError,
} from "./repository.js";

export interface AnalysisDevelopmentSeed {
  readonly scope: AnalysisScope;
  readonly session: AnalysisSession;
  readonly revision: AnalysisRevision;
  readonly run: AnalysisRun;
  readonly projection: AnalysisProjection;
  readonly descriptors: readonly ToolInteractionDescriptor[];
  readonly intervention?: AnalysisIntervention;
}

export interface AnalysisDevelopmentSnapshot {
  readonly session: AnalysisSession;
  readonly currentRevision: AnalysisRevision;
  readonly currentRun: AnalysisRun;
  readonly projection: AnalysisProjection;
  readonly openIntervention?: AnalysisIntervention;
}

export interface AnalysisDevelopmentEventCommit {
  readonly created: boolean;
  readonly disposition: WsgsAnalysisEventDecision["disposition"];
  readonly projection: AnalysisProjection;
  readonly snapshot: AgUiSharedStateV03;
}

export class AnalysisMutationClaimPendingError extends Error {
  constructor() {
    super("ANALYSIS_MUTATION_PENDING");
    this.name = "AnalysisMutationClaimPendingError";
  }
}

export interface TrustedPublicEditSchema {
  readonly uri: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export const DEVELOPMENT_TRUSTED_PUBLIC_EDIT_SCHEMAS = Object.freeze([
  Object.freeze({
    uri: "urn:sacs:fixture:wsgs-analysis-public-edit:1.0",
    schema: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["radiusMeters", "relation"]),
      properties: Object.freeze({
        radiusMeters: Object.freeze({
          type: "number",
          minimum: 1,
          maximum: 10_000,
        }),
        relation: Object.freeze({ enum: Object.freeze(["near", "within"]) }),
      }),
    }),
  }),
] satisfies readonly TrustedPublicEditSchema[]);

interface CompiledPublicEditSchema {
  readonly hash: string;
  readonly validate: (value: Readonly<Record<string, unknown>>) => boolean;
}

type CommandKind = "CANCEL" | "INTERVENTION_RESOLUTION";
type MutationClaimKind = "PROPOSAL" | CommandKind;

/**
 * PostgreSQL implementation used by the explicitly development-only analysis
 * runtime. Authorization is always re-derived from durable principal, thread,
 * and analysis ownership; callers cannot supply an internal scope to the HTTP
 * control surface.
 */
export class AnalysisDevelopmentRepository implements AnalysisCoordinatorStore {
  private readonly trustedPublicEditSchemas: ReadonlyMap<
    string,
    CompiledPublicEditSchema
  >;

  constructor(
    private readonly pool: Pool,
    private readonly repository = new AnalysisRepository(pool),
    trustedPublicEditSchemas: readonly TrustedPublicEditSchema[] = DEVELOPMENT_TRUSTED_PUBLIC_EDIT_SCHEMAS,
  ) {
    this.trustedPublicEditSchemas = compileTrustedPublicEditSchemas(
      trustedPublicEditSchemas,
    );
  }

  async seedAnalysis(input: AnalysisDevelopmentSeed): Promise<void> {
    const session = analysisSessionSchema.parse(input.session);
    const revision = analysisRevisionSchema.parse(input.revision);
    const run = analysisRunSchema.parse(input.run);
    const projection = analysisProjectionSchema.parse(input.projection);
    const descriptors = input.descriptors.map((value) =>
      toolInteractionDescriptorSchema.parse(value),
    );
    const intervention =
      input.intervention === undefined
        ? undefined
        : analysisInterventionSchema.parse(input.intervention);
    assertSeedLineage({
      scope: input.scope,
      session,
      revision,
      run,
      projection,
      descriptors,
      ...(intervention === undefined ? {} : { intervention }),
    });

    await this.transaction(async (client) => {
      await assertThreadScope(client, input.scope);
      const existing = await client.query<OwnedSessionRow>(
        `
          SELECT analysis_id, principal_id, thread_id, grounding_id
          FROM chat_service.analysis_session
          WHERE analysis_id = $1
          FOR UPDATE
        `,
        [input.scope.analysisId],
      );
      if (existing.rows[0] !== undefined) {
        const row = existing.rows[0];
        if (
          row.principal_id === input.scope.principalId &&
          row.thread_id === input.scope.threadId &&
          row.grounding_id === session.groundingId
        ) {
          return;
        }
        throw new PersistenceConflictError("Analysis identity conflict");
      }

      try {
        await insertSession(client, session);
        await insertRevision(client, revision);
        await insertRun(client, session.analysisId, run);
        await upsertProjection(client, projection);
        for (const descriptor of descriptors) {
          await insertDescriptor(client, {
            analysisId: session.analysisId,
            revisionId: revision.revisionId,
            runId: run.runId,
            descriptor,
            createdAt: session.createdAt,
          });
        }
        if (intervention !== undefined) {
          await insertIntervention(client, intervention);
        }
      } catch (error) {
        throw persistenceError(error, "Analysis development seed conflict");
      }
    });
  }

  async getDevelopmentSnapshot(
    scope: AnalysisScope,
  ): Promise<AnalysisDevelopmentSnapshot | undefined> {
    const stored = await this.repository.getSnapshot(scope);
    if (stored === undefined || stored.projection === undefined) {
      return undefined;
    }
    const session = analysisSessionSchema.parse(stored.session);
    const projection = analysisProjectionSchema.parse(stored.projection);
    const [revision, run, intervention] = await Promise.all([
      this.findRevision(scope, session.activeRevisionId),
      this.findCurrentRun(scope, session.activeRevisionId),
      this.findOpenIntervention(scope),
    ]);
    if (revision === undefined || run === undefined) {
      throw new PersistenceConflictError(
        "Analysis development snapshot lineage is incomplete",
      );
    }
    return {
      session,
      currentRevision: revision,
      currentRun: run,
      projection,
      ...(intervention === undefined ? {} : { openIntervention: intervention }),
    };
  }

  async getAnalysis(
    request: AnalysisRequestScope,
  ): Promise<unknown | undefined> {
    const scope = await this.resolveRequestScope(request);
    if (scope === undefined) return undefined;
    const snapshot = await this.getDevelopmentSnapshot(scope);
    if (snapshot === undefined) return undefined;
    return {
      analysisId: snapshot.session.analysisId,
      groundingId: snapshot.session.groundingId,
      title: snapshot.session.title,
      autonomyMode: snapshot.session.autonomyMode,
      status: snapshot.session.status,
      activeRevision: snapshot.currentRevision,
      currentRun: snapshot.currentRun,
      stateRevision: snapshot.projection.stateRevision,
      ...(snapshot.openIntervention === undefined
        ? {}
        : { pendingIntervention: snapshot.openIntervention }),
    };
  }

  async getSnapshot(
    request: AnalysisRequestScope,
  ): Promise<unknown | undefined> {
    const scope = await this.resolveRequestScope(request);
    if (scope === undefined) return undefined;
    const snapshot = await this.getDevelopmentSnapshot(scope);
    return snapshot?.projection.state;
  }

  async resolveRequestScope(
    request: AnalysisRequestScope,
  ): Promise<AnalysisScope | undefined> {
    const result = await this.pool.query<ResolvedScopeRow>(
      `
        SELECT session.analysis_id, session.principal_id, session.thread_id
        FROM chat_service.analysis_session session
        JOIN chat_service.principal principal
          ON principal.principal_id = session.principal_id
        JOIN chat_service.conversation_thread thread
          ON thread.thread_id = session.thread_id
         AND thread.principal_id = session.principal_id
        WHERE session.analysis_id = $1
          AND principal.issuer = 'openwebui-jwt'
          AND principal.subject = $2
          AND principal.role = $3
      `,
      [request.analysisId, request.userId, request.userRole],
    );
    return result.rows[0] === undefined
      ? undefined
      : {
          analysisId: result.rows[0].analysis_id,
          principalId: result.rows[0].principal_id,
          threadId: result.rows[0].thread_id,
        };
  }

  async loadProposalContext(
    request: AnalysisRequestScope,
    proposalId: string,
    claimToken: string,
  ) {
    return this.transaction(async (client) => {
      const owned = await lockRequestScope(client, request);
      if (owned === undefined) return undefined;
      const proposalResult = await client.query<ProposalRow>(
        `
          SELECT * FROM chat_service.analysis_change_proposal
          WHERE analysis_id = $1 AND proposal_id = $2
          FOR UPDATE
        `,
        [owned.analysisId, proposalId],
      );
      const proposal = proposalResult.rows[0];
      if (
        proposal === undefined ||
        proposal.status !== "SUBMITTED" ||
        proposal.control_claim_token !== claimToken ||
        proposal.expected_run_id === null ||
        proposal.expected_descriptor_hash === null ||
        owned.status !== "ACTIVE" ||
        owned.activeRevisionId !== proposal.expected_revision_id ||
        owned.latestRevisionNumber !== Number(proposal.expected_revision_number)
      ) {
        throw revisionConflict();
      }
      await assertMutationClaim(
        client,
        owned.analysisId,
        "PROPOSAL",
        proposalId,
        claimToken,
      );
      const session = await findSessionForUpdate(client, owned.analysisId);
      const currentRevision = await findRevisionForUpdate(
        client,
        owned.analysisId,
        proposal.expected_revision_id,
      );
      const currentRun = await findLatestRunForUpdate(
        client,
        owned.analysisId,
        proposal.expected_revision_id,
      );
      if (
        currentRevision.revisionNumber !==
          Number(proposal.expected_revision_number) ||
        currentRun.runId !== proposal.expected_run_id
      ) {
        throw revisionConflict();
      }
      const { descriptor, trustedSchema } = await loadBoundDescriptor(
        client,
        this.trustedPublicEditSchemas,
        {
          analysisId: owned.analysisId,
          revisionId: proposal.expected_revision_id,
          runId: proposal.expected_run_id,
          nodeId: proposal.target_node_id,
          descriptorHash: proposal.expected_descriptor_hash,
          publicArgsHash: proposal.public_args_hash,
          editSchemaHash: proposal.edit_schema_hash,
        },
      );
      return {
        session,
        currentRevision,
        currentRun,
        descriptor,
        validatePublicArgs: (value: Readonly<Record<string, unknown>>) =>
          isSafePublicArgs(value) && trustedSchema.validate(value),
      };
    });
  }

  async claimProposal(input: {
    readonly scope: AnalysisRequestScope;
    readonly proposal: AnalysisChangeProposal;
    readonly requestHash: string;
  }): Promise<CommandClaim<unknown>> {
    const proposal = analysisChangeProposalSchema.parse(input.proposal);
    try {
      assertAnalysisPublicPatchNonDisclosure(proposal.patch);
    } catch {
      throw new AnalysisServiceError(
        422,
        ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
        ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
      );
    }
    return this.transaction(async (client) => {
      const claimToken = randomUUID();
      const owned = await lockRequestScope(client, input.scope);
      if (owned === undefined) throw analysisNotFound();
      const existing = await client.query<ProposalRow>(
        `
          SELECT *
          FROM chat_service.analysis_change_proposal
          WHERE analysis_id = $1
            AND (
              idempotency_key = $2
              OR command_id = $3
              OR proposal_id = $4
            )
          FOR UPDATE
        `,
        [
          owned.analysisId,
          proposal.idempotencyKey,
          proposal.commandId,
          proposal.proposalId,
        ],
      );
      if (existing.rows.length > 0) {
        if (existing.rows.length !== 1) {
          return { disposition: "IDEMPOTENCY_CONFLICT" };
        }
        const prior = existing.rows[0] as ProposalRow;
        if (
          prior.idempotency_key !== proposal.idempotencyKey ||
          prior.command_id !== proposal.commandId ||
          prior.proposal_id !== proposal.proposalId ||
          prior.request_hash !== input.requestHash
        ) {
          return { disposition: "IDEMPOTENCY_CONFLICT" };
        }
        if (
          new Set(["APPLIED", "COMPILED"]).has(prior.status) &&
          prior.applied_revision_id !== null
        ) {
          return {
            disposition: "REPLAY",
            result: proposalResult(prior),
          };
        }
        if (
          new Set(["REJECTED", "CONFLICT", "COMPILE_FAILED"]).has(
            prior.status,
          ) &&
          prior.safe_error_code !== null &&
          prior.safe_error_status !== null
        ) {
          return {
            disposition: "FAILED_REPLAY",
            safeCode: prior.safe_error_code,
            statusCode: analysisErrorStatus(prior.safe_error_status),
          };
        }
        if (
          prior.status === "SUBMITTED" &&
          prior.control_claim_token !== null &&
          prior.control_claimed_at !== null &&
          (await refreshMutationClaim(client, {
            analysisId: owned.analysisId,
            kind: "PROPOSAL",
            claimId: proposal.proposalId,
            previousToken: prior.control_claim_token,
            nextToken: claimToken,
          }))
        ) {
          const reclaimed = await client.query(
            `
              UPDATE chat_service.analysis_change_proposal
              SET control_claimed_at = clock_timestamp(),
                  control_claim_token = $4
              WHERE analysis_id = $1 AND proposal_id = $2
                AND request_hash = $3 AND status = 'SUBMITTED'
                AND control_claim_token = $5
            `,
            [
              owned.analysisId,
              proposal.proposalId,
              input.requestHash,
              claimToken,
              prior.control_claim_token,
            ],
          );
          if (reclaimed.rowCount === 1) {
            return { disposition: "CLAIMED", claimToken };
          }
          throw new PersistenceConflictError(
            "Analysis proposal claim fencing conflict",
          );
        }
        return { disposition: "PENDING_CONFLICT" };
      }
      const pendingProposal = await client.query(
        `
          SELECT 1 FROM chat_service.analysis_change_proposal
          WHERE analysis_id = $1
            AND status IN ('SUBMITTED', 'VALIDATING', 'ACCEPTED', 'COMPILING')
          FOR UPDATE
        `,
        [owned.analysisId],
      );
      if (pendingProposal.rows[0] !== undefined) {
        return { disposition: "PENDING_CONFLICT" };
      }
      await assertRevisionCas(client, owned, {
        revisionId: proposal.expectedRevisionId,
        revisionNumber: proposal.expectedRevisionNumber,
      });
      const expectedRun = await findLatestRunForUpdate(
        client,
        owned.analysisId,
        proposal.expectedRevisionId,
      );
      const descriptorResult = await client.query<DescriptorRow>(
        `
          SELECT descriptor_json, descriptor_hash
          FROM chat_service.analysis_tool_interaction_descriptor
          WHERE analysis_id = $1 AND revision_id = $2 AND run_id = $3
            AND node_id = $4
          FOR UPDATE
        `,
        [
          owned.analysisId,
          proposal.expectedRevisionId,
          expectedRun.runId,
          proposal.targetNodeId,
        ],
      );
      const expectedDescriptor = descriptorResult.rows[0];
      if (expectedDescriptor === undefined) throw revisionConflict();
      if (
        !(await acquireMutationClaim(client, {
          analysisId: owned.analysisId,
          kind: "PROPOSAL",
          claimId: proposal.proposalId,
          claimToken,
        }))
      ) {
        return { disposition: "PENDING_CONFLICT" };
      }
      const inserted = await client.query(
        `
            INSERT INTO chat_service.analysis_change_proposal(
              proposal_id, command_id, analysis_id, expected_revision_id,
              expected_revision_number, expected_run_id,
              expected_descriptor_hash, target_node_id, public_args_hash,
              edit_schema_hash, patch_json, mode, idempotency_key, request_hash,
              status, created_at, control_claim_token, control_claimed_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12,
              $13, $14, 'SUBMITTED', $15::timestamptz, $16, clock_timestamp()
            )
            ON CONFLICT DO NOTHING
            RETURNING 1
          `,
        [
          proposal.proposalId,
          proposal.commandId,
          owned.analysisId,
          proposal.expectedRevisionId,
          proposal.expectedRevisionNumber,
          expectedRun.runId,
          expectedDescriptor.descriptor_hash,
          proposal.targetNodeId,
          proposal.publicArgsHash,
          proposal.editSchemaHash,
          JSON.stringify(proposal.patch),
          proposal.mode,
          proposal.idempotencyKey,
          input.requestHash,
          proposal.createdAt,
          claimToken,
        ],
      );
      if (inserted.rowCount !== 1) {
        await releaseMutationClaim(
          client,
          owned.analysisId,
          "PROPOSAL",
          proposal.proposalId,
          claimToken,
        );
        return { disposition: "PENDING_CONFLICT" };
      }
      return { disposition: "CLAIMED", claimToken };
    });
  }

  async commitCompiledRevision(input: {
    readonly scope: AnalysisRequestScope;
    readonly expectedRevisionId: string;
    readonly expectedRevisionNumber: number;
    readonly proposalId: string;
    readonly claimToken: string;
    readonly revision: AnalysisRevision;
    readonly patchedPublicArgs: Readonly<Record<string, unknown>>;
    readonly cancellation?: CancelTransition;
    readonly replacementRun?: AnalysisRun;
  }): Promise<unknown> {
    const revision = analysisRevisionSchema.parse(input.revision);
    const replacementRun =
      input.replacementRun === undefined
        ? undefined
        : analysisRunSchema.parse(input.replacementRun);
    if (!isSafePublicArgs(input.patchedPublicArgs)) {
      throw new AnalysisServiceError(
        422,
        "PUBLIC_ARGS_SCHEMA_INVALID",
        "Public arguments are invalid.",
      );
    }
    return this.transaction(async (client) => {
      const owned = await lockRequestScope(client, input.scope);
      if (owned === undefined) throw analysisNotFound();
      await assertRevisionCas(client, owned, {
        revisionId: input.expectedRevisionId,
        revisionNumber: input.expectedRevisionNumber,
      });
      if (
        revision.analysisId !== owned.analysisId ||
        revision.parentRevisionId !== input.expectedRevisionId ||
        revision.revisionNumber !== input.expectedRevisionNumber + 1
      ) {
        throw revisionConflict();
      }
      const proposalResultRow = await client.query<ProposalRow>(
        `
          SELECT * FROM chat_service.analysis_change_proposal
          WHERE analysis_id = $1 AND proposal_id = $2
          FOR UPDATE
        `,
        [owned.analysisId, input.proposalId],
      );
      const proposal = proposalResultRow.rows[0];
      if (
        proposal === undefined ||
        proposal.status !== "SUBMITTED" ||
        proposal.control_claim_token !== input.claimToken ||
        proposal.expected_revision_id !== input.expectedRevisionId ||
        Number(proposal.expected_revision_number) !==
          input.expectedRevisionNumber ||
        proposal.expected_run_id === null ||
        proposal.expected_descriptor_hash === null ||
        revision.parentRunId !== proposal.expected_run_id
      ) {
        throw revisionConflict();
      }
      await assertMutationClaim(
        client,
        owned.analysisId,
        "PROPOSAL",
        input.proposalId,
        input.claimToken,
      );
      const boundRun = await findLatestRunForUpdate(
        client,
        owned.analysisId,
        proposal.expected_revision_id,
      );
      if (boundRun.runId !== proposal.expected_run_id) {
        throw revisionConflict();
      }
      await loadBoundDescriptor(client, this.trustedPublicEditSchemas, {
        analysisId: owned.analysisId,
        revisionId: proposal.expected_revision_id,
        runId: proposal.expected_run_id,
        nodeId: proposal.target_node_id,
        descriptorHash: proposal.expected_descriptor_hash,
        publicArgsHash: proposal.public_args_hash,
        editSchemaHash: proposal.edit_schema_hash,
      });
      const queued = revision.status === "QUEUED";
      if (
        (input.cancellation !== undefined &&
          (input.cancellation.requested.runId !== proposal.expected_run_id ||
            input.cancellation.settled.runId !== proposal.expected_run_id)) ||
        (proposal.mode === "SUGGEST_NEXT_REVISION" &&
          (!queued ||
            input.cancellation !== undefined ||
            replacementRun !== undefined)) ||
        (proposal.mode === "INTERRUPT_AND_APPLY" &&
          (input.cancellation === undefined ||
            input.cancellation.queueRevision !== queued ||
            (queued && replacementRun !== undefined) ||
            (!queued &&
              (revision.status !== "READY" ||
                replacementRun === undefined ||
                input.cancellation.settled.status !== "CANCELLED" ||
                replacementRun.revisionId !== revision.revisionId ||
                replacementRun.parentRunId !==
                  input.cancellation.settled.runId ||
                replacementRun.attempt !== 1 ||
                replacementRun.status !== "STARTING"))))
      ) {
        throw revisionConflict();
      }

      try {
        await insertRevision(client, revision);
      } catch (error) {
        throw persistenceError(error, "Analysis revision identity conflict");
      }
      if (input.cancellation !== undefined) {
        await persistCancelTransition(
          client,
          owned.analysisId,
          input.cancellation,
        );
      }
      if (replacementRun !== undefined) {
        await insertRun(client, owned.analysisId, replacementRun);
        const superseded = await client.query(
          `
            UPDATE chat_service.analysis_revision
            SET status = 'SUPERSEDED'
            WHERE analysis_id = $1 AND revision_id = $2
              AND status IN ('RUNNING', 'READY')
          `,
          [owned.analysisId, input.expectedRevisionId],
        );
        if (superseded.rowCount !== 1) throw revisionConflict();
      }
      const updatedSessionResult = await client.query<SessionRow>(
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
              RETURNING *
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
              RETURNING *
            `,
        queued
          ? [
              owned.analysisId,
              owned.principalId,
              owned.threadId,
              revision.revisionNumber,
              revision.createdAt,
              input.expectedRevisionId,
              input.expectedRevisionNumber,
            ]
          : [
              owned.analysisId,
              owned.principalId,
              owned.threadId,
              revision.revisionId,
              revision.revisionNumber,
              revision.createdAt,
              input.expectedRevisionId,
              input.expectedRevisionNumber,
            ],
      );
      if (updatedSessionResult.rowCount !== 1) throw revisionConflict();
      const session = mapSession(updatedSessionResult.rows[0] as SessionRow);
      const applied = await client.query<ProposalRow>(
        `
          UPDATE chat_service.analysis_change_proposal
          SET status = 'APPLIED', applied_revision_id = $3
          WHERE analysis_id = $1
            AND proposal_id = $2
            AND status = 'SUBMITTED'
            AND control_claim_token = $4
          RETURNING *
        `,
        [
          owned.analysisId,
          input.proposalId,
          revision.revisionId,
          input.claimToken,
        ],
      );
      if (applied.rowCount !== 1) throw revisionConflict();
      const storedProposal = mapProposal(applied.rows[0] as ProposalRow);
      const projection = await mutateProjection(
        client,
        owned.analysisId,
        revision.createdAt,
        (state, activity) => {
          state.analysis.session = session;
          state.analysis.activeRevisionId = session.activeRevisionId;
          state.analysis.revisionsById[revision.revisionId] = revision;
          state.proposalsById[storedProposal.proposalId] = storedProposal;
          if (input.cancellation !== undefined) {
            state.analysis.runsById[input.cancellation.settled.runId] =
              input.cancellation.settled;
          }
          if (replacementRun !== undefined) {
            const prior =
              state.analysis.revisionsById[input.expectedRevisionId];
            if (prior !== undefined) {
              state.analysis.revisionsById[input.expectedRevisionId] = {
                ...prior,
                status: "SUPERSEDED",
              };
            }
            state.analysis.runsById[replacementRun.runId] = replacementRun;
            const priorPlan = objectField(activity, "plan");
            activity["plan"] = {
              ...priorPlan,
              planId: revision.wsgsPlanId,
              planHash: revision.planHash,
              planRevision: revision.revisionNumber,
            };
            activity["toolInteractionsByNodeId"] = {};
          }
        },
      );
      if (replacementRun !== undefined) {
        await upsertProjection(client, {
          ...projection,
          lastEventSequence: 0,
        });
      }
      await releaseMutationClaim(
        client,
        owned.analysisId,
        "PROPOSAL",
        input.proposalId,
        input.claimToken,
      );
      return {
        status: "COMPILED",
        proposalId: input.proposalId,
        revisionId: revision.revisionId,
        appliedRevisionId: revision.revisionId,
        ...(replacementRun === undefined
          ? {}
          : { replacementRunId: replacementRun.runId }),
      };
    });
  }

  async markProposalFailed(input: {
    readonly scope: AnalysisRequestScope;
    readonly proposalId: string;
    readonly claimToken: string;
    readonly safeCode: string;
    readonly statusCode: AnalysisServiceError["statusCode"];
  }): Promise<void> {
    assertSafeFailureIdentity(input.safeCode, input.statusCode);
    const status = proposalFailureStatus(input.safeCode);
    await this.transaction(async (client) => {
      const owned = await lockRequestScope(client, input.scope);
      if (owned === undefined) return;
      const failed = await client.query(
        `
          UPDATE chat_service.analysis_change_proposal
          SET status = $3, safe_error_code = $4, safe_error_status = $5
          WHERE analysis_id = $1
            AND proposal_id = $2
            AND control_claim_token = $6
            AND status IN ('SUBMITTED', 'VALIDATING', 'ACCEPTED', 'COMPILING')
          RETURNING 1
        `,
        [
          owned.analysisId,
          input.proposalId,
          status,
          input.safeCode,
          input.statusCode,
          input.claimToken,
        ],
      );
      if (failed.rowCount !== 1) return;
      await releaseMutationClaim(
        client,
        owned.analysisId,
        "PROPOSAL",
        input.proposalId,
        input.claimToken,
      );
    });
  }

  async loadCancelContext(
    request: AnalysisRequestScope,
    commandId: string,
    claimToken: string,
  ) {
    return this.transaction(async (client) => {
      const owned = await lockRequestScope(client, request);
      if (owned === undefined) return undefined;
      const command = await requireClaimedCommand(
        client,
        owned.analysisId,
        "CANCEL",
        commandId,
        claimToken,
      );
      await assertMutationClaim(
        client,
        owned.analysisId,
        "CANCEL",
        commandId,
        claimToken,
      );
      if (
        command.intervention_id !== null ||
        owned.status !== "ACTIVE" ||
        owned.activeRevisionId !== command.expected_revision_id
      ) {
        throw revisionConflict();
      }
      const session = await findSessionForUpdate(client, owned.analysisId);
      const currentRevision = await findRevisionForUpdate(
        client,
        owned.analysisId,
        command.expected_revision_id,
      );
      const currentRun = await findLatestRunForUpdate(
        client,
        owned.analysisId,
        command.expected_revision_id,
      );
      if (
        currentRevision.revisionNumber !==
          Number(command.expected_revision_number) ||
        currentRun.runId !== command.expected_run_id
      ) {
        throw revisionConflict();
      }
      return { session, currentRevision, currentRun };
    });
  }

  async claimCancel(input: {
    readonly scope: AnalysisRequestScope;
    readonly command: AnalysisCancelCommand;
    readonly requestHash: string;
  }): Promise<CommandClaim<unknown>> {
    return this.claimControlCommand({
      scope: input.scope,
      commandKind: "CANCEL",
      commandId: input.command.commandId,
      idempotencyKey: input.command.idempotencyKey,
      requestHash: input.requestHash,
      expectedRevision: {
        revisionId: input.command.expectedRevisionId,
        revisionNumber: input.command.expectedRevisionNumber,
      },
      expectedRevisionMode: "ACTIVE",
    });
  }

  async commitCancellation(input: {
    readonly scope: AnalysisRequestScope;
    readonly commandId: string;
    readonly claimToken: string;
    readonly transition: CancelTransition;
  }): Promise<unknown> {
    return this.transaction(async (client) => {
      const owned = await lockRequestScope(client, input.scope);
      if (owned === undefined) throw analysisNotFound();
      if (owned.status !== "ACTIVE") throw revisionConflict();
      const command = await requireClaimedCommand(
        client,
        owned.analysisId,
        "CANCEL",
        input.commandId,
        input.claimToken,
      );
      await assertMutationClaim(
        client,
        owned.analysisId,
        "CANCEL",
        input.commandId,
        input.claimToken,
      );
      if (
        owned.activeRevisionId !== command.expected_revision_id ||
        input.transition.requested.revisionId !==
          command.expected_revision_id ||
        input.transition.settled.revisionId !== command.expected_revision_id ||
        input.transition.requested.runId !== command.expected_run_id ||
        input.transition.settled.runId !== command.expected_run_id
      ) {
        throw revisionConflict();
      }
      const currentRun = await client.query<{
        run_id: string;
        revision_number: number | string;
      }>(
        `
          SELECT run.run_id, revision.revision_number
          FROM chat_service.analysis_run run
          JOIN chat_service.analysis_revision revision
            ON revision.analysis_id = run.analysis_id
           AND revision.revision_id = run.revision_id
          WHERE run.analysis_id = $1 AND run.revision_id = $2
          ORDER BY run.attempt DESC
          LIMIT 1
          FOR UPDATE OF run, revision
        `,
        [owned.analysisId, owned.activeRevisionId],
      );
      if (
        currentRun.rows[0]?.run_id !== command.expected_run_id ||
        Number(currentRun.rows[0]?.revision_number) !==
          Number(command.expected_revision_number)
      ) {
        throw revisionConflict();
      }
      await persistCancelTransition(client, owned.analysisId, input.transition);
      const now =
        input.transition.settled.finishedAt ??
        input.transition.settled.startedAt;
      const cancelledSession =
        input.transition.settled.status === "CANCELLED"
          ? await cancelSession(client, owned.analysisId, now)
          : undefined;
      if (cancelledSession !== undefined) {
        await client.query(
          `
            UPDATE chat_service.analysis_intervention
            SET status = 'CANCELLED'
            WHERE analysis_id = $1 AND status = 'OPEN'
          `,
          [owned.analysisId],
        );
      }
      const projection = await mutateProjection(
        client,
        owned.analysisId,
        now,
        (state) => {
          state.analysis.runsById[input.transition.settled.runId] =
            input.transition.settled;
          if (cancelledSession !== undefined) {
            state.analysis.session = cancelledSession;
            delete state.pendingIntervention;
          }
        },
      );
      const result = {
        status: input.transition.settled.status,
        runId: input.transition.settled.runId,
        acknowledged: input.transition.settled.status === "CANCELLED",
        queueRevision: input.transition.queueRevision,
        stateRevision: projection.stateRevision,
      };
      await completeCommand(client, command, result, now);
      await releaseMutationClaim(
        client,
        owned.analysisId,
        "CANCEL",
        input.commandId,
        input.claimToken,
      );
      return result;
    });
  }

  async markCancelFailed(input: {
    readonly scope: AnalysisRequestScope;
    readonly commandId: string;
    readonly claimToken: string;
    readonly safeCode: string;
    readonly statusCode: AnalysisServiceError["statusCode"];
  }): Promise<void> {
    await this.markControlCommandFailed({
      ...input,
      commandKind: "CANCEL",
    });
  }

  async loadInterventionContext(
    request: AnalysisRequestScope & { readonly interventionId: string },
    commandId: string,
    claimToken: string,
  ) {
    return this.transaction(async (client) => {
      const owned = await lockRequestScope(client, request);
      if (owned === undefined) return undefined;
      const command = await requireClaimedCommand(
        client,
        owned.analysisId,
        "INTERVENTION_RESOLUTION",
        commandId,
        claimToken,
      );
      await assertMutationClaim(
        client,
        owned.analysisId,
        "INTERVENTION_RESOLUTION",
        commandId,
        claimToken,
      );
      if (
        command.intervention_id !== request.interventionId ||
        owned.status !== "ACTIVE" ||
        owned.activeRevisionId !== command.expected_revision_id
      ) {
        throw interventionLineageConflict();
      }
      const currentRevision = await findRevisionForUpdate(
        client,
        owned.analysisId,
        command.expected_revision_id,
      );
      const currentRun = await findLatestRunForUpdate(
        client,
        owned.analysisId,
        command.expected_revision_id,
      );
      if (
        currentRevision.revisionNumber !==
          Number(command.expected_revision_number) ||
        currentRun.runId !== command.expected_run_id
      ) {
        throw interventionLineageConflict();
      }
      const result = await client.query<InterventionRow>(
        `
          SELECT * FROM chat_service.analysis_intervention
          WHERE analysis_id = $1 AND intervention_id = $2
            AND revision_id = $3 AND run_id = $4 AND status = 'OPEN'
          FOR UPDATE
        `,
        [
          owned.analysisId,
          request.interventionId,
          command.expected_revision_id,
          command.expected_run_id,
        ],
      );
      const row = result.rows[0];
      if (row === undefined || currentRun.status !== "WAITING_INTERVENTION") {
        throw interventionLineageConflict();
      }
      const intervention = mapIntervention(row);
      const expiresAt = stringField(intervention.requestPayload, "expiresAt");
      return {
        intervention,
        currentRun,
        ...(expiresAt === undefined ? {} : { expiresAt }),
        validateResponse: (value: Readonly<Record<string, unknown>>) =>
          validateInterventionResponse(intervention, value),
      };
    });
  }

  async claimInterventionResolution(input: {
    readonly scope: AnalysisRequestScope & { readonly interventionId: string };
    readonly command: AnalysisInterventionResolutionCommand;
    readonly requestHash: string;
  }): Promise<CommandClaim<unknown>> {
    return this.claimControlCommand({
      scope: input.scope,
      commandKind: "INTERVENTION_RESOLUTION",
      commandId: input.command.commandId,
      idempotencyKey: input.command.idempotencyKey,
      requestHash: input.requestHash,
      interventionId: input.scope.interventionId,
    });
  }

  async commitInterventionResolution(input: {
    readonly scope: AnalysisRequestScope & { readonly interventionId: string };
    readonly commandId: string;
    readonly claimToken: string;
    readonly response: Readonly<Record<string, unknown>>;
    readonly responseHash: string;
    readonly resumedRun: AnalysisRun;
  }): Promise<unknown> {
    const resumedRun = analysisRunSchema.parse(input.resumedRun);
    try {
      assertAnalysisPublicArgsNonDisclosure(input.response);
    } catch {
      throw new AnalysisServiceError(
        422,
        ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
        ANALYSIS_PUBLIC_ARGS_NON_DISCLOSURE_VIOLATION,
      );
    }
    if (!isSafePublicArgs(input.response)) {
      throw new AnalysisServiceError(
        422,
        "INTERVENTION_RESPONSE_SCHEMA_INVALID",
        "Intervention response is invalid.",
      );
    }
    return this.transaction(async (client) => {
      const owned = await lockRequestScope(client, input.scope);
      if (owned === undefined) throw analysisNotFound();
      if (owned.status !== "ACTIVE") throw interventionNotFound();
      const command = await requireClaimedCommand(
        client,
        owned.analysisId,
        "INTERVENTION_RESOLUTION",
        input.commandId,
        input.claimToken,
      );
      await assertMutationClaim(
        client,
        owned.analysisId,
        "INTERVENTION_RESOLUTION",
        input.commandId,
        input.claimToken,
      );
      if (
        command.intervention_id !== input.scope.interventionId ||
        command.expected_revision_id !== owned.activeRevisionId ||
        command.expected_run_id !== resumedRun.parentRunId ||
        resumedRun.revisionId !== owned.activeRevisionId ||
        resumedRun.parentRunId === undefined
      ) {
        throw new PersistenceConflictError(
          "Intervention resumed run lineage mismatch",
        );
      }
      const currentRevision = await findRevisionForUpdate(
        client,
        owned.analysisId,
        command.expected_revision_id,
      );
      const parentRun = await findLatestRunForUpdate(
        client,
        owned.analysisId,
        command.expected_revision_id,
      );
      if (
        currentRevision.revisionNumber !==
          Number(command.expected_revision_number) ||
        parentRun.runId !== command.expected_run_id ||
        parentRun.status !== "WAITING_INTERVENTION" ||
        resumedRun.attempt !== parentRun.attempt + 1
      ) {
        throw new PersistenceConflictError(
          "Intervention parent run is not waiting",
        );
      }
      const interventionResult = await client.query<InterventionRow>(
        `
          UPDATE chat_service.analysis_intervention
          SET status = 'RESOLVED',
              response_payload_json = $3::jsonb,
              response_hash = $4,
              resolved_at = $5::timestamptz
          WHERE analysis_id = $1
            AND intervention_id = $2
            AND status = 'OPEN'
            AND revision_id = $6
            AND run_id = $7
          RETURNING *
        `,
        [
          owned.analysisId,
          input.scope.interventionId,
          JSON.stringify(input.response),
          input.responseHash,
          resumedRun.startedAt,
          owned.activeRevisionId,
          resumedRun.parentRunId,
        ],
      );
      const interventionRow = interventionResult.rows[0];
      if (interventionRow === undefined) {
        throw new AnalysisServiceError(
          409,
          "INTERVENTION_ALREADY_RESOLVED",
          "Analysis intervention is no longer open.",
        );
      }
      const intervention = mapIntervention(interventionRow);
      if (
        resumedRun.revisionId !== intervention.revisionId ||
        resumedRun.parentRunId !== intervention.runId
      ) {
        throw new PersistenceConflictError(
          "Intervention resumed run lineage mismatch",
        );
      }
      await insertRun(client, owned.analysisId, resumedRun);
      const mutatedProjection = await mutateProjection(
        client,
        owned.analysisId,
        resumedRun.startedAt,
        (state) => {
          state.analysis.runsById[resumedRun.runId] = resumedRun;
          delete state.pendingIntervention;
        },
      );
      const projection = await upsertProjection(client, {
        ...mutatedProjection,
        lastEventSequence: 0,
      });
      const result = {
        status: "RESOLVED",
        interventionId: intervention.interventionId,
        resumedRunId: resumedRun.runId,
        parentRunId: resumedRun.parentRunId,
        stateRevision: projection.stateRevision,
      };
      await completeCommand(client, command, result, resumedRun.startedAt);
      await releaseMutationClaim(
        client,
        owned.analysisId,
        "INTERVENTION_RESOLUTION",
        input.commandId,
        input.claimToken,
      );
      return result;
    });
  }

  async markInterventionResolutionFailed(input: {
    readonly scope: AnalysisRequestScope & { readonly interventionId: string };
    readonly commandId: string;
    readonly claimToken: string;
    readonly safeCode: string;
    readonly statusCode: AnalysisServiceError["statusCode"];
  }): Promise<void> {
    await this.markControlCommandFailed({
      ...input,
      commandKind: "INTERVENTION_RESOLUTION",
    });
  }

  async commitUpstreamEvent(input: {
    readonly scope: AnalysisScope;
    readonly decision: WsgsAnalysisEventDecision;
  }): Promise<AnalysisDevelopmentEventCommit> {
    return this.transaction(async (client) => {
      const owned = await lockInternalScope(client, input.scope);
      const mutationClaim = await client.query<{
        mutation_claim_token: string | null;
      }>(
        `
          SELECT mutation_claim_token
          FROM chat_service.analysis_session
          WHERE analysis_id = $1
        `,
        [owned.analysisId],
      );
      if (mutationClaim.rows[0]?.mutation_claim_token !== null) {
        throw new AnalysisMutationClaimPendingError();
      }
      const currentRevision = await findRevisionForUpdate(
        client,
        owned.analysisId,
        owned.activeRevisionId,
      );
      const currentRun = await findLatestRunForUpdate(
        client,
        owned.analysisId,
        currentRevision.revisionId,
      );
      const event = input.decision.event;
      const projection = await findProjectionForUpdate(
        client,
        owned.analysisId,
      );
      const planIdentity = projectionPlanIdentity(projection);
      if (event.upstreamAnalysisId !== planIdentity.upstreamAnalysisId) {
        throw new PersistenceConflictError(
          "Analysis upstream event lineage mismatch",
        );
      }
      const eventLineage = await findEventLineageForUpdate(
        client,
        owned.analysisId,
        event,
      );
      const currentLineage =
        eventLineage.revision.revisionId === currentRevision.revisionId &&
        eventLineage.run.runId === currentRun.runId;
      const auditOnly =
        owned.status !== "ACTIVE" ||
        new Set<AnalysisRun["status"]>([
          "CANCEL_REQUESTED",
          "CANCELLED",
          "SUCCEEDED",
          "PARTIAL",
          "FAILED",
        ]).has(currentRun.status) ||
        input.decision.disposition !== "APPLY_TO_ACTIVE_PLAN" ||
        !currentLineage;
      const disposition = auditOnly
        ? "AUDIT_ONLY_INACTIVE_PLAN"
        : "APPLY_TO_ACTIVE_PLAN";
      const existing = await client.query<EventIdentityRow>(
        `
          SELECT event_id, revision_id, run_id, analysis_sequence,
                 run_sequence, upstream_sequence, event_type, node_id,
                 correlation_id, causation_id, occurred_at, payload_json,
                 payload_hash
          FROM chat_service.analysis_event
          WHERE analysis_id = $1
            AND (event_id = $2 OR (run_id = $3 AND upstream_sequence = $4))
          FOR UPDATE
        `,
        [
          owned.analysisId,
          event.eventId,
          eventLineage.run.runId,
          event.sequence,
        ],
      );
      if (existing.rows[0] !== undefined) {
        const row = existing.rows[0];
        if (
          existing.rows.length !== 1 ||
          row.event_id !== event.eventId ||
          row.revision_id !== eventLineage.revision.revisionId ||
          row.run_id !== eventLineage.run.runId ||
          !isPositiveSafeInteger(row.analysis_sequence) ||
          !isPositiveSafeInteger(row.run_sequence) ||
          Number(row.upstream_sequence) !== event.sequence ||
          row.event_type !== `wsgs.${event.eventType}` ||
          row.node_id !== (event.nodeId ?? null) ||
          row.correlation_id !== event.correlationId ||
          row.causation_id !== (event.causationId ?? null) ||
          iso(row.occurred_at) !== iso(event.occurredAt) ||
          canonicalJson(row.payload_json) !== canonicalJson(event.payload) ||
          row.payload_hash !== event.payloadHash
        ) {
          throw new PersistenceConflictError(
            "Analysis upstream event identity collision",
          );
        }
        return {
          created: false,
          disposition: "IDEMPOTENT_DUPLICATE",
          projection,
          snapshot: agUiSharedStateV03Schema.parse(projection.state),
        };
      }
      const nextSequenceResult = await client.query<SequenceRow>(
        `
          SELECT
            COALESCE(max(analysis_sequence), 0) AS analysis_sequence,
            COALESCE(max(run_sequence) FILTER (WHERE run_id = $2), 0)
              AS run_sequence
          FROM chat_service.analysis_event
          WHERE analysis_id = $1
        `,
        [owned.analysisId, eventLineage.run.runId],
      );
      const sequence = nextSequenceResult.rows[0] as SequenceRow;
      const analysisSequence = Number(sequence.analysis_sequence) + 1;
      const runSequence = Number(sequence.run_sequence) + 1;
      const reduced = currentLineage
        ? await reduceUpstreamEvent(client, {
            owned,
            revision: eventLineage.revision,
            run: eventLineage.run,
            projection,
            event,
            disposition,
          })
        : projection;
      await client.query(
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
        `,
        [
          event.eventId,
          owned.analysisId,
          eventLineage.revision.revisionId,
          eventLineage.run.runId,
          analysisSequence,
          runSequence,
          event.sequence,
          `wsgs.${event.eventType}`,
          event.nodeId ?? null,
          event.correlationId,
          event.causationId ?? null,
          event.occurredAt,
          JSON.stringify(event.payload),
          event.payloadHash,
        ],
      );
      const stored = currentLineage
        ? await upsertProjection(client, {
            ...reduced,
            lastEventSequence: event.sequence,
          })
        : projection;
      return {
        created: true,
        disposition,
        projection: stored,
        snapshot: agUiSharedStateV03Schema.parse(stored.state),
      };
    });
  }

  private async claimControlCommand(input: {
    readonly scope: AnalysisRequestScope;
    readonly commandKind: CommandKind;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly expectedRevision?: {
      readonly revisionId: string;
      readonly revisionNumber: number;
    };
    readonly expectedRevisionMode?: "LATEST_ACTIVE" | "ACTIVE";
    readonly interventionId?: string;
  }): Promise<CommandClaim<unknown>> {
    return this.transaction(async (client) => {
      const claimToken = randomUUID();
      const owned = await lockRequestScope(client, input.scope);
      if (owned === undefined) throw analysisNotFound();
      const existing = await client.query<CommandRow>(
        `
          SELECT * FROM chat_service.analysis_control_command
          WHERE analysis_id = $1
            AND command_kind = $2
            AND (command_id = $3 OR idempotency_key = $4)
          FOR UPDATE
        `,
        [
          owned.analysisId,
          input.commandKind,
          input.commandId,
          input.idempotencyKey,
        ],
      );
      if (existing.rows.length > 0) {
        if (existing.rows.length !== 1) {
          return { disposition: "IDEMPOTENCY_CONFLICT" };
        }
        const prior = existing.rows[0] as CommandRow;
        if (
          prior.command_id !== input.commandId ||
          prior.idempotency_key !== input.idempotencyKey ||
          prior.request_hash !== input.requestHash
        ) {
          return { disposition: "IDEMPOTENCY_CONFLICT" };
        }
        if (prior.status === "COMPLETED" && prior.result_json !== null) {
          return {
            disposition: "REPLAY",
            result: jsonObject(prior.result_json, "analysis command result"),
          };
        }
        if (
          prior.status === "FAILED" &&
          prior.safe_error_code !== null &&
          prior.safe_error_status !== null
        ) {
          return {
            disposition: "FAILED_REPLAY",
            safeCode: prior.safe_error_code,
            statusCode: analysisErrorStatus(prior.safe_error_status),
          };
        }
        if (
          prior.status === "CLAIMED" &&
          (await refreshMutationClaim(client, {
            analysisId: owned.analysisId,
            kind: input.commandKind,
            claimId: input.commandId,
            previousToken: prior.claim_token,
            nextToken: claimToken,
          }))
        ) {
          const reclaimed = await client.query(
            `
              UPDATE chat_service.analysis_control_command
              SET claim_token = $5, updated_at = clock_timestamp()
              WHERE analysis_id = $1 AND command_kind = $2
                AND command_id = $3 AND request_hash = $4
                AND status = 'CLAIMED'
                AND claim_token = $6
            `,
            [
              owned.analysisId,
              input.commandKind,
              input.commandId,
              input.requestHash,
              claimToken,
              prior.claim_token,
            ],
          );
          if (reclaimed.rowCount === 1) {
            return { disposition: "CLAIMED", claimToken };
          }
          throw new PersistenceConflictError(
            "Analysis command claim fencing conflict",
          );
        }
        return { disposition: "PENDING_CONFLICT" };
      }
      const competingClaim = await client.query(
        input.commandKind === "CANCEL"
          ? `
              SELECT 1 FROM chat_service.analysis_control_command
              WHERE analysis_id = $1 AND command_kind = 'CANCEL'
                AND status = 'CLAIMED'
              FOR UPDATE
            `
          : `
              SELECT 1 FROM chat_service.analysis_control_command
              WHERE analysis_id = $1
                AND command_kind = 'INTERVENTION_RESOLUTION'
                AND intervention_id = $2 AND status = 'CLAIMED'
              FOR UPDATE
            `,
        input.commandKind === "CANCEL"
          ? [owned.analysisId]
          : [owned.analysisId, input.interventionId],
      );
      if (competingClaim.rows[0] !== undefined) {
        return { disposition: "PENDING_CONFLICT" };
      }
      if (input.expectedRevision !== undefined) {
        await assertRevisionCas(
          client,
          owned,
          input.expectedRevision,
          input.expectedRevisionMode ?? "LATEST_ACTIVE",
        );
      }
      if (owned.status !== "ACTIVE") {
        throw input.interventionId === undefined
          ? revisionConflict()
          : interventionNotFound();
      }
      const activeRevision = await client.query<{
        revision_number: number | string;
      }>(
        `
          SELECT revision_number FROM chat_service.analysis_revision
          WHERE analysis_id = $1 AND revision_id = $2
          FOR UPDATE
        `,
        [owned.analysisId, owned.activeRevisionId],
      );
      const activeRevisionNumber = Number(
        activeRevision.rows[0]?.revision_number,
      );
      if (!Number.isSafeInteger(activeRevisionNumber)) throw revisionConflict();
      const activeRun = await client.query<{
        run_id: string;
        status: AnalysisRun["status"];
      }>(
        `
          SELECT run_id, status FROM chat_service.analysis_run
          WHERE analysis_id = $1 AND revision_id = $2
          ORDER BY attempt DESC
          LIMIT 1
          FOR UPDATE
        `,
        [owned.analysisId, owned.activeRevisionId],
      );
      const boundRun = activeRun.rows[0];
      if (boundRun === undefined) throw revisionConflict();
      if (input.interventionId !== undefined) {
        const intervention = await client.query<{
          revision_id: string;
          run_id: string;
        }>(
          `
            SELECT intervention.revision_id, intervention.run_id
            FROM chat_service.analysis_intervention intervention
            JOIN chat_service.analysis_run run
              ON run.analysis_id = intervention.analysis_id
             AND run.revision_id = intervention.revision_id
             AND run.run_id = intervention.run_id
            WHERE intervention.analysis_id = $1
              AND intervention.intervention_id = $2
              AND intervention.status = 'OPEN'
              AND intervention.revision_id = $3
              AND run.status = 'WAITING_INTERVENTION'
          `,
          [owned.analysisId, input.interventionId, owned.activeRevisionId],
        );
        if (
          intervention.rows[0] === undefined ||
          intervention.rows[0].revision_id !== owned.activeRevisionId ||
          intervention.rows[0].run_id !== boundRun.run_id ||
          boundRun.status !== "WAITING_INTERVENTION"
        ) {
          throw interventionNotFound();
        }
      } else if (
        !new Set(["STARTING", "RUNNING", "WAITING_INTERVENTION"]).has(
          boundRun.status,
        )
      ) {
        throw revisionConflict();
      }
      if (
        !(await acquireMutationClaim(client, {
          analysisId: owned.analysisId,
          kind: input.commandKind,
          claimId: input.commandId,
          claimToken,
        }))
      ) {
        return { disposition: "PENDING_CONFLICT" };
      }
      const inserted = await client.query(
        `
            INSERT INTO chat_service.analysis_control_command(
              analysis_id, command_kind, command_id, idempotency_key,
              request_hash, claim_token, expected_revision_id,
              expected_revision_number, expected_run_id, intervention_id,
              status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              'CLAIMED', clock_timestamp(), clock_timestamp())
            ON CONFLICT DO NOTHING
            RETURNING 1
          `,
        [
          owned.analysisId,
          input.commandKind,
          input.commandId,
          input.idempotencyKey,
          input.requestHash,
          claimToken,
          owned.activeRevisionId,
          activeRevisionNumber,
          boundRun.run_id,
          input.interventionId ?? null,
        ],
      );
      if (inserted.rowCount !== 1) {
        await releaseMutationClaim(
          client,
          owned.analysisId,
          input.commandKind,
          input.commandId,
          claimToken,
        );
        return { disposition: "PENDING_CONFLICT" };
      }
      return { disposition: "CLAIMED", claimToken };
    });
  }

  private async markControlCommandFailed(input: {
    readonly scope: AnalysisRequestScope;
    readonly commandKind: CommandKind;
    readonly commandId: string;
    readonly claimToken: string;
    readonly safeCode: string;
    readonly statusCode: AnalysisServiceError["statusCode"];
  }): Promise<void> {
    assertSafeFailureIdentity(input.safeCode, input.statusCode);
    await this.transaction(async (client) => {
      const owned = await lockRequestScope(client, input.scope);
      if (owned === undefined) return;
      const failed = await client.query(
        `
          UPDATE chat_service.analysis_control_command
          SET status = 'FAILED', safe_error_code = $4,
              safe_error_status = $5, updated_at = clock_timestamp()
          WHERE analysis_id = $1 AND command_kind = $2 AND command_id = $3
            AND claim_token = $6 AND status = 'CLAIMED'
          RETURNING 1
        `,
        [
          owned.analysisId,
          input.commandKind,
          input.commandId,
          input.safeCode,
          input.statusCode,
          input.claimToken,
        ],
      );
      if (failed.rowCount !== 1) return;
      await releaseMutationClaim(
        client,
        owned.analysisId,
        input.commandKind,
        input.commandId,
        input.claimToken,
      );
    });
  }

  private async findRevision(
    scope: AnalysisScope,
    revisionId: string,
  ): Promise<AnalysisRevision | undefined> {
    const result = await this.pool.query<RevisionRow>(
      `
        SELECT revision.*
        FROM chat_service.analysis_revision revision
        JOIN chat_service.analysis_session session
          ON session.analysis_id = revision.analysis_id
        WHERE revision.analysis_id = $1
          AND revision.revision_id = $2
          AND session.principal_id = $3
          AND session.thread_id = $4
      `,
      [scope.analysisId, revisionId, scope.principalId, scope.threadId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapRevision(result.rows[0]);
  }

  private async findCurrentRun(
    scope: AnalysisScope,
    revisionId: string,
  ): Promise<AnalysisRun | undefined> {
    const result = await this.pool.query<RunRow>(
      `
        SELECT run.*
        FROM chat_service.analysis_run run
        JOIN chat_service.analysis_session session
          ON session.analysis_id = run.analysis_id
        WHERE run.analysis_id = $1
          AND run.revision_id = $2
          AND session.principal_id = $3
          AND session.thread_id = $4
        ORDER BY run.attempt DESC
        LIMIT 1
      `,
      [scope.analysisId, revisionId, scope.principalId, scope.threadId],
    );
    return result.rows[0] === undefined ? undefined : mapRun(result.rows[0]);
  }

  private async findOpenIntervention(
    scope: AnalysisScope,
  ): Promise<AnalysisIntervention | undefined> {
    const result = await this.pool.query<InterventionRow>(
      `
        SELECT intervention.*
        FROM chat_service.analysis_intervention intervention
        JOIN chat_service.analysis_session session
          ON session.analysis_id = intervention.analysis_id
        WHERE intervention.analysis_id = $1
          AND intervention.status = 'OPEN'
          AND session.principal_id = $2
          AND session.thread_id = $3
        ORDER BY intervention.created_at DESC
        LIMIT 1
      `,
      [scope.analysisId, scope.principalId, scope.threadId],
    );
    return result.rows[0] === undefined
      ? undefined
      : mapIntervention(result.rows[0]);
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

interface OwnedSessionRow {
  analysis_id: string;
  principal_id: string;
  thread_id: string;
  grounding_id: string;
}

interface ResolvedScopeRow {
  analysis_id: string;
  principal_id: string;
  thread_id: string;
}

interface LockedScope extends AnalysisScope {
  readonly activeRevisionId: string;
  readonly latestRevisionNumber: number;
  readonly status: AnalysisSession["status"];
}

interface SessionRow {
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
  created_at: Date | string;
  updated_at: Date | string;
}

interface RevisionRow {
  revision_id: string;
  analysis_id: string;
  revision_number: number | string;
  parent_revision_id: string | null;
  parent_run_id: string | null;
  cause: AnalysisRevision["cause"];
  wsgs_plan_id: string;
  plan_hash: string;
  changed_paths_json: unknown;
  reused_node_ids_json: unknown;
  invalidated_node_ids_json: unknown;
  rerun_node_ids_json: unknown;
  status: AnalysisRevision["status"];
  created_at: Date | string;
}

interface RunRow {
  run_id: string;
  revision_id: string;
  attempt: number | string;
  parent_run_id: string | null;
  upstream_run_id: string | null;
  status: AnalysisRun["status"];
  started_at: Date | string;
  finished_at: Date | string | null;
}

interface ProjectionRow {
  analysis_id: string;
  state_revision: number | string;
  activity_revision: number | string;
  state_json: unknown;
  state_hash: string;
  activity_json: unknown;
  activity_hash: string;
  last_event_sequence: number | string;
  updated_at: Date | string;
}

interface DescriptorRow {
  descriptor_json: unknown;
  descriptor_hash: string;
}

interface DescriptorIdentityRow extends DescriptorRow {
  revision_id: string;
  run_id: string;
  tool_call_id: string;
  node_id: string;
}

interface ProposalRow {
  proposal_id: string;
  command_id: string;
  analysis_id: string;
  expected_revision_id: string;
  expected_revision_number: number | string;
  expected_run_id: string | null;
  expected_descriptor_hash: string | null;
  target_node_id: string;
  public_args_hash: string;
  edit_schema_hash: string;
  patch_json: unknown;
  mode: AnalysisChangeProposal["mode"];
  idempotency_key: string;
  request_hash: string;
  status: AnalysisChangeProposal["status"];
  created_at: Date | string;
  applied_revision_id: string | null;
  safe_error_code: string | null;
  safe_error_status: number | string | null;
  control_claimed_at: Date | string | null;
  control_claim_token: string | null;
}

interface InterventionRow {
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
  created_at: Date | string;
  resolved_at: Date | string | null;
}

interface CommandRow {
  analysis_id: string;
  command_kind: CommandKind;
  command_id: string;
  idempotency_key: string;
  request_hash: string;
  claim_token: string;
  expected_revision_id: string;
  expected_revision_number: number | string;
  expected_run_id: string;
  intervention_id: string | null;
  status: "CLAIMED" | "COMPLETED" | "FAILED";
  result_json: unknown | null;
  safe_error_code: string | null;
  safe_error_status: number | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EventIdentityRow {
  event_id: string;
  revision_id: string;
  run_id: string;
  analysis_sequence: number | string;
  run_sequence: number | string;
  upstream_sequence: number | string | null;
  event_type: string;
  node_id: string | null;
  correlation_id: string;
  causation_id: string | null;
  occurred_at: Date | string;
  payload_json: unknown;
  payload_hash: string;
}

interface SequenceRow {
  analysis_sequence: number | string;
  run_sequence: number | string;
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

async function insertRun(
  client: PoolClient,
  analysisId: string,
  run: AnalysisRun,
): Promise<void> {
  await client.query(
    `
      INSERT INTO chat_service.analysis_run(
        run_id, analysis_id, revision_id, attempt, parent_run_id,
        upstream_run_id, status, started_at, finished_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::timestamptz,
        $9::timestamptz
      )
    `,
    [
      run.runId,
      analysisId,
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

async function insertDescriptor(
  client: PoolClient,
  input: {
    readonly analysisId: string;
    readonly revisionId: string;
    readonly runId: string;
    readonly descriptor: ToolInteractionDescriptor;
    readonly createdAt: string;
  },
): Promise<void> {
  const descriptorHash = hashCanonicalJson(input.descriptor);
  const inserted = await client.query<DescriptorIdentityRow>(
    `
      INSERT INTO chat_service.analysis_tool_interaction_descriptor(
        analysis_id, revision_id, run_id, tool_call_id, node_id,
        descriptor_json, descriptor_hash, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz
      )
      ON CONFLICT DO NOTHING
      RETURNING revision_id, run_id, tool_call_id, node_id,
                descriptor_json, descriptor_hash
    `,
    [
      input.analysisId,
      input.revisionId,
      input.runId,
      input.descriptor.toolCallId,
      input.descriptor.nodeId,
      JSON.stringify(input.descriptor),
      descriptorHash,
      input.createdAt,
    ],
  );
  if (inserted.rowCount === 1) return;
  const existing = await client.query<DescriptorIdentityRow>(
    `
      SELECT revision_id, run_id, tool_call_id, node_id,
             descriptor_json, descriptor_hash
      FROM chat_service.analysis_tool_interaction_descriptor
      WHERE analysis_id = $1
        AND (
          tool_call_id = $2
          OR (revision_id = $3 AND node_id = $4)
        )
      FOR UPDATE
    `,
    [
      input.analysisId,
      input.descriptor.toolCallId,
      input.revisionId,
      input.descriptor.nodeId,
    ],
  );
  const replay = existing.rows[0];
  if (
    existing.rows.length !== 1 ||
    replay === undefined ||
    replay.revision_id !== input.revisionId ||
    replay.run_id !== input.runId ||
    replay.tool_call_id !== input.descriptor.toolCallId ||
    replay.node_id !== input.descriptor.nodeId ||
    replay.descriptor_hash !== descriptorHash ||
    canonicalJson(replay.descriptor_json) !== canonicalJson(input.descriptor)
  ) {
    throw new PersistenceConflictError(
      "Analysis tool interaction descriptor conflict",
    );
  }
}

async function insertIntervention(
  client: PoolClient,
  intervention: AnalysisIntervention,
): Promise<void> {
  const requestHash = hashCanonicalJson(intervention.requestPayload);
  const responseHash =
    intervention.responsePayload === undefined
      ? null
      : hashCanonicalJson(intervention.responsePayload);
  const inserted = await client.query<InterventionRow>(
    `
      INSERT INTO chat_service.analysis_intervention(
        intervention_id, analysis_id, revision_id, run_id, interrupt_id,
        reason, status, request_payload_json, request_hash,
        response_payload_json, response_hash, created_at, resolved_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9,
        $10::jsonb, $11, $12::timestamptz, $13::timestamptz
      )
      ON CONFLICT (analysis_id, interrupt_id) DO NOTHING
      RETURNING *
    `,
    [
      intervention.interventionId,
      intervention.analysisId,
      intervention.revisionId,
      intervention.runId,
      intervention.interruptId,
      intervention.reason,
      intervention.status,
      JSON.stringify(intervention.requestPayload),
      requestHash,
      intervention.responsePayload === undefined
        ? null
        : JSON.stringify(intervention.responsePayload),
      intervention.responsePayload === undefined ? null : responseHash,
      intervention.createdAt,
      intervention.resolvedAt ?? null,
    ],
  );
  if (inserted.rowCount === 1) return;
  const existing = await client.query<InterventionRow>(
    `
      SELECT * FROM chat_service.analysis_intervention
      WHERE analysis_id = $1
        AND (intervention_id = $2 OR interrupt_id = $3)
      FOR UPDATE
    `,
    [
      intervention.analysisId,
      intervention.interventionId,
      intervention.interruptId,
    ],
  );
  const replay = existing.rows[0];
  if (
    existing.rows.length !== 1 ||
    replay === undefined ||
    replay.intervention_id !== intervention.interventionId ||
    replay.revision_id !== intervention.revisionId ||
    replay.run_id !== intervention.runId ||
    replay.interrupt_id !== intervention.interruptId ||
    replay.reason !== intervention.reason ||
    replay.status !== intervention.status ||
    replay.request_hash !== requestHash ||
    canonicalJson(replay.request_payload_json) !==
      canonicalJson(intervention.requestPayload) ||
    replay.response_hash !== responseHash ||
    canonicalNullableJson(replay.response_payload_json) !==
      canonicalNullableJson(intervention.responsePayload) ||
    iso(replay.created_at) !== iso(intervention.createdAt) ||
    nullableIso(replay.resolved_at) !== nullableIso(intervention.resolvedAt)
  ) {
    throw new PersistenceConflictError(
      "Analysis intervention identity conflict",
    );
  }
}

async function upsertProjection(
  client: PoolClient,
  projectionValue: AnalysisProjection,
): Promise<AnalysisProjection> {
  const projection = analysisProjectionSchema.parse(projectionValue);
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
    hashCanonicalJson(projection.state) !== projection.stateHash ||
    hashCanonicalJson(projection.activity) !== projection.activityHash
  ) {
    throw new PersistenceConflictError("Analysis projection hash mismatch");
  }
  const result = await client.query<ProjectionRow>(
    `
      INSERT INTO chat_service.analysis_projection(
        analysis_id, state_revision, activity_revision, state_json,
        state_hash, activity_json, activity_hash, last_event_sequence,
        updated_at
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8,
        $9::timestamptz
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
  return mapProjection(result.rows[0] as ProjectionRow);
}

async function assertThreadScope(
  client: PoolClient,
  scope: AnalysisScope,
): Promise<void> {
  const result = await client.query(
    `
      SELECT 1 FROM chat_service.conversation_thread
      WHERE thread_id = $1 AND principal_id = $2
    `,
    [scope.threadId, scope.principalId],
  );
  if (result.rows[0] === undefined) {
    throw new PersistenceAuthorizationError(
      "Analysis principal and thread are not authorized",
    );
  }
}

async function lockRequestScope(
  client: PoolClient,
  request: AnalysisRequestScope,
): Promise<LockedScope | undefined> {
  const result = await client.query<{
    analysis_id: string;
    principal_id: string;
    thread_id: string;
    active_revision_id: string;
    latest_revision_number: number | string;
    status: AnalysisSession["status"];
  }>(
    `
      SELECT session.analysis_id, session.principal_id, session.thread_id,
             session.active_revision_id, session.latest_revision_number,
             session.status
      FROM chat_service.analysis_session session
      JOIN chat_service.principal principal
        ON principal.principal_id = session.principal_id
      JOIN chat_service.conversation_thread thread
        ON thread.thread_id = session.thread_id
       AND thread.principal_id = session.principal_id
      WHERE session.analysis_id = $1
        AND principal.issuer = 'openwebui-jwt'
        AND principal.subject = $2
        AND principal.role = $3
      FOR UPDATE OF session
    `,
    [request.analysisId, request.userId, request.userRole],
  );
  const row = result.rows[0];
  return row === undefined
    ? undefined
    : {
        analysisId: row.analysis_id,
        principalId: row.principal_id,
        threadId: row.thread_id,
        activeRevisionId: row.active_revision_id,
        latestRevisionNumber: Number(row.latest_revision_number),
        status: row.status,
      };
}

async function lockInternalScope(
  client: PoolClient,
  scope: AnalysisScope,
): Promise<LockedScope> {
  const result = await client.query<{
    active_revision_id: string;
    latest_revision_number: number | string;
    status: AnalysisSession["status"];
  }>(
    `
      SELECT active_revision_id, latest_revision_number, status
      FROM chat_service.analysis_session
      WHERE analysis_id = $1 AND principal_id = $2 AND thread_id = $3
      FOR UPDATE
    `,
    [scope.analysisId, scope.principalId, scope.threadId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new PersistenceAuthorizationError("Analysis scope is not authorized");
  }
  return {
    ...scope,
    activeRevisionId: row.active_revision_id,
    latestRevisionNumber: Number(row.latest_revision_number),
    status: row.status,
  };
}

async function assertRevisionCas(
  client: PoolClient,
  scope: LockedScope,
  expected: { readonly revisionId: string; readonly revisionNumber: number },
  mode: "LATEST_ACTIVE" | "ACTIVE" = "LATEST_ACTIVE",
): Promise<void> {
  const revision = await client.query<{ revision_number: number | string }>(
    `
      SELECT revision_number FROM chat_service.analysis_revision
      WHERE analysis_id = $1 AND revision_id = $2
    `,
    [scope.analysisId, scope.activeRevisionId],
  );
  if (
    scope.status !== "ACTIVE" ||
    scope.activeRevisionId !== expected.revisionId ||
    (mode === "LATEST_ACTIVE" &&
      scope.latestRevisionNumber !== expected.revisionNumber) ||
    Number(revision.rows[0]?.revision_number) !== expected.revisionNumber
  ) {
    throw revisionConflict();
  }
}

async function findRevisionForUpdate(
  client: PoolClient,
  analysisId: string,
  revisionId: string,
): Promise<AnalysisRevision> {
  const result = await client.query<RevisionRow>(
    `
      SELECT * FROM chat_service.analysis_revision
      WHERE analysis_id = $1 AND revision_id = $2
      FOR UPDATE
    `,
    [analysisId, revisionId],
  );
  if (result.rows[0] === undefined) {
    throw new PersistenceConflictError("Analysis revision is unavailable");
  }
  return mapRevision(result.rows[0]);
}

async function findSessionForUpdate(
  client: PoolClient,
  analysisId: string,
): Promise<AnalysisSession> {
  const result = await client.query<SessionRow>(
    `
      SELECT * FROM chat_service.analysis_session
      WHERE analysis_id = $1
      FOR UPDATE
    `,
    [analysisId],
  );
  if (result.rows[0] === undefined) {
    throw new PersistenceConflictError("Analysis session is unavailable");
  }
  return mapSession(result.rows[0]);
}

async function acquireMutationClaim(
  client: PoolClient,
  input: {
    readonly analysisId: string;
    readonly kind: MutationClaimKind;
    readonly claimId: string;
    readonly claimToken: string;
  },
): Promise<boolean> {
  const result = await client.query(
    `
      UPDATE chat_service.analysis_session
      SET mutation_claim_kind = $2, mutation_claim_id = $3,
          mutation_claim_token = $4, mutation_claimed_at = clock_timestamp()
      WHERE analysis_id = $1 AND mutation_claim_token IS NULL
    `,
    [input.analysisId, input.kind, input.claimId, input.claimToken],
  );
  return result.rowCount === 1;
}

async function refreshMutationClaim(
  client: PoolClient,
  input: {
    readonly analysisId: string;
    readonly kind: MutationClaimKind;
    readonly claimId: string;
    readonly previousToken: string;
    readonly nextToken: string;
  },
): Promise<boolean> {
  const result = await client.query(
    `
      UPDATE chat_service.analysis_session
      SET mutation_claim_token = $5, mutation_claimed_at = clock_timestamp()
      WHERE analysis_id = $1 AND mutation_claim_kind = $2
        AND mutation_claim_id = $3 AND mutation_claim_token = $4
        AND mutation_claimed_at <= clock_timestamp() - interval '5 minutes'
    `,
    [
      input.analysisId,
      input.kind,
      input.claimId,
      input.previousToken,
      input.nextToken,
    ],
  );
  return result.rowCount === 1;
}

async function assertMutationClaim(
  client: PoolClient,
  analysisId: string,
  kind: MutationClaimKind,
  claimId: string,
  claimToken: string,
): Promise<void> {
  const result = await client.query(
    `
      SELECT 1 FROM chat_service.analysis_session
      WHERE analysis_id = $1 AND mutation_claim_kind = $2
        AND mutation_claim_id = $3 AND mutation_claim_token = $4
      FOR UPDATE
    `,
    [analysisId, kind, claimId, claimToken],
  );
  if (result.rows[0] === undefined) {
    throw new PersistenceConflictError("Analysis mutation claim was lost");
  }
}

async function releaseMutationClaim(
  client: PoolClient,
  analysisId: string,
  kind: MutationClaimKind,
  claimId: string,
  claimToken: string,
): Promise<void> {
  const result = await client.query(
    `
      UPDATE chat_service.analysis_session
      SET mutation_claim_kind = NULL, mutation_claim_id = NULL,
          mutation_claim_token = NULL, mutation_claimed_at = NULL
      WHERE analysis_id = $1 AND mutation_claim_kind = $2
        AND mutation_claim_id = $3 AND mutation_claim_token = $4
    `,
    [analysisId, kind, claimId, claimToken],
  );
  if (result.rowCount !== 1) {
    throw new PersistenceConflictError(
      "Analysis mutation claim release failed",
    );
  }
}

async function findLatestRunForUpdate(
  client: PoolClient,
  analysisId: string,
  revisionId: string,
): Promise<AnalysisRun> {
  const result = await client.query<RunRow>(
    `
      SELECT * FROM chat_service.analysis_run
      WHERE analysis_id = $1 AND revision_id = $2
      ORDER BY attempt DESC
      LIMIT 1
      FOR UPDATE
    `,
    [analysisId, revisionId],
  );
  if (result.rows[0] === undefined) {
    throw new PersistenceConflictError("Analysis run is unavailable");
  }
  return mapRun(result.rows[0]);
}

async function findEventLineageForUpdate(
  client: PoolClient,
  analysisId: string,
  event: WsgsAnalysisEventEnvelope,
): Promise<{
  readonly revision: AnalysisRevision;
  readonly run: AnalysisRun;
}> {
  const revisionResult = await client.query<RevisionRow>(
    `
      SELECT * FROM chat_service.analysis_revision
      WHERE analysis_id = $1
        AND revision_number = $2
        AND wsgs_plan_id = $3
        AND plan_hash = $4
      FOR UPDATE
    `,
    [analysisId, event.planRevision, event.planId, event.planHash],
  );
  if (revisionResult.rows.length !== 1) {
    throw new PersistenceConflictError(
      "Analysis upstream event lineage is unavailable",
    );
  }
  const revision = mapRevision(revisionResult.rows[0] as RevisionRow);
  const runResult = await client.query<RunRow>(
    `
      SELECT * FROM chat_service.analysis_run
      WHERE analysis_id = $1
        AND revision_id = $2
        AND upstream_run_id = $3
      FOR UPDATE
    `,
    [analysisId, revision.revisionId, event.correlationId],
  );
  if (runResult.rows.length !== 1) {
    throw new PersistenceConflictError(
      "Analysis upstream event lineage is unavailable",
    );
  }
  return {
    revision,
    run: mapRun(runResult.rows[0] as RunRow),
  };
}

async function loadBoundDescriptor(
  client: PoolClient,
  trustedSchemas: ReadonlyMap<string, CompiledPublicEditSchema>,
  input: {
    readonly analysisId: string;
    readonly revisionId: string;
    readonly runId: string;
    readonly nodeId: string;
    readonly descriptorHash: string;
    readonly publicArgsHash: string;
    readonly editSchemaHash: string;
  },
): Promise<{
  readonly descriptor: ToolInteractionDescriptor;
  readonly trustedSchema: CompiledPublicEditSchema;
}> {
  const result = await client.query<DescriptorRow>(
    `
      SELECT descriptor_json, descriptor_hash
      FROM chat_service.analysis_tool_interaction_descriptor
      WHERE analysis_id = $1 AND revision_id = $2 AND run_id = $3
        AND node_id = $4
      FOR UPDATE
    `,
    [input.analysisId, input.revisionId, input.runId, input.nodeId],
  );
  const row = result.rows[0];
  if (row === undefined || row.descriptor_hash !== input.descriptorHash) {
    throw descriptorConflict();
  }
  const descriptor = toolInteractionDescriptorSchema.parse(
    jsonObject(row.descriptor_json, "tool interaction descriptor"),
  );
  if (
    hashCanonicalJson(descriptor) !== row.descriptor_hash ||
    descriptor.publicArgsHash !== input.publicArgsHash ||
    descriptor.publicEditSchemaHash !== input.editSchemaHash
  ) {
    throw descriptorConflict();
  }
  const trustedSchema = trustedSchemas.get(descriptor.publicEditSchemaUri);
  if (
    trustedSchema === undefined ||
    trustedSchema.hash !== descriptor.publicEditSchemaHash ||
    !trustedSchema.validate(descriptor.publicArgs)
  ) {
    throw descriptorConflict();
  }
  return { descriptor, trustedSchema };
}

async function findProjectionForUpdate(
  client: PoolClient,
  analysisId: string,
): Promise<AnalysisProjection> {
  const result = await client.query<ProjectionRow>(
    `
      SELECT * FROM chat_service.analysis_projection
      WHERE analysis_id = $1
      FOR UPDATE
    `,
    [analysisId],
  );
  if (result.rows[0] === undefined) {
    throw new PersistenceConflictError("Analysis projection is unavailable");
  }
  return mapProjection(result.rows[0]);
}

async function mutateProjection(
  client: PoolClient,
  analysisId: string,
  updatedAt: string,
  mutation: (
    state: AgUiSharedStateV03,
    activity: Record<string, unknown>,
  ) => void,
): Promise<AnalysisProjection> {
  const current = await findProjectionForUpdate(client, analysisId);
  const state = cloneState(current.state);
  const activity = cloneObject(current.activity);
  mutation(state, activity);
  state.meta.stateRevision = current.stateRevision + 1;
  state.meta.snapshotHash = calculateAgUiStateSnapshotHash(state);
  const parsed = agUiSharedStateV03Schema.parse(state);
  const activityChanged =
    canonicalJson(activity) !== canonicalJson(current.activity);
  return upsertProjection(client, {
    ...current,
    stateRevision: current.stateRevision + 1,
    state: parsed,
    stateHash: hashCanonicalJson(parsed),
    activityRevision: current.activityRevision + (activityChanged ? 1 : 0),
    activity,
    activityHash: activityChanged
      ? hashCanonicalJson(activity)
      : current.activityHash,
    updatedAt,
  });
}

async function reduceUpstreamEvent(
  client: PoolClient,
  input: {
    readonly owned: LockedScope;
    readonly revision: AnalysisRevision;
    readonly run: AnalysisRun;
    readonly projection: AnalysisProjection;
    readonly event: WsgsAnalysisEventEnvelope;
    readonly disposition: WsgsAnalysisEventDecision["disposition"];
  },
): Promise<AnalysisProjection> {
  if (input.disposition !== "APPLY_TO_ACTIVE_PLAN") {
    return { ...input.projection, updatedAt: input.event.occurredAt };
  }
  const state = cloneState(input.projection.state);
  const activity = cloneObject(input.projection.activity);
  let stateChanged = false;
  let activityChanged = false;
  const nodeId = input.event.nodeId;
  switch (input.event.eventType) {
    case "PLAN_PUBLISHED": {
      activity["plan"] = jsonObject(input.event.payload["plan"], "plan");
      activityChanged = true;
      break;
    }
    case "NODE_READY":
    case "NODE_STARTED": {
      if (nodeId === undefined) {
        throw new PersistenceConflictError("Analysis node event is unscoped");
      }
      state.analysis.nodesById[nodeId] = nodeState(
        nodeId,
        input.event.eventType === "NODE_READY" ? "READY" : "RUNNING",
        state.analysis.nodesById[nodeId],
      );
      stateChanged = true;
      break;
    }
    case "TOOL_INTERACTION_PUBLISHED": {
      const descriptor = toolInteractionDescriptorSchema.parse(
        input.event.payload["toolInteraction"],
      );
      if (nodeId === undefined || descriptor.nodeId !== nodeId) {
        throw new PersistenceConflictError(
          "Analysis tool interaction node mismatch",
        );
      }
      await insertDescriptor(client, {
        analysisId: input.owned.analysisId,
        revisionId: input.revision.revisionId,
        runId: input.run.runId,
        descriptor,
        createdAt: input.event.occurredAt,
      });
      const tools = objectField(activity, "toolInteractionsByNodeId");
      tools[nodeId] = descriptor;
      activity["toolInteractionsByNodeId"] = tools;
      activityChanged = true;
      break;
    }
    case "TOOL_COMPLETED":
    case "TOOL_FAILED": {
      if (nodeId === undefined) {
        throw new PersistenceConflictError("Analysis tool event is unscoped");
      }
      const upstreamStatus = input.event.payload["upstreamStatus"];
      const executionStatus =
        input.event.eventType === "TOOL_FAILED"
          ? "FAILED"
          : upstreamStatus === "NO_DATA"
            ? "PARTIAL"
            : "SUCCEEDED";
      state.analysis.nodesById[nodeId] = nodeState(
        nodeId,
        executionStatus,
        state.analysis.nodesById[nodeId],
      );
      stateChanged = true;
      break;
    }
    case "FINDING_AVAILABLE": {
      const finding = jsonObject(input.event.payload["finding"], "finding");
      activity["latestFinding"] = finding;
      state.worldExplanation = {
        schemaVersion: "sacs-analysis-fixture-explanation/1.0",
        finding,
      };
      if (nodeId !== undefined && typeof finding["findingId"] === "string") {
        const current = nodeState(
          nodeId,
          "SUCCEEDED",
          state.analysis.nodesById[nodeId],
        );
        state.analysis.nodesById[nodeId] = {
          ...current,
          findingIds: [finding["findingId"]],
        };
      }
      stateChanged = true;
      activityChanged = true;
      break;
    }
    case "INTERVENTION_REQUIRED": {
      const intervention = analysisInterventionSchema.parse({
        schemaVersion: "sacs-analysis-intervention/1.0",
        interventionId: input.event.payload["interventionId"],
        analysisId: input.owned.analysisId,
        revisionId: input.revision.revisionId,
        runId: input.run.runId,
        interruptId: input.event.payload["interruptId"],
        reason: input.event.payload["reason"],
        status: "OPEN",
        requestPayload: input.event.payload["requestPayload"],
        createdAt: input.event.occurredAt,
      });
      await insertIntervention(client, intervention);
      await client.query(
        `
          UPDATE chat_service.analysis_run
          SET status = 'WAITING_INTERVENTION'
          WHERE analysis_id = $1 AND run_id = $2
        `,
        [input.owned.analysisId, input.run.runId],
      );
      state.analysis.runsById[input.run.runId] = {
        ...input.run,
        status: "WAITING_INTERVENTION",
      };
      state.pendingIntervention = intervention;
      stateChanged = true;
      break;
    }
    case "ANALYSIS_COMPLETED": {
      const upstreamStatus = input.event.payload["status"];
      if (upstreamStatus !== "SUCCEEDED" && upstreamStatus !== "PARTIAL") {
        throw new PersistenceConflictError(
          "Analysis completion status is invalid",
        );
      }
      const runStatus = upstreamStatus;
      const revisionStatus =
        upstreamStatus === "SUCCEEDED" ? "COMPLETED" : "PARTIAL";
      await client.query(
        `
          UPDATE chat_service.analysis_run
          SET status = $3, finished_at = $4::timestamptz
          WHERE analysis_id = $1 AND run_id = $2
        `,
        [
          input.owned.analysisId,
          input.run.runId,
          runStatus,
          input.event.occurredAt,
        ],
      );
      await client.query(
        `
          UPDATE chat_service.analysis_revision
          SET status = $3
          WHERE analysis_id = $1 AND revision_id = $2
        `,
        [input.owned.analysisId, input.revision.revisionId, revisionStatus],
      );
      const sessionResult = await client.query<SessionRow>(
        `
          UPDATE chat_service.analysis_session
          SET status = 'COMPLETED', updated_at = $2::timestamptz
          WHERE analysis_id = $1
          RETURNING *
        `,
        [input.owned.analysisId, input.event.occurredAt],
      );
      state.analysis.session = mapSession(sessionResult.rows[0] as SessionRow);
      state.analysis.revisionsById[input.revision.revisionId] = {
        ...input.revision,
        status: revisionStatus,
      };
      state.analysis.runsById[input.run.runId] = {
        ...input.run,
        status: runStatus,
        finishedAt: input.event.occurredAt,
      };
      activity["completion"] = input.event.payload;
      stateChanged = true;
      activityChanged = true;
      break;
    }
    default:
      break;
  }
  if (stateChanged) {
    state.meta.stateRevision = input.projection.stateRevision + 1;
    state.meta.snapshotHash = calculateAgUiStateSnapshotHash(state);
  }
  const parsedState = agUiSharedStateV03Schema.parse(state);
  return analysisProjectionSchema.parse({
    ...input.projection,
    stateRevision: input.projection.stateRevision + (stateChanged ? 1 : 0),
    activityRevision:
      input.projection.activityRevision + (activityChanged ? 1 : 0),
    state: parsedState,
    stateHash: stateChanged
      ? hashCanonicalJson(parsedState)
      : input.projection.stateHash,
    activity,
    activityHash: activityChanged
      ? hashCanonicalJson(activity)
      : input.projection.activityHash,
    updatedAt: input.event.occurredAt,
  });
}

async function persistCancelTransition(
  client: PoolClient,
  analysisId: string,
  transition: CancelTransition,
): Promise<void> {
  if (
    transition.requested.runId !== transition.settled.runId ||
    transition.requested.status !== "CANCEL_REQUESTED"
  ) {
    throw new PersistenceConflictError(
      "Analysis cancellation lineage mismatch",
    );
  }
  const result = await client.query(
    `
      UPDATE chat_service.analysis_run
      SET status = $3, finished_at = $4::timestamptz
      WHERE analysis_id = $1 AND run_id = $2
        AND status IN (
          'STARTING', 'RUNNING', 'WAITING_INTERVENTION', 'CANCEL_REQUESTED'
        )
    `,
    [
      analysisId,
      transition.settled.runId,
      transition.settled.status,
      transition.settled.finishedAt ?? null,
    ],
  );
  if (result.rowCount !== 1) {
    throw new PersistenceConflictError("Analysis cancellation state conflict");
  }
}

async function cancelSession(
  client: PoolClient,
  analysisId: string,
  updatedAt: string,
): Promise<AnalysisSession> {
  const result = await client.query<SessionRow>(
    `
      UPDATE chat_service.analysis_session
      SET status = 'CANCELLED', updated_at = $2::timestamptz
      WHERE analysis_id = $1 AND status = 'ACTIVE'
      RETURNING *
    `,
    [analysisId, updatedAt],
  );
  if (result.rows[0] === undefined) {
    throw new PersistenceConflictError("Analysis session cancel conflict");
  }
  return mapSession(result.rows[0]);
}

async function requireClaimedCommand(
  client: PoolClient,
  analysisId: string,
  commandKind: CommandKind,
  commandId: string,
  claimToken: string,
): Promise<CommandRow> {
  const result = await client.query<CommandRow>(
    `
      SELECT * FROM chat_service.analysis_control_command
      WHERE analysis_id = $1 AND command_kind = $2 AND command_id = $3
      FOR UPDATE
    `,
    [analysisId, commandKind, commandId],
  );
  const row = result.rows[0];
  if (
    row === undefined ||
    row.status !== "CLAIMED" ||
    row.claim_token !== claimToken
  ) {
    throw new PersistenceConflictError("Analysis command claim is unavailable");
  }
  return row;
}

async function completeCommand(
  client: PoolClient,
  command: CommandRow,
  result: Readonly<Record<string, unknown>>,
  updatedAt: string,
): Promise<void> {
  const updated = await client.query(
    `
      UPDATE chat_service.analysis_control_command
      SET status = 'COMPLETED', result_json = $5::jsonb,
          updated_at = $6::timestamptz
      WHERE analysis_id = $1 AND command_kind = $2
        AND command_id = $3 AND request_hash = $4 AND status = 'CLAIMED'
        AND claim_token = $7
    `,
    [
      command.analysis_id,
      command.command_kind,
      command.command_id,
      command.request_hash,
      JSON.stringify(result),
      updatedAt,
      command.claim_token,
    ],
  );
  if (updated.rowCount !== 1) {
    throw new PersistenceConflictError("Analysis command completion conflict");
  }
}

function assertSeedLineage(input: AnalysisDevelopmentSeed): void {
  if (
    input.session.analysisId !== input.scope.analysisId ||
    input.session.principalId !== input.scope.principalId ||
    input.session.threadId !== input.scope.threadId ||
    input.session.activeRevisionId !== input.revision.revisionId ||
    input.session.latestRevisionNumber !== input.revision.revisionNumber ||
    input.revision.analysisId !== input.session.analysisId ||
    input.run.revisionId !== input.revision.revisionId ||
    input.projection.analysisId !== input.session.analysisId ||
    input.descriptors.some(
      (descriptor) =>
        !input.revision.rerunNodeIds.includes(descriptor.nodeId) &&
        !input.revision.reusedNodeIds.includes(descriptor.nodeId),
    ) ||
    (input.intervention !== undefined &&
      (input.intervention.analysisId !== input.session.analysisId ||
        input.intervention.revisionId !== input.revision.revisionId ||
        input.intervention.runId !== input.run.runId))
  ) {
    throw new PersistenceConflictError(
      "Analysis development seed lineage mismatch",
    );
  }
}

function mapSession(row: SessionRow): AnalysisSession {
  return analysisSessionSchema.parse({
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
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapRevision(row: RevisionRow): AnalysisRevision {
  return analysisRevisionSchema.parse({
    schemaVersion: "sacs-analysis-revision/1.0",
    revisionId: row.revision_id,
    analysisId: row.analysis_id,
    revisionNumber: Number(row.revision_number),
    ...(row.parent_revision_id === null
      ? {}
      : { parentRevisionId: row.parent_revision_id }),
    ...(row.parent_run_id === null ? {} : { parentRunId: row.parent_run_id }),
    cause: row.cause,
    wsgsPlanId: row.wsgs_plan_id,
    planHash: row.plan_hash,
    changedPaths: stringArray(row.changed_paths_json, "changed paths"),
    reusedNodeIds: stringArray(row.reused_node_ids_json, "reused nodes"),
    invalidatedNodeIds: stringArray(
      row.invalidated_node_ids_json,
      "invalidated nodes",
    ),
    rerunNodeIds: stringArray(row.rerun_node_ids_json, "rerun nodes"),
    status: row.status,
    createdAt: iso(row.created_at),
  });
}

function mapRun(row: RunRow): AnalysisRun {
  return analysisRunSchema.parse({
    schemaVersion: "sacs-analysis-run/1.0",
    runId: row.run_id,
    revisionId: row.revision_id,
    attempt: Number(row.attempt),
    ...(row.parent_run_id === null ? {} : { parentRunId: row.parent_run_id }),
    ...(row.upstream_run_id === null
      ? {}
      : { upstreamRunId: row.upstream_run_id }),
    status: row.status,
    startedAt: iso(row.started_at),
    ...(row.finished_at === null ? {} : { finishedAt: iso(row.finished_at) }),
  });
}

function mapProjection(row: ProjectionRow): AnalysisProjection {
  const projection = analysisProjectionSchema.parse({
    schemaVersion: "sacs-analysis-projection/1.0",
    analysisId: row.analysis_id,
    stateRevision: Number(row.state_revision),
    activityRevision: Number(row.activity_revision),
    state: jsonObject(row.state_json, "analysis state"),
    stateHash: row.state_hash,
    activity: jsonObject(row.activity_json, "analysis activity"),
    activityHash: row.activity_hash,
    lastEventSequence: Number(row.last_event_sequence),
    updatedAt: iso(row.updated_at),
  });
  if (
    hashCanonicalJson(projection.state) !== projection.stateHash ||
    hashCanonicalJson(projection.activity) !== projection.activityHash
  ) {
    throw new PersistenceConflictError("Analysis projection hash mismatch");
  }
  return projection;
}

function mapProposal(row: ProposalRow): AnalysisChangeProposal {
  return analysisChangeProposalSchema.parse({
    schemaVersion: "sacs-analysis-change-proposal/1.0",
    commandId: row.command_id,
    proposalId: row.proposal_id,
    analysisId: row.analysis_id,
    expectedRevisionId: row.expected_revision_id,
    expectedRevisionNumber: Number(row.expected_revision_number),
    targetNodeId: row.target_node_id,
    publicArgsHash: row.public_args_hash,
    editSchemaHash: row.edit_schema_hash,
    patch: jsonArray(row.patch_json, "analysis proposal patch"),
    mode: row.mode,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    createdAt: iso(row.created_at),
    ...(row.applied_revision_id === null
      ? {}
      : { appliedRevisionId: row.applied_revision_id }),
  });
}

function mapIntervention(row: InterventionRow): AnalysisIntervention {
  const intervention = analysisInterventionSchema.parse({
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
    ...(row.response_payload_json === null
      ? {}
      : {
          responsePayload: jsonObject(
            row.response_payload_json,
            "intervention response",
          ),
        }),
    createdAt: iso(row.created_at),
    ...(row.resolved_at === null ? {} : { resolvedAt: iso(row.resolved_at) }),
  });
  if (
    hashCanonicalJson(intervention.requestPayload) !== row.request_hash ||
    (intervention.responsePayload === undefined
      ? row.response_hash !== null
      : hashCanonicalJson(intervention.responsePayload) !== row.response_hash)
  ) {
    throw new PersistenceConflictError("Analysis intervention hash mismatch");
  }
  return intervention;
}

function proposalResult(row: ProposalRow): Readonly<Record<string, unknown>> {
  return {
    status: "COMPILED",
    proposalId: row.proposal_id,
    revisionId: row.applied_revision_id,
    appliedRevisionId: row.applied_revision_id,
  };
}

function proposalFailureStatus(
  safeCode: string,
): "CONFLICT" | "REJECTED" | "COMPILE_FAILED" {
  if (/CONFLICT|STALE|REVISION/u.test(safeCode)) return "CONFLICT";
  if (/INVALID|FORBIDDEN|EXPIRED|NOT_EDITABLE/u.test(safeCode)) {
    return "REJECTED";
  }
  return "COMPILE_FAILED";
}

function projectionPlanIdentity(projection: AnalysisProjection): {
  readonly upstreamAnalysisId: string;
} {
  const activity = jsonObject(projection.activity, "analysis activity");
  const plan = jsonObject(activity["plan"], "analysis plan activity");
  const upstreamAnalysisId = plan["upstreamAnalysisId"];
  if (typeof upstreamAnalysisId !== "string") {
    throw new PersistenceConflictError(
      "Analysis projection plan identity is unavailable",
    );
  }
  return { upstreamAnalysisId };
}

function cloneState(
  value: Readonly<Record<string, unknown>>,
): AgUiSharedStateV03 {
  return agUiSharedStateV03Schema.parse(JSON.parse(canonicalJson(value)));
}

function cloneObject(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return jsonObject(JSON.parse(canonicalJson(value)), "analysis activity");
}

function nodeState(
  nodeId: string,
  executionStatus:
    | "PENDING"
    | "READY"
    | "RUNNING"
    | "SUCCEEDED"
    | "PARTIAL"
    | "FAILED"
    | "CANCELLED",
  current: AgUiSharedStateV03["analysis"]["nodesById"][string] | undefined,
): AgUiSharedStateV03["analysis"]["nodesById"][string] {
  return {
    schemaVersion: "sacs-analysis-node-state/1.0",
    nodeId,
    executionStatus,
    relevanceStatus: "ACTIVE",
    currentness:
      executionStatus === "SUCCEEDED" || executionStatus === "PARTIAL"
        ? "CURRENT"
        : "UNKNOWN",
    inputLayerIds: current?.inputLayerIds ?? [],
    outputLayerIds: current?.outputLayerIds ?? [],
    findingIds: current?.findingIds ?? [],
  };
}

function objectField(
  object: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  const value = object[key];
  return value === undefined ? {} : jsonObject(value, key);
}

function stringField(
  object: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  return typeof object[key] === "string" ? object[key] : undefined;
}

function validateInterventionResponse(
  intervention: AnalysisIntervention,
  value: Readonly<Record<string, unknown>>,
): boolean {
  if (!isSafePublicArgs(value) || Object.keys(value).length === 0) return false;
  const candidates = intervention.requestPayload["candidateIds"];
  if (
    !Array.isArray(candidates) ||
    Object.keys(value).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, "candidateId")
  ) {
    return false;
  }
  const allowed = candidates.filter(
    (candidate): candidate is string => typeof candidate === "string",
  );
  return (
    typeof value["candidateId"] === "string" &&
    allowed.includes(value["candidateId"])
  );
}

function compileTrustedPublicEditSchemas(
  entries: readonly TrustedPublicEditSchema[],
): ReadonlyMap<string, CompiledPublicEditSchema> {
  const compiled = new Map<string, CompiledPublicEditSchema>();
  for (const entry of entries) {
    if (
      entry.uri.length === 0 ||
      entry.uri.length > 1_024 ||
      compiled.has(entry.uri)
    ) {
      throw new Error("ANALYSIS_TRUSTED_PUBLIC_EDIT_SCHEMA_INVALID");
    }
    compiled.set(entry.uri, {
      hash: hashCanonicalJson(entry.schema),
      validate: compilePublicArgsSchemaValidator(entry.schema),
    });
  }
  return compiled;
}

function isSafePublicArgs(value: Readonly<Record<string, unknown>>): boolean {
  try {
    assertSafeJson(value, 0, { nodes: 0 });
    return (
      Buffer.byteLength(canonicalJson(value), "utf8") <=
      ANALYSIS_MAX_PUBLIC_ARGS_BYTES
    );
  } catch {
    return false;
  }
}

function assertSafeJson(
  value: unknown,
  depth: number,
  budget: { nodes: number },
): void {
  budget.nodes += 1;
  if (depth > 32 || budget.nodes > 10_000) throw new Error("JSON_BUDGET");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON_NUMBER");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => assertSafeJson(entry, depth + 1, budget));
    return;
  }
  if (typeof value !== "object") throw new Error("JSON_TYPE");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("JSON_PROTOTYPE");
  }
  for (const [key, entry] of Object.entries(value)) {
    if (new Set(["__proto__", "prototype", "constructor"]).has(key)) {
      throw new Error("JSON_KEY");
    }
    assertSafeJson(entry, depth + 1, budget);
  }
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PersistenceConflictError(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function jsonArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new PersistenceConflictError(`${label} is not an array`);
  }
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  const array = jsonArray(value, label);
  if (array.some((entry) => typeof entry !== "string")) {
    throw new PersistenceConflictError(`${label} is not a string array`);
  }
  return array as readonly string[];
}

function assertJsonBudget(
  value: unknown,
  maximum: number,
  label: string,
): void {
  if (Buffer.byteLength(canonicalJson(value), "utf8") > maximum) {
    throw new PersistenceConflictError(`${label} exceeds persistence budget`);
  }
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function nullableIso(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function canonicalNullableJson(value: unknown): string | null {
  return value === null || value === undefined ? null : canonicalJson(value);
}

function isPositiveSafeInteger(value: number | string): boolean {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function persistenceError(error: unknown, message: string): Error {
  if (
    error instanceof PersistenceAuthorizationError ||
    error instanceof PersistenceConflictError ||
    error instanceof AnalysisServiceError
  ) {
    return error;
  }
  return new PersistenceConflictError(message);
}

function revisionConflict(): AnalysisServiceError {
  return new AnalysisServiceError(
    409,
    "ANALYSIS_REVISION_CONFLICT",
    "Analysis revision changed.",
  );
}

function descriptorConflict(): AnalysisServiceError {
  return new AnalysisServiceError(
    409,
    "ANALYSIS_DESCRIPTOR_CONFLICT",
    "Analysis tool descriptor changed.",
  );
}

function assertSafeFailureIdentity(
  safeCode: string,
  statusCode: AnalysisServiceError["statusCode"],
): void {
  if (!/^[A-Z][A-Z0-9_:-]{0,127}$/u.test(safeCode)) {
    throw new PersistenceConflictError(
      "Analysis command failure identity is invalid",
    );
  }
  analysisErrorStatus(statusCode);
}

function interventionLineageConflict(): AnalysisServiceError {
  return new AnalysisServiceError(
    409,
    "ANALYSIS_INTERVENTION_LINEAGE_CONFLICT",
    "Analysis intervention lineage changed.",
  );
}

function analysisErrorStatus(
  value: number | string,
): AnalysisServiceError["statusCode"] {
  const status = Number(value);
  if (!new Set([400, 403, 404, 409, 410, 422, 503]).has(status)) {
    throw new PersistenceConflictError(
      "Analysis command failure status is invalid",
    );
  }
  return status as AnalysisServiceError["statusCode"];
}

function analysisNotFound(): AnalysisServiceError {
  return new AnalysisServiceError(
    404,
    "ANALYSIS_NOT_FOUND",
    "Analysis was not found.",
  );
}

function interventionNotFound(): AnalysisServiceError {
  return new AnalysisServiceError(
    404,
    "ANALYSIS_INTERVENTION_NOT_FOUND",
    "Analysis intervention was not found.",
  );
}
