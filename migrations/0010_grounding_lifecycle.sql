ALTER TABLE chat_service.interaction_request
  ADD CONSTRAINT interaction_request_grounding_identity_unique
  UNIQUE (request_id, principal_id, thread_id);

CREATE TABLE chat_service.grounding_execution (
  grounding_id text PRIMARY KEY CHECK (
    char_length(grounding_id) BETWEEN 1 AND 256
  ),
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  thread_id text NOT NULL REFERENCES chat_service.conversation_thread(thread_id),
  interaction_request_id text NOT NULL,
  wsgs_request_id text NOT NULL UNIQUE CHECK (
    char_length(wsgs_request_id) BETWEEN 1 AND 256
  ),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 256
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  wsgs_operation text NOT NULL CHECK (
    wsgs_operation IN (
      'GROUND_REFERENCES',
      'COMPILE_WORLD_QUERY',
      'EXECUTE_WORLD_QUERY',
      'VALIDATE_REFERENCES'
    )
  ),
  requested_products_json jsonb NOT NULL CHECK (
    jsonb_typeof(requested_products_json) = 'array'
    AND jsonb_array_length(requested_products_json) BETWEEN 1 AND 16
  ),
  context_usage_json jsonb NOT NULL CHECK (
    jsonb_typeof(context_usage_json) = 'object'
  ),
  state text NOT NULL CHECK (
    state IN (
      'GROUNDING_PENDING',
      'GROUNDING_READY',
      'SDAR_SUBMISSION_RESERVED',
      'SDAR_SUBMITTED',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    )
  ),
  wsgs_grounding_id text CHECK (
    wsgs_grounding_id IS NULL
    OR char_length(wsgs_grounding_id) BETWEEN 1 AND 256
  ),
  grounding_result_hash text CHECK (
    grounding_result_hash IS NULL
    OR grounding_result_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  grounding_result_json jsonb,
  operational_bundle_hash text CHECK (
    operational_bundle_hash IS NULL
    OR operational_bundle_hash ~ '^[0-9a-f]{64}$'
  ),
  operational_bundle_json jsonb,
  sdar_submission_key text CHECK (
    sdar_submission_key IS NULL
    OR char_length(sdar_submission_key) BETWEEN 1 AND 256
  ),
  sdar_task_id text CHECK (
    sdar_task_id IS NULL OR char_length(sdar_task_id) BETWEEN 1 AND 256
  ),
  sdar_context_id text CHECK (
    sdar_context_id IS NULL OR char_length(sdar_context_id) BETWEEN 1 AND 256
  ),
  failure_code text CHECK (
    failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 128
  ),
  lease_owner text CHECK (
    lease_owner IS NULL OR char_length(lease_owner) BETWEEN 1 AND 256
  ),
  lease_until timestamptz,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz,
  FOREIGN KEY (interaction_request_id, principal_id, thread_id)
    REFERENCES chat_service.interaction_request(
      request_id, principal_id, thread_id
    ),
  UNIQUE (principal_id, thread_id, idempotency_key),
  CHECK (
    (lease_owner IS NULL AND lease_until IS NULL)
    OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL)
  ),
  CHECK (
    (grounding_result_hash IS NULL AND grounding_result_json IS NULL)
    OR (grounding_result_hash IS NOT NULL AND grounding_result_json IS NOT NULL)
  ),
  CHECK (
    (operational_bundle_hash IS NULL AND operational_bundle_json IS NULL)
    OR (operational_bundle_hash IS NOT NULL AND operational_bundle_json IS NOT NULL)
  ),
  CHECK (
    state <> 'GROUNDING_PENDING'
    OR (
      grounding_result_hash IS NULL
      AND operational_bundle_hash IS NULL
      AND sdar_submission_key IS NULL
      AND sdar_task_id IS NULL
      AND sdar_context_id IS NULL
      AND terminal_at IS NULL
    )
  ),
  CHECK (
    state NOT IN (
      'GROUNDING_READY',
      'SDAR_SUBMISSION_RESERVED',
      'SDAR_SUBMITTED',
      'COMPLETED'
    )
    OR (
      wsgs_grounding_id IS NOT NULL
      AND grounding_result_hash IS NOT NULL
    )
  ),
  CHECK (
    state <> 'GROUNDING_READY'
    OR (
      operational_bundle_hash IS NULL
      AND sdar_submission_key IS NULL
      AND sdar_task_id IS NULL
      AND sdar_context_id IS NULL
      AND terminal_at IS NULL
    )
  ),
  CHECK (
    state <> 'SDAR_SUBMISSION_RESERVED'
    OR (
      operational_bundle_hash IS NOT NULL
      AND sdar_submission_key IS NOT NULL
      AND sdar_task_id IS NULL
      AND sdar_context_id IS NULL
      AND terminal_at IS NULL
    )
  ),
  CHECK (
    state <> 'SDAR_SUBMITTED'
    OR (
      operational_bundle_hash IS NOT NULL
      AND sdar_submission_key IS NOT NULL
      AND sdar_task_id IS NOT NULL
      AND sdar_context_id IS NOT NULL
      AND terminal_at IS NULL
    )
  ),
  CHECK (
    (state IN ('COMPLETED', 'FAILED', 'CANCELLED')) = (terminal_at IS NOT NULL)
  ),
  CHECK (
    (state = 'FAILED') = (failure_code IS NOT NULL)
  ),
  CHECK (
    state NOT IN (
      'GROUNDING_READY',
      'SDAR_SUBMITTED',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    )
    OR (lease_owner IS NULL AND lease_until IS NULL)
  )
);

CREATE UNIQUE INDEX grounding_execution_sdar_submission_key
  ON chat_service.grounding_execution(sdar_submission_key)
  WHERE sdar_submission_key IS NOT NULL;

CREATE INDEX grounding_execution_recovery
  ON chat_service.grounding_execution(state, lease_until, created_at)
  WHERE state IN ('GROUNDING_PENDING', 'SDAR_SUBMISSION_RESERVED');

CREATE TABLE chat_service.grounding_event (
  event_id text PRIMARY KEY CHECK (char_length(event_id) BETWEEN 1 AND 256),
  grounding_id text NOT NULL
    REFERENCES chat_service.grounding_execution(grounding_id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  event_kind text NOT NULL CHECK (char_length(event_kind) BETWEEN 1 AND 128),
  from_state text,
  to_state text NOT NULL,
  event_hash text NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(payload_json) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grounding_id, sequence),
  UNIQUE (grounding_id, event_hash),
  CHECK (
    from_state IS NULL
    OR from_state IN (
      'GROUNDING_PENDING',
      'GROUNDING_READY',
      'SDAR_SUBMISSION_RESERVED',
      'SDAR_SUBMITTED',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    )
  ),
  CHECK (
    to_state IN (
      'GROUNDING_PENDING',
      'GROUNDING_READY',
      'SDAR_SUBMISSION_RESERVED',
      'SDAR_SUBMITTED',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    )
  )
);

CREATE FUNCTION chat_service.enforce_grounding_execution_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.grounding_id,
    NEW.principal_id,
    NEW.thread_id,
    NEW.interaction_request_id,
    NEW.wsgs_request_id,
    NEW.idempotency_key,
    NEW.request_hash,
    NEW.wsgs_operation,
    NEW.requested_products_json,
    NEW.context_usage_json,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.grounding_id,
    OLD.principal_id,
    OLD.thread_id,
    OLD.interaction_request_id,
    OLD.wsgs_request_id,
    OLD.idempotency_key,
    OLD.request_hash,
    OLD.wsgs_operation,
    OLD.requested_products_json,
    OLD.context_usage_json,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'grounding immutable request fields cannot change';
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'grounding version must increase by exactly one';
  END IF;

  IF OLD.state IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'terminal grounding rows cannot change';
  END IF;

  IF (
    OLD.wsgs_grounding_id IS NOT NULL
    AND NEW.wsgs_grounding_id IS DISTINCT FROM OLD.wsgs_grounding_id
  ) OR (
    OLD.grounding_result_hash IS NOT NULL
    AND NEW.grounding_result_hash IS DISTINCT FROM OLD.grounding_result_hash
  ) OR (
    OLD.grounding_result_json IS NOT NULL
    AND NEW.grounding_result_json IS DISTINCT FROM OLD.grounding_result_json
  ) OR (
    OLD.operational_bundle_hash IS NOT NULL
    AND NEW.operational_bundle_hash IS DISTINCT FROM OLD.operational_bundle_hash
  ) OR (
    OLD.operational_bundle_json IS NOT NULL
    AND NEW.operational_bundle_json IS DISTINCT FROM OLD.operational_bundle_json
  ) OR (
    OLD.sdar_submission_key IS NOT NULL
    AND NEW.sdar_submission_key IS DISTINCT FROM OLD.sdar_submission_key
  ) OR (
    OLD.sdar_task_id IS NOT NULL
    AND NEW.sdar_task_id IS DISTINCT FROM OLD.sdar_task_id
  ) OR (
    OLD.sdar_context_id IS NOT NULL
    AND NEW.sdar_context_id IS DISTINCT FROM OLD.sdar_context_id
  ) THEN
    RAISE EXCEPTION 'grounding durable outputs cannot change once recorded';
  END IF;

  IF NEW.state = OLD.state AND (
    NEW.wsgs_grounding_id,
    NEW.grounding_result_hash,
    NEW.grounding_result_json,
    NEW.operational_bundle_hash,
    NEW.operational_bundle_json,
    NEW.sdar_submission_key,
    NEW.sdar_task_id,
    NEW.sdar_context_id,
    NEW.failure_code,
    NEW.terminal_at
  ) IS DISTINCT FROM (
    OLD.wsgs_grounding_id,
    OLD.grounding_result_hash,
    OLD.grounding_result_json,
    OLD.operational_bundle_hash,
    OLD.operational_bundle_json,
    OLD.sdar_submission_key,
    OLD.sdar_task_id,
    OLD.sdar_context_id,
    OLD.failure_code,
    OLD.terminal_at
  ) THEN
    RAISE EXCEPTION 'same-state grounding updates may change only the lease';
  END IF;

  IF NEW.state <> OLD.state AND NOT (
    (OLD.state = 'GROUNDING_PENDING' AND NEW.state IN (
      'GROUNDING_READY', 'FAILED', 'CANCELLED'
    ))
    OR (OLD.state = 'GROUNDING_READY' AND NEW.state IN (
      'SDAR_SUBMISSION_RESERVED', 'COMPLETED', 'FAILED', 'CANCELLED'
    ))
    OR (OLD.state = 'SDAR_SUBMISSION_RESERVED' AND NEW.state IN (
      'SDAR_SUBMITTED', 'FAILED', 'CANCELLED'
    ))
    OR (OLD.state = 'SDAR_SUBMITTED' AND NEW.state IN (
      'COMPLETED', 'FAILED', 'CANCELLED'
    ))
  ) THEN
    RAISE EXCEPTION 'invalid grounding state transition: % -> %',
      OLD.state, NEW.state;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER grounding_execution_update_guard
BEFORE UPDATE ON chat_service.grounding_execution
FOR EACH ROW
EXECUTE FUNCTION chat_service.enforce_grounding_execution_update();

CREATE FUNCTION chat_service.reject_grounding_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND NOT EXISTS (
    SELECT 1 FROM chat_service.grounding_event
  ) THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'grounding events are append-only';
END
$$;

CREATE TRIGGER grounding_event_no_update
BEFORE UPDATE ON chat_service.grounding_event
FOR EACH ROW
EXECUTE FUNCTION chat_service.reject_grounding_event_mutation();

CREATE TRIGGER grounding_event_no_delete
BEFORE DELETE ON chat_service.grounding_event
FOR EACH ROW
EXECUTE FUNCTION chat_service.reject_grounding_event_mutation();

CREATE TRIGGER grounding_event_no_truncate
BEFORE TRUNCATE ON chat_service.grounding_event
FOR EACH STATEMENT
EXECUTE FUNCTION chat_service.reject_grounding_event_mutation();
