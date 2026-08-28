CREATE TABLE chat_service.conversation_world_focus (
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  thread_id text NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_grounding_id text CHECK (
    last_grounding_id IS NULL
    OR char_length(last_grounding_id) BETWEEN 1 AND 256
  ),
  last_grounding_result_hash text CHECK (
    last_grounding_result_hash IS NULL
    OR last_grounding_result_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, thread_id),
  FOREIGN KEY (thread_id, principal_id)
    REFERENCES chat_service.conversation_thread(thread_id, principal_id)
    ON DELETE CASCADE,
  CHECK (
    (last_grounding_id IS NULL) = (last_grounding_result_hash IS NULL)
  )
);

CREATE TABLE chat_service.conversation_world_reference (
  principal_id text NOT NULL,
  thread_id text NOT NULL,
  reference_identity_hash text NOT NULL CHECK (
    reference_identity_hash ~ '^[0-9a-f]{64}$'
  ),
  reference_key_json jsonb NOT NULL CHECK (
    jsonb_typeof(reference_key_json) = 'object'
  ),
  product_id text NOT NULL CHECK (char_length(product_id) BETWEEN 1 AND 256),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 512),
  reference_type text NOT NULL CHECK (
    char_length(reference_type) BETWEEN 1 AND 128
  ),
  source_message_id text NOT NULL CHECK (
    char_length(source_message_id) BETWEEN 1 AND 256
  ),
  source_grounding_id text NOT NULL CHECK (
    char_length(source_grounding_id) BETWEEN 1 AND 256
  ),
  source_result_hash text NOT NULL CHECK (
    source_result_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  source_world_version bigint NOT NULL CHECK (source_world_version >= 0),
  valid_until timestamptz,
  revalidation_required boolean NOT NULL,
  status text NOT NULL CHECK (
    status IN ('VALID', 'STALE', 'EXPIRED', 'UNKNOWN')
  ),
  last_used_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, thread_id, reference_identity_hash),
  FOREIGN KEY (principal_id, thread_id)
    REFERENCES chat_service.conversation_world_focus(principal_id, thread_id)
    ON DELETE CASCADE
);

CREATE INDEX conversation_world_reference_usage
  ON chat_service.conversation_world_reference(
    principal_id, thread_id, last_used_at DESC
  );

CREATE TABLE chat_service.pending_grounding_choice (
  choice_id text PRIMARY KEY CHECK (char_length(choice_id) BETWEEN 1 AND 256),
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  thread_id text NOT NULL,
  origin_message_id text NOT NULL CHECK (
    char_length(origin_message_id) BETWEEN 1 AND 256
  ),
  origin_grounding_id text NOT NULL CHECK (
    char_length(origin_grounding_id) BETWEEN 1 AND 256
  ),
  origin_result_hash text NOT NULL CHECK (
    origin_result_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  origin_turn_plan_json jsonb NOT NULL CHECK (
    jsonb_typeof(origin_turn_plan_json) = 'object'
  ),
  origin_request_plan_json jsonb NOT NULL CHECK (
    jsonb_typeof(origin_request_plan_json) = 'object'
  ),
  mention_id text NOT NULL CHECK (char_length(mention_id) BETWEEN 1 AND 256),
  surface_text text NOT NULL CHECK (char_length(surface_text) BETWEEN 1 AND 512),
  candidate_products_json jsonb NOT NULL CHECK (
    jsonb_typeof(candidate_products_json) = 'array'
    AND jsonb_array_length(candidate_products_json) BETWEEN 2 AND 20
  ),
  status text NOT NULL CHECK (
    status IN ('OPEN', 'SELECTED', 'EXPIRED', 'CANCELLED')
  ),
  selected_product_id text CHECK (
    selected_product_id IS NULL
    OR char_length(selected_product_id) BETWEEN 1 AND 256
  ),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (thread_id, principal_id)
    REFERENCES chat_service.conversation_thread(thread_id, principal_id)
    ON DELETE CASCADE,
  CHECK (
    (status = 'SELECTED') = (selected_product_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX pending_grounding_choice_one_open
  ON chat_service.pending_grounding_choice(principal_id, thread_id)
  WHERE status = 'OPEN';

CREATE FUNCTION chat_service.enforce_world_focus_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.principal_id,
    NEW.thread_id,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.principal_id,
    OLD.thread_id,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'world focus identity fields cannot change';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'world focus revision must increase by exactly one';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER conversation_world_focus_update_guard
BEFORE UPDATE ON chat_service.conversation_world_focus
FOR EACH ROW
EXECUTE FUNCTION chat_service.enforce_world_focus_update();

CREATE FUNCTION chat_service.enforce_pending_grounding_choice_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.choice_id,
    NEW.principal_id,
    NEW.thread_id,
    NEW.origin_message_id,
    NEW.origin_grounding_id,
    NEW.origin_result_hash,
    NEW.origin_turn_plan_json,
    NEW.origin_request_plan_json,
    NEW.mention_id,
    NEW.surface_text,
    NEW.candidate_products_json,
    NEW.expires_at,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.choice_id,
    OLD.principal_id,
    OLD.thread_id,
    OLD.origin_message_id,
    OLD.origin_grounding_id,
    OLD.origin_result_hash,
    OLD.origin_turn_plan_json,
    OLD.origin_request_plan_json,
    OLD.mention_id,
    OLD.surface_text,
    OLD.candidate_products_json,
    OLD.expires_at,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'pending grounding choice immutable fields cannot change';
  END IF;
  IF OLD.status <> 'OPEN' THEN
    RAISE EXCEPTION 'closed pending grounding choices cannot change';
  END IF;
  IF NEW.status NOT IN ('SELECTED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'invalid pending grounding choice transition';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER pending_grounding_choice_update_guard
BEFORE UPDATE ON chat_service.pending_grounding_choice
FOR EACH ROW
EXECUTE FUNCTION chat_service.enforce_pending_grounding_choice_update();
