import type { Pool } from "pg";

import {
  parseGroundingContractIdentity,
  sourceIsTerminal,
  sourceStatusMapping,
  type AnalysisSourceStatus,
} from "../../analysis-contract/src/source.js";
import type { AnalysisScope } from "./analysis-repository.js";
import { hashJson } from "./hash.js";
import {
  PersistenceAuthorizationError,
  PersistenceConflictError,
} from "./repository.js";
import type { JsonValue } from "./types.js";

interface HistoricalSourceRow {
  grounding_id: string;
  principal_id: string;
  thread_id: string;
  analysis_id: string;
  analysis_revision_id: string;
  analysis_run_id: string;
  wsgs_grounding_id: string;
  request_hash: string;
  source_kind: string;
  source_id: string;
  source_hash: string;
  analysis_intent_json: Record<string, JsonValue> | null;
  last_source_status: AnalysisSourceStatus | null;
  last_observation_hash: string | null;
  grounding_result_hash: string | null;
  observed_at: Date | string;
}

/**
 * Finish only the historical run from a saved published source observation.
 * The caller supplies no result/status to promote, and this transaction never
 * writes the active session, revision, shared projection or intervention.
 */
export async function recordHistoricalGroundingSource(
  pool: Pool,
  input: {
    readonly scope: AnalysisScope;
    readonly groundingExecutionId: string;
    readonly revisionId: string;
    readonly runId: string;
    readonly observationHash: string;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // All analysis writers serialize on the session first, including sequence allocation.
    const owned = await client.query<{ active_revision_id: string }>(
      `SELECT s.active_revision_id FROM chat_service.analysis_session s
       JOIN chat_service.conversation_thread t ON t.thread_id=s.thread_id AND t.principal_id=s.principal_id
       WHERE s.analysis_id=$1 AND s.principal_id=$2 AND s.thread_id=$3
       FOR UPDATE OF s`,
      [input.scope.analysisId, input.scope.principalId, input.scope.threadId],
    );
    const session = owned.rows[0];
    if (!session) throw new PersistenceAuthorizationError("ANALYSIS_NOT_FOUND");
    if (session.active_revision_id === input.revisionId) {
      await client.query("COMMIT");
      return;
    }
    const selected = await client.query<HistoricalSourceRow>(
      `SELECT g.grounding_id,g.principal_id,g.thread_id,g.analysis_id,g.analysis_revision_id,g.analysis_run_id,
              g.wsgs_grounding_id,g.request_hash,g.analysis_intent_json,g.last_source_status,g.last_observation_hash,
              g.grounding_result_hash,COALESCE(g.last_polled_at,g.updated_at) AS observed_at,
              v.source_kind,v.source_id,v.source_hash
       FROM chat_service.grounding_execution g
       JOIN chat_service.analysis_revision v ON v.revision_id=g.analysis_revision_id AND v.analysis_id=g.analysis_id
       JOIN chat_service.analysis_run r ON r.run_id=g.analysis_run_id AND r.revision_id=v.revision_id AND r.analysis_id=v.analysis_id
       WHERE g.grounding_id=$1 AND g.principal_id=$2 AND g.thread_id=$3 AND g.analysis_id=$4
         AND g.analysis_revision_id=$5 AND g.analysis_run_id=$6 AND g.canonical_request_json IS NOT NULL
         AND NOT EXISTS(SELECT 1 FROM chat_service.analysis_run newer WHERE newer.revision_id=r.revision_id AND newer.attempt>r.attempt)
       FOR UPDATE OF g,r`,
      [
        input.groundingExecutionId,
        input.scope.principalId,
        input.scope.threadId,
        input.scope.analysisId,
        input.revisionId,
        input.runId,
      ],
    );
    const source = selected.rows[0];
    // Missing, superseded observations and nonterminal polling are not new facts.
    if (!source || source.last_observation_hash !== input.observationHash) {
      await client.query("COMMIT");
      return;
    }
    if (
      source.grounding_id !== input.groundingExecutionId ||
      source.principal_id !== input.scope.principalId ||
      source.thread_id !== input.scope.threadId ||
      source.analysis_id !== input.scope.analysisId ||
      source.analysis_revision_id !== input.revisionId ||
      source.analysis_run_id !== input.runId ||
      source.analysis_intent_json?.["analysisId"] !== input.scope.analysisId ||
      source.analysis_intent_json["revisionId"] !== input.revisionId ||
      source.source_kind !== "WSGS_GROUNDING_JOB" ||
      source.source_id !== source.wsgs_grounding_id ||
      source.source_hash !== "sha256:" + source.request_hash
    )
      throw new PersistenceConflictError("ANALYSIS_SOURCE_IDENTITY_INVALID");
    parseGroundingContractIdentity(
      source.analysis_intent_json["contractIdentity"],
    );
    if (
      source.last_source_status === null ||
      !Object.hasOwn(sourceStatusMapping, source.last_source_status)
    )
      throw new PersistenceConflictError(
        "ANALYSIS_SOURCE_RESPONSE_CONTRACT_VIOLATION",
      );
    if (!sourceIsTerminal(source.last_source_status)) {
      await client.query("COMMIT");
      return;
    }
    const status = sourceStatusMapping[source.last_source_status].run;
    const observedAt = new Date(source.observed_at);
    if (!Number.isFinite(observedAt.getTime()))
      throw new PersistenceConflictError(
        "ANALYSIS_SOURCE_OBSERVATION_TIME_INVALID",
      );
    const eventId =
      "event-" +
      hashJson({
        runId: input.runId,
        sourceObservation: input.observationHash,
      });
    const payload = {
      sourceStatus: source.last_source_status,
      resultHash: source.grounding_result_hash,
    };
    const payloadHash = "sha256:" + hashJson(payload);
    const existing = await client.query<{
      analysis_id: string;
      revision_id: string;
      run_id: string;
      event_type: string;
      payload_hash: string;
    }>(
      "SELECT analysis_id,revision_id,run_id,event_type,payload_hash FROM chat_service.analysis_event WHERE event_id=$1",
      [eventId],
    );
    const prior = existing.rows[0];
    if (prior) {
      if (
        prior.analysis_id !== input.scope.analysisId ||
        prior.revision_id !== input.revisionId ||
        prior.run_id !== input.runId ||
        prior.event_type !== "GROUNDING_SOURCE_OBSERVED" ||
        prior.payload_hash !== payloadHash
      )
        throw new PersistenceConflictError(
          "ANALYSIS_SOURCE_EVENT_IDENTITY_CONFLICT",
        );
      await client.query("COMMIT");
      return;
    }
    const counters = await client.query<{
      analysis_sequence: string;
      run_sequence: string;
    }>(
      `SELECT (COALESCE(MAX(analysis_sequence),0)+1)::text AS analysis_sequence,
              (COALESCE(MAX(run_sequence) FILTER(WHERE run_id=$2),0)+1)::text AS run_sequence
       FROM chat_service.analysis_event WHERE analysis_id=$1`,
      [input.scope.analysisId, input.runId],
    );
    const sequence = counters.rows[0];
    if (
      !sequence ||
      !/^[1-9][0-9]*$/u.test(sequence.analysis_sequence) ||
      !/^[1-9][0-9]*$/u.test(sequence.run_sequence)
    )
      throw new PersistenceConflictError("ANALYSIS_EVENT_SEQUENCE_INVALID");
    await client.query(
      `INSERT INTO chat_service.analysis_event(event_id,analysis_id,revision_id,run_id,analysis_sequence,run_sequence,
        event_type,correlation_id,occurred_at,payload_json,payload_hash)
       VALUES($1,$2,$3,$4,$5::bigint,$6::bigint,'GROUNDING_SOURCE_OBSERVED',$4,$7::timestamptz,$8::jsonb,$9)`,
      [
        eventId,
        input.scope.analysisId,
        input.revisionId,
        input.runId,
        sequence.analysis_sequence,
        sequence.run_sequence,
        observedAt.toISOString(),
        JSON.stringify(payload),
        payloadHash,
      ],
    );
    const updated = await client.query(
      `UPDATE chat_service.analysis_run SET status=$4,
         finished_at=CASE WHEN $4 IN ('SUCCEEDED','PARTIAL','FAILED','CANCELLED') THEN COALESCE(finished_at,$5::timestamptz) ELSE finished_at END
       WHERE analysis_id=$1 AND revision_id=$2 AND run_id=$3`,
      [
        input.scope.analysisId,
        input.revisionId,
        input.runId,
        status,
        observedAt.toISOString(),
      ],
    );
    if (updated.rowCount !== 1)
      throw new PersistenceConflictError(
        "ANALYSIS_SOURCE_RUN_IDENTITY_CONFLICT",
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
