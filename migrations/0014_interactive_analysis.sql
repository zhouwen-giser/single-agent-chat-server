CREATE TABLE chat_service.analysis_session (
  analysis_id text PRIMARY KEY CHECK (
    char_length(analysis_id) BETWEEN 1 AND 256
    AND analysis_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  thread_id text NOT NULL,
  grounding_id text NOT NULL CHECK (
    char_length(grounding_id) BETWEEN 1 AND 256
    AND grounding_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 512),
  autonomy_mode text NOT NULL CHECK (
    autonomy_mode IN ('OBSERVER', 'ADVISORY', 'INTERVENTION')
  ),
  status text NOT NULL CHECK (
    status IN ('ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED')
  ),
  active_revision_id text NOT NULL,
  latest_revision_number integer NOT NULL CHECK (latest_revision_number >= 0),
  observer_policy_hash text NOT NULL CHECK (
    observer_policy_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (analysis_id, principal_id, thread_id),
  FOREIGN KEY (thread_id, principal_id)
    REFERENCES chat_service.conversation_thread(thread_id, principal_id)
    ON DELETE CASCADE
);

CREATE TABLE chat_service.analysis_revision (
  revision_id text PRIMARY KEY CHECK (
    char_length(revision_id) BETWEEN 1 AND 256
    AND revision_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  analysis_id text NOT NULL REFERENCES chat_service.analysis_session(analysis_id)
    ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number >= 0),
  parent_revision_id text,
  parent_run_id text,
  cause text NOT NULL CHECK (
    cause IN (
      'INITIAL_QUERY',
      'USER_PROPOSAL',
      'USER_INTERVENTION',
      'AMBIGUITY_RESOLUTION',
      'SOURCE_ADVANCED',
      'AUTOMATIC_RETRY'
    )
  ),
  wsgs_plan_id text NOT NULL CHECK (
    char_length(wsgs_plan_id) BETWEEN 1 AND 256
    AND wsgs_plan_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  plan_hash text NOT NULL CHECK (plan_hash ~ '^sha256:[0-9a-f]{64}$'),
  changed_paths_json jsonb NOT NULL CHECK (
    jsonb_typeof(changed_paths_json) = 'array'
    AND jsonb_array_length(changed_paths_json) <= 128
  ),
  reused_node_ids_json jsonb NOT NULL CHECK (
    jsonb_typeof(reused_node_ids_json) = 'array'
    AND jsonb_array_length(reused_node_ids_json) <= 256
  ),
  invalidated_node_ids_json jsonb NOT NULL CHECK (
    jsonb_typeof(invalidated_node_ids_json) = 'array'
    AND jsonb_array_length(invalidated_node_ids_json) <= 256
  ),
  rerun_node_ids_json jsonb NOT NULL CHECK (
    jsonb_typeof(rerun_node_ids_json) = 'array'
    AND jsonb_array_length(rerun_node_ids_json) <= 256
  ),
  status text NOT NULL CHECK (
    status IN (
      'COMPILING',
      'READY',
      'QUEUED',
      'RUNNING',
      'SUPERSEDED',
      'COMPLETED',
      'PARTIAL',
      'FAILED'
    )
  ),
  created_at timestamptz NOT NULL,
  UNIQUE (analysis_id, revision_number),
  UNIQUE (revision_id, analysis_id),
  FOREIGN KEY (parent_revision_id, analysis_id)
    REFERENCES chat_service.analysis_revision(revision_id, analysis_id)
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE chat_service.analysis_session
  ADD CONSTRAINT analysis_session_active_revision_fk
  FOREIGN KEY (active_revision_id, analysis_id)
  REFERENCES chat_service.analysis_revision(revision_id, analysis_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE chat_service.analysis_run (
  run_id text PRIMARY KEY CHECK (
    char_length(run_id) BETWEEN 1 AND 256
    AND run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  analysis_id text NOT NULL REFERENCES chat_service.analysis_session(analysis_id)
    ON DELETE CASCADE,
  revision_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  parent_run_id text,
  upstream_run_id text CHECK (
    upstream_run_id IS NULL
    OR (
      char_length(upstream_run_id) BETWEEN 1 AND 256
      AND upstream_run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  status text NOT NULL CHECK (
    status IN (
      'STARTING',
      'RUNNING',
      'WAITING_INTERVENTION',
      'SUCCEEDED',
      'PARTIAL',
      'FAILED',
      'CANCEL_REQUESTED',
      'CANCELLED'
    )
  ),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  UNIQUE (revision_id, attempt),
  UNIQUE (run_id, analysis_id),
  UNIQUE (run_id, revision_id, analysis_id),
  FOREIGN KEY (revision_id, analysis_id)
    REFERENCES chat_service.analysis_revision(revision_id, analysis_id)
    ON DELETE CASCADE,
  FOREIGN KEY (parent_run_id, analysis_id)
    REFERENCES chat_service.analysis_run(run_id, analysis_id)
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE chat_service.analysis_revision
  ADD CONSTRAINT analysis_revision_parent_run_fk
  FOREIGN KEY (parent_run_id, analysis_id)
  REFERENCES chat_service.analysis_run(run_id, analysis_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE chat_service.analysis_event (
  event_id text PRIMARY KEY CHECK (
    char_length(event_id) BETWEEN 1 AND 256
    AND event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  analysis_id text NOT NULL REFERENCES chat_service.analysis_session(analysis_id)
    ON DELETE CASCADE,
  revision_id text NOT NULL,
  run_id text NOT NULL,
  analysis_sequence bigint NOT NULL CHECK (analysis_sequence >= 1),
  run_sequence bigint NOT NULL CHECK (run_sequence >= 1),
  upstream_sequence bigint CHECK (upstream_sequence >= 1),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 128),
  node_id text CHECK (
    node_id IS NULL
    OR (
      char_length(node_id) BETWEEN 1 AND 256
      AND node_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  correlation_id text NOT NULL CHECK (
    char_length(correlation_id) BETWEEN 1 AND 256
    AND correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  causation_id text CHECK (
    causation_id IS NULL
    OR (
      char_length(causation_id) BETWEEN 1 AND 256
      AND causation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  occurred_at timestamptz NOT NULL,
  payload_json jsonb NOT NULL CHECK (
    jsonb_typeof(payload_json) = 'object'
    AND octet_length(payload_json::text) <= 4194304
  ),
  payload_hash text NOT NULL CHECK (
    payload_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, analysis_sequence),
  UNIQUE (run_id, run_sequence),
  UNIQUE (run_id, upstream_sequence),
  FOREIGN KEY (revision_id, analysis_id)
    REFERENCES chat_service.analysis_revision(revision_id, analysis_id),
  FOREIGN KEY (run_id, revision_id, analysis_id)
    REFERENCES chat_service.analysis_run(run_id, revision_id, analysis_id)
);

CREATE INDEX analysis_event_recovery
  ON chat_service.analysis_event(analysis_id, analysis_sequence);

CREATE TABLE chat_service.analysis_projection (
  analysis_id text PRIMARY KEY REFERENCES chat_service.analysis_session(analysis_id)
    ON DELETE CASCADE,
  state_revision bigint NOT NULL CHECK (state_revision >= 0),
  activity_revision bigint NOT NULL CHECK (activity_revision >= 0),
  state_json jsonb NOT NULL CHECK (
    jsonb_typeof(state_json) = 'object'
    AND octet_length(state_json::text) <= 4194304
  ),
  state_hash text NOT NULL CHECK (state_hash ~ '^sha256:[0-9a-f]{64}$'),
  activity_json jsonb NOT NULL CHECK (
    jsonb_typeof(activity_json) = 'object'
    AND octet_length(activity_json::text) <= 2097152
  ),
  activity_hash text NOT NULL CHECK (
    activity_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  last_event_sequence bigint NOT NULL CHECK (last_event_sequence >= 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE chat_service.analysis_change_proposal (
  proposal_id text PRIMARY KEY CHECK (
    char_length(proposal_id) BETWEEN 1 AND 256
    AND proposal_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  command_id text NOT NULL CHECK (
    char_length(command_id) BETWEEN 1 AND 256
    AND command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  analysis_id text NOT NULL REFERENCES chat_service.analysis_session(analysis_id)
    ON DELETE CASCADE,
  expected_revision_id text NOT NULL,
  expected_revision_number integer NOT NULL CHECK (expected_revision_number >= 0),
  target_node_id text NOT NULL CHECK (
    char_length(target_node_id) BETWEEN 1 AND 256
    AND target_node_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  public_args_hash text NOT NULL CHECK (
    public_args_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  edit_schema_hash text NOT NULL CHECK (
    edit_schema_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  patch_json jsonb NOT NULL CHECK (
    jsonb_typeof(patch_json) = 'array'
    AND jsonb_array_length(patch_json) BETWEEN 1 AND 64
  ),
  mode text NOT NULL CHECK (
    mode IN ('SUGGEST_NEXT_REVISION', 'INTERRUPT_AND_APPLY')
  ),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 256
  ),
  request_hash text NOT NULL CHECK (
    request_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  status text NOT NULL CHECK (
    status IN (
      'SUBMITTED',
      'VALIDATING',
      'REJECTED',
      'CONFLICT',
      'ACCEPTED',
      'COMPILING',
      'COMPILE_FAILED',
      'COMPILED',
      'APPLIED'
    )
  ),
  created_at timestamptz NOT NULL,
  applied_revision_id text,
  UNIQUE (analysis_id, command_id),
  UNIQUE (analysis_id, idempotency_key),
  FOREIGN KEY (expected_revision_id, analysis_id)
    REFERENCES chat_service.analysis_revision(revision_id, analysis_id),
  FOREIGN KEY (applied_revision_id, analysis_id)
    REFERENCES chat_service.analysis_revision(revision_id, analysis_id)
);

CREATE UNIQUE INDEX analysis_one_pending_proposal
  ON chat_service.analysis_change_proposal(analysis_id)
  WHERE status IN ('SUBMITTED', 'VALIDATING', 'ACCEPTED', 'COMPILING');

CREATE TABLE chat_service.analysis_intervention (
  intervention_id text PRIMARY KEY CHECK (
    char_length(intervention_id) BETWEEN 1 AND 256
    AND intervention_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  analysis_id text NOT NULL REFERENCES chat_service.analysis_session(analysis_id)
    ON DELETE CASCADE,
  revision_id text NOT NULL,
  run_id text NOT NULL,
  interrupt_id text NOT NULL CHECK (
    char_length(interrupt_id) BETWEEN 1 AND 256
    AND interrupt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  reason text NOT NULL CHECK (
    reason IN ('AMBIGUITY', 'PERMISSION', 'HIGH_RISK', 'BUDGET', 'USER_REQUESTED')
  ),
  status text NOT NULL CHECK (
    status IN ('OPEN', 'RESOLVED', 'EXPIRED', 'CANCELLED')
  ),
  request_payload_json jsonb NOT NULL CHECK (
    jsonb_typeof(request_payload_json) = 'object'
    AND octet_length(request_payload_json::text) <= 1048576
  ),
  request_hash text NOT NULL CHECK (
    request_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  response_payload_json jsonb CHECK (
    response_payload_json IS NULL
    OR (
      jsonb_typeof(response_payload_json) = 'object'
      AND octet_length(response_payload_json::text) <= 1048576
    )
  ),
  response_hash text CHECK (
    response_hash IS NULL
    OR response_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  UNIQUE (analysis_id, interrupt_id),
  FOREIGN KEY (revision_id, analysis_id)
    REFERENCES chat_service.analysis_revision(revision_id, analysis_id),
  FOREIGN KEY (run_id, revision_id, analysis_id)
    REFERENCES chat_service.analysis_run(run_id, revision_id, analysis_id),
  CHECK ((response_payload_json IS NULL) = (response_hash IS NULL)),
  CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);

CREATE FUNCTION chat_service.reject_analysis_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'analysis events are append-only';
END
$$;

CREATE TRIGGER analysis_event_no_update
BEFORE UPDATE ON chat_service.analysis_event
FOR EACH ROW
EXECUTE FUNCTION chat_service.reject_analysis_event_mutation();

CREATE TRIGGER analysis_event_no_delete
BEFORE DELETE ON chat_service.analysis_event
FOR EACH ROW
EXECUTE FUNCTION chat_service.reject_analysis_event_mutation();

CREATE FUNCTION chat_service.enforce_analysis_revision_definition_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.revision_id,
    NEW.analysis_id,
    NEW.revision_number,
    NEW.parent_revision_id,
    NEW.parent_run_id,
    NEW.cause,
    NEW.wsgs_plan_id,
    NEW.plan_hash,
    NEW.changed_paths_json,
    NEW.reused_node_ids_json,
    NEW.invalidated_node_ids_json,
    NEW.rerun_node_ids_json,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.revision_id,
    OLD.analysis_id,
    OLD.revision_number,
    OLD.parent_revision_id,
    OLD.parent_run_id,
    OLD.cause,
    OLD.wsgs_plan_id,
    OLD.plan_hash,
    OLD.changed_paths_json,
    OLD.reused_node_ids_json,
    OLD.invalidated_node_ids_json,
    OLD.rerun_node_ids_json,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'analysis revision definitions are immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER analysis_revision_definition_guard
BEFORE UPDATE ON chat_service.analysis_revision
FOR EACH ROW
EXECUTE FUNCTION chat_service.enforce_analysis_revision_definition_immutable();
