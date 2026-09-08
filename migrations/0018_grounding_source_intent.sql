ALTER TABLE chat_service.grounding_execution
  ADD COLUMN source_job_id text CHECK(source_job_id IS NULL OR (char_length(source_job_id) BETWEEN 1 AND 256 AND source_job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')),
  ADD COLUMN analysis_intent_json jsonb CHECK(analysis_intent_json IS NULL OR (jsonb_typeof(analysis_intent_json)='object' AND octet_length(analysis_intent_json::text)<=4096));

CREATE UNIQUE INDEX grounding_source_scoped_identity
 ON chat_service.grounding_execution(principal_id,thread_id,wsgs_grounding_id)
 WHERE wsgs_grounding_id IS NOT NULL AND canonical_request_json IS NOT NULL;

CREATE FUNCTION chat_service.guard_grounding_source_intent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.canonical_request_json IS NOT NULL AND (NEW.canonical_request_json,NEW.analysis_intent_json) IS DISTINCT FROM (OLD.canonical_request_json,OLD.analysis_intent_json) THEN
  RAISE EXCEPTION 'GROUNDING_SOURCE_INTENT_IMMUTABLE';
 END IF;
 IF OLD.source_job_id IS NOT NULL AND NEW.source_job_id IS DISTINCT FROM OLD.source_job_id THEN
  RAISE EXCEPTION 'GROUNDING_SOURCE_IDENTITY_IMMUTABLE';
 END IF;
 IF OLD.canonical_request_json IS NOT NULL AND OLD.wsgs_grounding_id IS NOT NULL AND NEW.wsgs_grounding_id IS DISTINCT FROM OLD.wsgs_grounding_id THEN
  RAISE EXCEPTION 'GROUNDING_SOURCE_IDENTITY_IMMUTABLE';
 END IF;
 IF OLD.last_source_status IN ('COMPLETED','PARTIAL','AMBIGUOUS','UNRESOLVED','FAILED','CANCELLED') AND NEW.last_source_status IS DISTINCT FROM OLD.last_source_status THEN
  RAISE EXCEPTION 'GROUNDING_SOURCE_TERMINAL_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER grounding_source_intent_guard BEFORE UPDATE
 ON chat_service.grounding_execution FOR EACH ROW EXECUTE FUNCTION chat_service.guard_grounding_source_intent();

-- Preserve the v0.4 lifecycle and output immutability. Only negotiated durable
-- Grounding intents may add the published identity/result while still pending.
CREATE OR REPLACE FUNCTION chat_service.enforce_grounding_execution_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.grounding_id,NEW.principal_id,NEW.thread_id,NEW.interaction_request_id,NEW.wsgs_request_id,NEW.idempotency_key,NEW.request_hash,NEW.wsgs_operation,NEW.requested_products_json,NEW.context_usage_json,NEW.created_at)
 IS DISTINCT FROM (OLD.grounding_id,OLD.principal_id,OLD.thread_id,OLD.interaction_request_id,OLD.wsgs_request_id,OLD.idempotency_key,OLD.request_hash,OLD.wsgs_operation,OLD.requested_products_json,OLD.context_usage_json,OLD.created_at) THEN
  RAISE EXCEPTION 'grounding immutable request fields cannot change';
 END IF;
 IF NEW.version <> OLD.version+1 THEN RAISE EXCEPTION 'grounding version must increase by exactly one'; END IF;
 IF OLD.state IN ('COMPLETED','FAILED','CANCELLED') THEN RAISE EXCEPTION 'terminal grounding rows cannot change'; END IF;
 IF (OLD.wsgs_grounding_id IS NOT NULL AND NEW.wsgs_grounding_id IS DISTINCT FROM OLD.wsgs_grounding_id)
 OR (OLD.grounding_result_hash IS NOT NULL AND NEW.grounding_result_hash IS DISTINCT FROM OLD.grounding_result_hash)
 OR (OLD.grounding_result_json IS NOT NULL AND NEW.grounding_result_json IS DISTINCT FROM OLD.grounding_result_json)
 OR (OLD.operational_bundle_hash IS NOT NULL AND NEW.operational_bundle_hash IS DISTINCT FROM OLD.operational_bundle_hash)
 OR (OLD.operational_bundle_json IS NOT NULL AND NEW.operational_bundle_json IS DISTINCT FROM OLD.operational_bundle_json)
 OR (OLD.sdar_submission_key IS NOT NULL AND NEW.sdar_submission_key IS DISTINCT FROM OLD.sdar_submission_key)
 OR (OLD.sdar_task_id IS NOT NULL AND NEW.sdar_task_id IS DISTINCT FROM OLD.sdar_task_id)
 OR (OLD.sdar_context_id IS NOT NULL AND NEW.sdar_context_id IS DISTINCT FROM OLD.sdar_context_id) THEN
  RAISE EXCEPTION 'grounding durable outputs cannot change once recorded';
 END IF;
 IF NEW.state=OLD.state THEN
  IF (NEW.operational_bundle_hash,NEW.operational_bundle_json,NEW.sdar_submission_key,NEW.sdar_task_id,NEW.sdar_context_id,NEW.failure_code,NEW.terminal_at)
   IS DISTINCT FROM (OLD.operational_bundle_hash,OLD.operational_bundle_json,OLD.sdar_submission_key,OLD.sdar_task_id,OLD.sdar_context_id,OLD.failure_code,OLD.terminal_at)
   OR (NOT(OLD.canonical_request_json IS NOT NULL AND OLD.state='GROUNDING_PENDING') AND (NEW.wsgs_grounding_id,NEW.grounding_result_hash,NEW.grounding_result_json) IS DISTINCT FROM (OLD.wsgs_grounding_id,OLD.grounding_result_hash,OLD.grounding_result_json)) THEN
   RAISE EXCEPTION 'same-state grounding updates may change only the lease';
  END IF;
 ELSIF NOT((OLD.state='GROUNDING_PENDING' AND NEW.state IN ('GROUNDING_READY','FAILED','CANCELLED'))
 OR (OLD.state='GROUNDING_READY' AND NEW.state IN ('SDAR_SUBMISSION_RESERVED','COMPLETED','FAILED','CANCELLED'))
 OR (OLD.state='SDAR_SUBMISSION_RESERVED' AND NEW.state IN ('SDAR_SUBMITTED','FAILED','CANCELLED'))
 OR (OLD.state='SDAR_SUBMITTED' AND NEW.state IN ('COMPLETED','FAILED','CANCELLED'))) THEN
  RAISE EXCEPTION 'invalid grounding state transition: % -> %',OLD.state,NEW.state;
 END IF;
 NEW.updated_at:=now();RETURN NEW;
END $$;
