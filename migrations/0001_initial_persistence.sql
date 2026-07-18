CREATE TABLE chat_service.chat_thread_binding (
  thread_id text PRIMARY KEY,
  openwebui_chat_id text NOT NULL,
  user_id text NOT NULL,
  user_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (openwebui_chat_id, user_id)
);

CREATE TABLE chat_service.conversation_task_binding (
  binding_id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES chat_service.chat_thread_binding(thread_id) ON DELETE CASCADE,
  sdar_task_id text NOT NULL,
  sdar_context_id text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, sdar_task_id)
);

CREATE TABLE chat_service.request_idempotency (
  idempotency_key text NOT NULL,
  user_id text NOT NULL,
  openwebui_chat_id text NOT NULL,
  request_hash text NOT NULL,
  result_task_id text,
  status text NOT NULL CHECK (status IN ('CLAIMED', 'COMPLETED')),
  lease_owner text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idempotency_key, user_id, openwebui_chat_id)
);
