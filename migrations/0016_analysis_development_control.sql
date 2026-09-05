CREATE TABLE chat_service.analysis_tool_interaction_descriptor (
  analysis_id text NOT NULL REFERENCES chat_service.analysis_session(analysis_id)
    ON DELETE CASCADE,
  revision_id text NOT NULL,
  run_id text NOT NULL,
  tool_call_id text NOT NULL CHECK (
    char_length(tool_call_id) BETWEEN 1 AND 256
    AND tool_call_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  node_id text NOT NULL CHECK (
    char_length(node_id) BETWEEN 1 AND 256
    AND node_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  descriptor_json jsonb NOT NULL CHECK (
    jsonb_typeof(descriptor_json) = 'object'
    AND octet_length(descriptor_json::text) <= 1048576
  ),
  descriptor_hash text NOT NULL CHECK (
    descriptor_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (analysis_id, tool_call_id),
  UNIQUE (analysis_id, revision_id, node_id),
  FOREIGN KEY (revision_id, analysis_id)
    REFERENCES chat_service.analysis_revision(revision_id, analysis_id)
    ON DELETE CASCADE,
  FOREIGN KEY (run_id, revision_id, analysis_id)
    REFERENCES chat_service.analysis_run(run_id, revision_id, analysis_id)
  ON DELETE CASCADE
);

ALTER TABLE chat_service.analysis_intervention
  ADD CONSTRAINT analysis_intervention_identity_unique
  UNIQUE (intervention_id, analysis_id);

ALTER TABLE chat_service.analysis_session
  ADD COLUMN mutation_claim_kind text CHECK (
    mutation_claim_kind IS NULL
    OR mutation_claim_kind IN ('PROPOSAL', 'CANCEL', 'INTERVENTION_RESOLUTION')
  ),
  ADD COLUMN mutation_claim_id text CHECK (
    mutation_claim_id IS NULL
    OR (
      char_length(mutation_claim_id) BETWEEN 1 AND 256
      AND mutation_claim_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  ADD COLUMN mutation_claim_token text CHECK (
    mutation_claim_token IS NULL
    OR mutation_claim_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD COLUMN mutation_claimed_at timestamptz,
  ADD CONSTRAINT analysis_session_mutation_claim_complete CHECK (
    num_nonnulls(
      mutation_claim_kind,
      mutation_claim_id,
      mutation_claim_token,
      mutation_claimed_at
    ) IN (0, 4)
  );

CREATE TABLE chat_service.analysis_control_command (
  analysis_id text NOT NULL REFERENCES chat_service.analysis_session(analysis_id)
    ON DELETE CASCADE,
  command_kind text NOT NULL CHECK (
    command_kind IN ('CANCEL', 'INTERVENTION_RESOLUTION')
  ),
  command_id text NOT NULL CHECK (
    char_length(command_id) BETWEEN 1 AND 256
    AND command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 256
  ),
  request_hash text NOT NULL CHECK (
    request_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  claim_token text NOT NULL CHECK (
    claim_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  expected_revision_id text NOT NULL,
  expected_revision_number integer NOT NULL CHECK (
    expected_revision_number >= 0
  ),
  expected_run_id text NOT NULL,
  intervention_id text,
  status text NOT NULL CHECK (
    status IN ('CLAIMED', 'COMPLETED', 'FAILED')
  ),
  result_json jsonb CHECK (
    result_json IS NULL
    OR (
      jsonb_typeof(result_json) = 'object'
      AND octet_length(result_json::text) <= 1048576
    )
  ),
  safe_error_code text CHECK (
    safe_error_code IS NULL
    OR safe_error_code ~ '^[A-Z][A-Z0-9_:-]{0,127}$'
  ),
  safe_error_status integer CHECK (
    safe_error_status IS NULL
    OR safe_error_status IN (400, 403, 404, 409, 410, 422, 503)
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (analysis_id, command_kind, command_id),
  UNIQUE (analysis_id, command_kind, idempotency_key),
  FOREIGN KEY (expected_revision_id, analysis_id)
    REFERENCES chat_service.analysis_revision(revision_id, analysis_id),
  FOREIGN KEY (expected_run_id, expected_revision_id, analysis_id)
    REFERENCES chat_service.analysis_run(run_id, revision_id, analysis_id),
  FOREIGN KEY (intervention_id, analysis_id)
    REFERENCES chat_service.analysis_intervention(intervention_id, analysis_id),
  CHECK ((status = 'COMPLETED') = (result_json IS NOT NULL)),
  CHECK ((status = 'FAILED') = (safe_error_code IS NOT NULL)),
  CHECK ((status = 'FAILED') = (safe_error_status IS NOT NULL)),
  CHECK (
    (command_kind = 'CANCEL' AND intervention_id IS NULL)
    OR
    (command_kind = 'INTERVENTION_RESOLUTION' AND intervention_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX analysis_one_claimed_cancel
  ON chat_service.analysis_control_command(analysis_id)
  WHERE command_kind = 'CANCEL' AND status = 'CLAIMED';

CREATE UNIQUE INDEX analysis_one_claimed_intervention_resolution
  ON chat_service.analysis_control_command(analysis_id, intervention_id)
  WHERE command_kind = 'INTERVENTION_RESOLUTION' AND status = 'CLAIMED';

ALTER TABLE chat_service.analysis_change_proposal
  ADD COLUMN expected_run_id text,
  ADD COLUMN expected_descriptor_hash text CHECK (
    expected_descriptor_hash IS NULL
    OR expected_descriptor_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN control_claim_token text CHECK (
    control_claim_token IS NULL
    OR control_claim_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD COLUMN safe_error_code text CHECK (
    safe_error_code IS NULL
    OR safe_error_code ~ '^[A-Z][A-Z0-9_:-]{0,127}$'
  ),
  ADD COLUMN safe_error_status integer CHECK (
    safe_error_status IS NULL
    OR safe_error_status IN (400, 403, 404, 409, 410, 422, 503)
  ),
  ADD COLUMN control_claimed_at timestamptz;

ALTER TABLE chat_service.analysis_change_proposal
  ADD CONSTRAINT analysis_change_proposal_expected_run_fk
  FOREIGN KEY (expected_run_id, expected_revision_id, analysis_id)
  REFERENCES chat_service.analysis_run(run_id, revision_id, analysis_id);

ALTER TABLE chat_service.analysis_change_proposal
  ADD CONSTRAINT analysis_change_proposal_claim_lineage_complete CHECK (
    num_nonnulls(
      expected_run_id,
      expected_descriptor_hash,
      control_claim_token,
      control_claimed_at
    ) IN (0, 4)
  ),
  ADD CONSTRAINT analysis_change_proposal_safe_error_complete CHECK (
    num_nonnulls(safe_error_code, safe_error_status) IN (0, 2)
  );
