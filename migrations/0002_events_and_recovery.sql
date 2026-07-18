ALTER TABLE chat_service.conversation_task_binding
  ADD COLUMN pending_input_json jsonb,
  ADD COLUMN last_status_timestamp timestamptz,
  ADD COLUMN last_event_hash text,
  ADD COLUMN terminal_at timestamptz,
  ADD COLUMN version bigint NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX conversation_one_active_task_per_thread
  ON chat_service.conversation_task_binding(thread_id)
  WHERE terminal_at IS NULL;

CREATE INDEX conversation_task_by_sdar_task
  ON chat_service.conversation_task_binding(sdar_task_id);

CREATE TABLE chat_service.a2a_event_cache (
  event_id text PRIMARY KEY,
  task_id text NOT NULL,
  event_kind text NOT NULL,
  event_hash text NOT NULL,
  status text NOT NULL,
  summary_json jsonb NOT NULL,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, event_hash)
);

CREATE INDEX a2a_event_cache_task_received
  ON chat_service.a2a_event_cache(task_id, received_at);
