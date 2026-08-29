CREATE TABLE chat_service.authority_fusion_evaluation (
  fusion_id text PRIMARY KEY CHECK (char_length(fusion_id) BETWEEN 1 AND 256),
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  thread_id text NOT NULL,
  task_id text NOT NULL CHECK (char_length(task_id) BETWEEN 1 AND 256),
  task_snapshot_hash text NOT NULL CHECK (
    task_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  requirement_hash text NOT NULL CHECK (
    requirement_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  grounding_id text NOT NULL CHECK (
    char_length(grounding_id) BETWEEN 1 AND 256
  ),
  grounding_result_hash text NOT NULL CHECK (
    grounding_result_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  fusion_result_hash text NOT NULL CHECK (
    fusion_result_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  fusion_result_json jsonb NOT NULL CHECK (
    jsonb_typeof(fusion_result_json) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (thread_id, principal_id)
    REFERENCES chat_service.conversation_thread(thread_id, principal_id)
    ON DELETE CASCADE,
  UNIQUE (
    principal_id,
    thread_id,
    task_id,
    task_snapshot_hash,
    requirement_hash,
    grounding_result_hash
  )
);

CREATE INDEX authority_fusion_task_history
  ON chat_service.authority_fusion_evaluation(
    principal_id, thread_id, task_id, created_at DESC
  );

CREATE FUNCTION chat_service.reject_authority_fusion_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'authority fusion evaluations are immutable';
END
$$;

CREATE TRIGGER authority_fusion_no_update
BEFORE UPDATE ON chat_service.authority_fusion_evaluation
FOR EACH ROW
EXECUTE FUNCTION chat_service.reject_authority_fusion_mutation();

CREATE TRIGGER authority_fusion_no_delete
BEFORE DELETE ON chat_service.authority_fusion_evaluation
FOR EACH ROW
EXECUTE FUNCTION chat_service.reject_authority_fusion_mutation();
