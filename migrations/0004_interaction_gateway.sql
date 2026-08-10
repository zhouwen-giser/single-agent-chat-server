CREATE TABLE chat_service.principal (
  principal_id text PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

INSERT INTO chat_service.principal(principal_id, issuer, subject, role)
SELECT user_id, 'openwebui-jwt', user_id, max(user_role)
FROM chat_service.chat_thread_binding
GROUP BY user_id
ON CONFLICT (issuer, subject) DO UPDATE
SET role = EXCLUDED.role, updated_at = now();

CREATE TABLE chat_service.conversation_thread (
  thread_id text PRIMARY KEY,
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, principal_id)
);

INSERT INTO chat_service.conversation_thread(thread_id, principal_id, created_at, updated_at)
SELECT thread_id, user_id, created_at, updated_at
FROM chat_service.chat_thread_binding
ON CONFLICT (thread_id) DO NOTHING;

CREATE TABLE chat_service.client_thread_binding (
  binding_id text PRIMARY KEY,
  client_type text NOT NULL CHECK (client_type IN ('openwebui', 'ag_ui')),
  external_thread_id text NOT NULL,
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  internal_thread_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_type, principal_id, external_thread_id),
  FOREIGN KEY (internal_thread_id, principal_id)
    REFERENCES chat_service.conversation_thread(thread_id, principal_id)
);

INSERT INTO chat_service.client_thread_binding(
  binding_id, client_type, external_thread_id, principal_id,
  internal_thread_id, created_at, updated_at
)
SELECT 'v01:' || thread_id, 'openwebui', openwebui_chat_id, user_id,
       thread_id, created_at, updated_at
FROM chat_service.chat_thread_binding
ON CONFLICT (client_type, principal_id, external_thread_id) DO NOTHING;

ALTER TABLE chat_service.conversation_task_binding
  ADD COLUMN conversation_thread_id text;

UPDATE chat_service.conversation_task_binding
SET conversation_thread_id = thread_id
WHERE conversation_thread_id IS NULL;

ALTER TABLE chat_service.conversation_task_binding
  ALTER COLUMN conversation_thread_id SET NOT NULL,
  ALTER COLUMN thread_id DROP NOT NULL,
  ADD CONSTRAINT conversation_task_interaction_thread_fk
    FOREIGN KEY (conversation_thread_id)
    REFERENCES chat_service.conversation_thread(thread_id) ON DELETE CASCADE,
  ADD CONSTRAINT conversation_task_interaction_unique
    UNIQUE (conversation_thread_id, sdar_task_id);

DROP INDEX chat_service.conversation_one_active_task_per_thread;

CREATE UNIQUE INDEX conversation_one_active_task_per_thread
  ON chat_service.conversation_task_binding(conversation_thread_id)
  WHERE terminal_at IS NULL;

CREATE TABLE chat_service.interaction_request (
  request_id text PRIMARY KEY,
  protocol text NOT NULL CHECK (protocol IN ('openai', 'ag_ui')),
  external_request_id text NOT NULL,
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  thread_id text NOT NULL REFERENCES chat_service.conversation_thread(thread_id),
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('CLAIMED', 'COMPLETED', 'FAILED')),
  lease_owner text,
  lease_until timestamptz,
  result_task_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (protocol, external_request_id, principal_id, thread_id)
);

INSERT INTO chat_service.interaction_request(
  request_id, protocol, external_request_id, principal_id, thread_id,
  request_hash, status, lease_owner, lease_until, result_task_id,
  created_at, updated_at
)
SELECT 'v01:' || request.idempotency_key || ':' || thread.thread_id,
       'openai', request.idempotency_key, request.user_id, thread.thread_id,
       request.request_hash, request.status, request.lease_owner,
       request.lease_until, request.result_task_id,
       request.created_at, request.updated_at
FROM chat_service.request_idempotency request
JOIN chat_service.chat_thread_binding thread
  ON thread.openwebui_chat_id = request.openwebui_chat_id
 AND thread.user_id = request.user_id
ON CONFLICT (protocol, external_request_id, principal_id, thread_id) DO NOTHING;

CREATE TABLE chat_service.interaction_run (
  run_id text PRIMARY KEY,
  protocol text NOT NULL CHECK (protocol IN ('openai', 'ag_ui')),
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  thread_id text NOT NULL REFERENCES chat_service.conversation_thread(thread_id),
  external_request_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING', 'FINISHED', 'ERROR', 'INTERRUPTED')),
  task_id text,
  context_id text,
  last_sequence bigint NOT NULL DEFAULT -1 CHECK (last_sequence >= -1),
  outcome_json jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX interaction_run_thread_started
  ON chat_service.interaction_run(thread_id, started_at DESC);

CREATE TABLE chat_service.agui_interrupt_binding (
  interrupt_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES chat_service.interaction_run(run_id),
  principal_id text NOT NULL REFERENCES chat_service.principal(principal_id),
  thread_id text NOT NULL REFERENCES chat_service.conversation_thread(thread_id),
  task_id text NOT NULL,
  context_id text NOT NULL,
  internal_phase text NOT NULL CHECK (
    internal_phase IN ('awaiting_plan_confirmation', 'awaiting_user_input', 'paused')
  ),
  input_request_id text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'CANCELLED')),
  resolution_hash text,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX agui_one_open_interrupt_per_task
  ON chat_service.agui_interrupt_binding(principal_id, task_id)
  WHERE status = 'OPEN';

CREATE TABLE chat_service.agent_card_snapshot (
  snapshot_id text PRIMARY KEY,
  content_hash text NOT NULL,
  protocol_version text NOT NULL,
  spec_patch text NOT NULL,
  binding text NOT NULL,
  safe_skills_json jsonb NOT NULL,
  source_url_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_hash, source_url_hash)
);

CREATE INDEX agent_card_snapshot_observed
  ON chat_service.agent_card_snapshot(observed_at DESC);
