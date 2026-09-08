-- Grounding jobs are not Native plans. Legacy definitions remain byte-for-byte readable.
ALTER TABLE chat_service.analysis_revision
  ADD COLUMN source_kind text,
  ADD COLUMN source_id text,
  ADD COLUMN source_hash text,
  ADD COLUMN source_revision integer,
  ADD COLUMN source_upstream_run_id text;

UPDATE chat_service.analysis_revision
SET source_kind = 'LEGACY_PLAN', source_id = wsgs_plan_id,
    source_hash = plan_hash, source_revision = revision_number;

ALTER TABLE chat_service.analysis_revision
  ALTER COLUMN source_kind SET NOT NULL,
  ALTER COLUMN source_id SET NOT NULL,
  ALTER COLUMN source_hash SET NOT NULL,
  ALTER COLUMN wsgs_plan_id DROP NOT NULL,
  ALTER COLUMN plan_hash DROP NOT NULL,
  ADD CONSTRAINT analysis_source_kind CHECK (source_kind IN ('WSGS_GROUNDING_JOB','WSGS_NATIVE_ANALYSIS','FIXTURE','LEGACY_PLAN')),
  ADD CONSTRAINT analysis_source_id CHECK (char_length(source_id) BETWEEN 1 AND 256 AND source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  ADD CONSTRAINT analysis_source_hash CHECK (source_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT analysis_source_revision CHECK (source_revision IS NULL OR source_revision >= 0),
  ADD CONSTRAINT analysis_source_job_truth CHECK (source_kind <> 'WSGS_GROUNDING_JOB' OR (wsgs_plan_id IS NULL AND plan_hash IS NULL AND source_revision IS NULL));

CREATE FUNCTION chat_service.enforce_analysis_source_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_kind = 'LEGACY_PLAN' THEN
      RAISE EXCEPTION 'ANALYSIS_SOURCE_LEGACY_WRITE_FORBIDDEN';
    END IF;
    -- Compatibility for the existing Native-only repository API.
    IF NEW.source_kind IS NULL AND NEW.wsgs_plan_id IS NOT NULL THEN
      NEW.source_kind := 'WSGS_NATIVE_ANALYSIS';
      NEW.source_id := NEW.wsgs_plan_id;
      NEW.source_hash := NEW.plan_hash;
      NEW.source_revision := NEW.revision_number;
    END IF;
  ELSIF (NEW.source_kind, NEW.source_id, NEW.source_hash, NEW.source_revision, NEW.source_upstream_run_id)
    IS DISTINCT FROM (OLD.source_kind, OLD.source_id, OLD.source_hash, OLD.source_revision, OLD.source_upstream_run_id) THEN
    RAISE EXCEPTION 'ANALYSIS_SOURCE_IDENTITY_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER analysis_source_identity_guard BEFORE INSERT OR UPDATE
  ON chat_service.analysis_revision FOR EACH ROW EXECUTE FUNCTION chat_service.enforce_analysis_source_identity();

-- Durable request and polling state belongs to the existing Grounding lifecycle.
ALTER TABLE chat_service.grounding_execution
  ADD COLUMN canonical_request_json jsonb CHECK (canonical_request_json IS NULL OR (jsonb_typeof(canonical_request_json) = 'object' AND octet_length(canonical_request_json::text) <= 1048576)),
  ADD COLUMN analysis_id text REFERENCES chat_service.analysis_session(analysis_id) DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN analysis_revision_id text REFERENCES chat_service.analysis_revision(revision_id) DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN analysis_run_id text REFERENCES chat_service.analysis_run(run_id) DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN last_source_status text,
  ADD COLUMN last_observation_hash text,
  ADD COLUMN last_polled_at timestamptz,
  ADD COLUMN consecutive_poll_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_poll_failures >= 0),
  ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX grounding_analysis_revision_binding ON chat_service.grounding_execution(analysis_revision_id) WHERE analysis_revision_id IS NOT NULL;
