ALTER TABLE chat_service.grounding_execution
  ADD CONSTRAINT grounding_execution_explanation_scope_unique
  UNIQUE (
    grounding_id,
    principal_id,
    thread_id,
    wsgs_grounding_id,
    grounding_result_hash
  );

CREATE TABLE chat_service.world_explanation (
  explanation_id text PRIMARY KEY CHECK (
    char_length(explanation_id) BETWEEN 1 AND 256
    AND explanation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  thread_id text NOT NULL,
  grounding_execution_id text NOT NULL CHECK (
    char_length(grounding_execution_id) BETWEEN 1 AND 256
  ),
  grounding_id text NOT NULL CHECK (
    char_length(grounding_id) BETWEEN 1 AND 256
    AND grounding_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  grounding_result_hash text NOT NULL CHECK (
    grounding_result_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  locale text NOT NULL CHECK (char_length(locale) BETWEEN 2 AND 32),
  contract_version text NOT NULL CHECK (
    char_length(contract_version) BETWEEN 1 AND 128
  ),
  contract_hash text NOT NULL CHECK (
    contract_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  renderer_policy_hash text NOT NULL CHECK (
    renderer_policy_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  explanation_status text NOT NULL CHECK (
    explanation_status IN (
      'COMPLETE',
      'PARTIAL',
      'CLARIFICATION_REQUIRED',
      'DATA_UNAVAILABLE',
      'FAILED',
      'CANCELLED'
    )
  ),
  explanation_json jsonb NOT NULL CHECK (
    jsonb_typeof(explanation_json) = 'object'
    AND octet_length(explanation_json::text) <= 4194304
  ),
  explanation_hash text NOT NULL CHECK (
    explanation_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (thread_id, principal_id)
    REFERENCES chat_service.conversation_thread(thread_id, principal_id),
  FOREIGN KEY (
    grounding_execution_id,
    principal_id,
    thread_id,
    grounding_id,
    grounding_result_hash
  ) REFERENCES chat_service.grounding_execution(
    grounding_id,
    principal_id,
    thread_id,
    wsgs_grounding_id,
    grounding_result_hash
  ),
  UNIQUE (
    principal_id,
    thread_id,
    grounding_result_hash,
    locale,
    contract_hash,
    renderer_policy_hash
  ),
  UNIQUE (
    principal_id,
    thread_id,
    explanation_id,
    explanation_hash
  ),
  CHECK (explanation_json->>'explanationId' = explanation_id),
  CHECK (explanation_json->>'explanationHash' = explanation_hash),
  CHECK (explanation_json->>'locale' = locale),
  CHECK (explanation_json->>'schemaVersion' = contract_version),
  CHECK (explanation_json->>'explanationStatus' = explanation_status),
  CHECK (explanation_json#>>'{grounding,groundingId}' = grounding_id),
  CHECK (
    explanation_json#>>'{grounding,resultHash}' = grounding_result_hash
  ),
  CHECK (
    explanation_json#>>'{provenance,rendererPolicyHash}' =
      renderer_policy_hash
  )
);

CREATE INDEX world_explanation_history
  ON chat_service.world_explanation(
    principal_id, thread_id, created_at DESC, explanation_id
  );

ALTER TABLE chat_service.conversation_world_focus
  ADD COLUMN last_explanation_id text CHECK (
    last_explanation_id IS NULL
    OR (
      char_length(last_explanation_id) BETWEEN 1 AND 256
      AND last_explanation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  ADD COLUMN last_explanation_hash text CHECK (
    last_explanation_hash IS NULL
    OR last_explanation_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT conversation_world_focus_explanation_pair CHECK (
    (last_explanation_id IS NULL) = (last_explanation_hash IS NULL)
  ),
  ADD CONSTRAINT conversation_world_focus_explanation_fk
    FOREIGN KEY (
      principal_id,
      thread_id,
      last_explanation_id,
      last_explanation_hash
    ) REFERENCES chat_service.world_explanation(
      principal_id,
      thread_id,
      explanation_id,
      explanation_hash
    );

ALTER TABLE chat_service.conversation_world_reference
  ADD COLUMN source_explanation_id text CHECK (
    source_explanation_id IS NULL
    OR (
      char_length(source_explanation_id) BETWEEN 1 AND 256
      AND source_explanation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  ADD COLUMN source_explanation_hash text CHECK (
    source_explanation_hash IS NULL
    OR source_explanation_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN source_finding_id text CHECK (
    source_finding_id IS NULL
    OR (
      char_length(source_finding_id) BETWEEN 1 AND 256
      AND source_finding_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  ADD COLUMN source_finding_ordinal integer CHECK (
    source_finding_ordinal IS NULL
    OR source_finding_ordinal BETWEEN 1 AND 128
  ),
  ADD CONSTRAINT conversation_world_reference_finding_projection CHECK (
    (
      source_explanation_id IS NULL
      AND source_explanation_hash IS NULL
      AND source_finding_id IS NULL
      AND source_finding_ordinal IS NULL
    ) OR (
      source_explanation_id IS NOT NULL
      AND source_explanation_hash IS NOT NULL
      AND source_finding_id IS NOT NULL
      AND source_finding_ordinal IS NOT NULL
    )
  ),
  ADD CONSTRAINT conversation_world_reference_explanation_fk
    FOREIGN KEY (
      principal_id,
      thread_id,
      source_explanation_id,
      source_explanation_hash
    ) REFERENCES chat_service.world_explanation(
      principal_id,
      thread_id,
      explanation_id,
      explanation_hash
    );

CREATE FUNCTION chat_service.reject_world_explanation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'world explanations are immutable';
END
$$;

CREATE TRIGGER world_explanation_no_update
BEFORE UPDATE ON chat_service.world_explanation
FOR EACH ROW
EXECUTE FUNCTION chat_service.reject_world_explanation_mutation();

CREATE TRIGGER world_explanation_no_delete
BEFORE DELETE ON chat_service.world_explanation
FOR EACH ROW
EXECUTE FUNCTION chat_service.reject_world_explanation_mutation();
