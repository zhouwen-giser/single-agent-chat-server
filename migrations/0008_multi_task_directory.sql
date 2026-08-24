DROP INDEX IF EXISTS chat_service.conversation_one_active_task_per_thread;

ALTER TABLE chat_service.conversation_task_binding
  ADD COLUMN short_id text,
  ADD COLUMN last_interacted_at timestamptz,
  ADD COLUMN interaction_lease_owner text,
  ADD COLUMN interaction_lease_until timestamptz;

UPDATE chat_service.conversation_task_binding
SET short_id = left(sdar_task_id, 39) || '-' || substring(md5(sdar_task_id), 1, 16)
WHERE short_id IS NULL;

ALTER TABLE chat_service.conversation_task_binding
  ALTER COLUMN short_id SET NOT NULL,
  ADD CONSTRAINT conversation_task_short_id_length
    CHECK (char_length(short_id) BETWEEN 1 AND 64),
  ADD CONSTRAINT conversation_task_thread_binding_unique
    UNIQUE (conversation_thread_id, binding_id),
  ADD CONSTRAINT conversation_task_thread_short_id_unique
    UNIQUE (conversation_thread_id, short_id);

CREATE INDEX conversation_task_active_directory
  ON chat_service.conversation_task_binding(
    conversation_thread_id,
    last_interacted_at DESC NULLS LAST,
    created_at DESC,
    sdar_task_id ASC
  )
  WHERE terminal_at IS NULL;

CREATE INDEX conversation_task_recent_terminal_directory
  ON chat_service.conversation_task_binding(
    conversation_thread_id,
    last_interacted_at DESC NULLS LAST,
    created_at DESC,
    sdar_task_id ASC
  )
  WHERE terminal_at IS NOT NULL;

CREATE INDEX conversation_task_expired_interaction_lease
  ON chat_service.conversation_task_binding(interaction_lease_until)
  WHERE interaction_lease_until IS NOT NULL;

CREATE TABLE chat_service.conversation_task_focus (
  conversation_thread_id text PRIMARY KEY
    REFERENCES chat_service.conversation_thread(thread_id) ON DELETE CASCADE,
  binding_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_thread_id, binding_id)
    REFERENCES chat_service.conversation_task_binding(
      conversation_thread_id, binding_id
    ) ON DELETE CASCADE
);

CREATE TABLE chat_service.conversation_task_reference (
  conversation_thread_id text PRIMARY KEY
    REFERENCES chat_service.conversation_thread(thread_id) ON DELETE CASCADE,
  binding_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_thread_id, binding_id)
    REFERENCES chat_service.conversation_task_binding(
      conversation_thread_id, binding_id
    ) ON DELETE CASCADE
);
