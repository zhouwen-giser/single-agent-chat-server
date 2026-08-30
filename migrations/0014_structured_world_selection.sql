ALTER TABLE chat_service.world_explanation
  ADD CONSTRAINT world_explanation_selection_scope_unique
  UNIQUE (
    principal_id,
    thread_id,
    grounding_id,
    explanation_id,
    explanation_hash
  );

CREATE TABLE chat_service.structured_world_selection (
  selection_id text NOT NULL CHECK (
    char_length(selection_id) BETWEEN 1 AND 256
    AND selection_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  selection_revision integer NOT NULL CHECK (selection_revision >= 1),
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  thread_id text NOT NULL,
  grounding_id text NOT NULL CHECK (
    char_length(grounding_id) BETWEEN 1 AND 256
    AND grounding_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  explanation_id text NOT NULL CHECK (
    char_length(explanation_id) BETWEEN 1 AND 256
    AND explanation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  explanation_hash text NOT NULL CHECK (
    explanation_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  selection_kind text NOT NULL CHECK (
    selection_kind IN (
      'FINDING_FEATURE',
      'MAP_FEATURE',
      'REFERENCE_SET_MEMBER'
    )
  ),
  finding_id text CHECK (
    finding_id IS NULL OR (
      char_length(finding_id) BETWEEN 1 AND 256
      AND finding_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  feature_id text CHECK (
    feature_id IS NULL OR (
      char_length(feature_id) BETWEEN 1 AND 256
      AND feature_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  reference_key_json jsonb CHECK (
    reference_key_json IS NULL OR jsonb_typeof(reference_key_json) = 'object'
  ),
  upstream_selection_token text CHECK (
    upstream_selection_token IS NULL
    OR char_length(upstream_selection_token) BETWEEN 1 AND 2048
  ),
  source_hash text NOT NULL CHECK (
    source_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  selection_json jsonb NOT NULL CHECK (
    jsonb_typeof(selection_json) = 'object'
    AND octet_length(selection_json::text) <= 32768
  ),
  selected_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > selected_at),
  validation_source_operation text NOT NULL CHECK (
    validation_source_operation IN (
      'VALIDATE_REFERENCES',
      'UPSTREAM_SELECTION_TOKEN_VALIDATE'
    )
  ),
  validation_proof_hash text NOT NULL CHECK (
    validation_proof_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  validation_valid_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (selection_id, selection_revision),
  FOREIGN KEY (thread_id, principal_id)
    REFERENCES chat_service.conversation_thread(thread_id, principal_id),
  FOREIGN KEY (
    principal_id,
    thread_id,
    grounding_id,
    explanation_id,
    explanation_hash
  ) REFERENCES chat_service.world_explanation(
    principal_id,
    thread_id,
    grounding_id,
    explanation_id,
    explanation_hash
  ),
  CHECK (
    (reference_key_json IS NULL) <> (upstream_selection_token IS NULL)
  ),
  CHECK (
    selection_kind = 'REFERENCE_SET_MEMBER' OR finding_id IS NOT NULL
  ),
  CHECK (
    selection_kind <> 'MAP_FEATURE' OR feature_id IS NOT NULL
  ),
  CHECK (
    selection_json->>'schemaVersion' =
      'sacs-structured-world-selection/1.0'
  ),
  CHECK (selection_json->>'selectionId' = selection_id),
  CHECK (
    (selection_json->>'selectionRevision')::integer = selection_revision
  ),
  CHECK (selection_json->>'principalId' = principal_id),
  CHECK (selection_json->>'threadId' = thread_id),
  CHECK (selection_json->>'groundingId' = grounding_id),
  CHECK (selection_json->>'explanationId' = explanation_id),
  CHECK (selection_json->>'selectionKind' = selection_kind),
  CHECK (selection_json->>'sourceHash' = source_hash),
  CHECK (selection_json->>'findingId' IS NOT DISTINCT FROM finding_id),
  CHECK (selection_json->>'featureId' IS NOT DISTINCT FROM feature_id),
  CHECK (
    selection_json->'referenceKey' IS NOT DISTINCT FROM reference_key_json
  ),
  CHECK (
    selection_json->>'upstreamSelectionToken' IS NOT DISTINCT FROM
      upstream_selection_token
  ),
  CHECK ((selection_json->>'selectedAt')::timestamptz = selected_at),
  CHECK ((selection_json->>'expiresAt')::timestamptz = expires_at),
  CHECK (validation_valid_until >= expires_at),
  CHECK (
    (reference_key_json IS NOT NULL AND
      validation_source_operation = 'VALIDATE_REFERENCES') OR
    (upstream_selection_token IS NOT NULL AND
      validation_source_operation = 'UPSTREAM_SELECTION_TOKEN_VALIDATE')
  )
);

CREATE INDEX structured_world_selection_scope_latest
  ON chat_service.structured_world_selection(
    principal_id,
    thread_id,
    selection_id,
    selection_revision DESC
  );

CREATE INDEX structured_world_selection_expiry
  ON chat_service.structured_world_selection(expires_at);

CREATE FUNCTION chat_service.reject_structured_world_selection_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'structured world selections are append-only';
END
$$;

CREATE TRIGGER structured_world_selection_no_update
BEFORE UPDATE ON chat_service.structured_world_selection
FOR EACH ROW
EXECUTE FUNCTION chat_service.reject_structured_world_selection_mutation();

CREATE TRIGGER structured_world_selection_no_delete
BEFORE DELETE ON chat_service.structured_world_selection
FOR EACH ROW
EXECUTE FUNCTION chat_service.reject_structured_world_selection_mutation();
