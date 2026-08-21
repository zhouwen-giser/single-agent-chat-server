ALTER TABLE chat_service.conversation_thread
  ADD COLUMN next_message_sequence bigint NOT NULL DEFAULT 1
    CHECK (next_message_sequence >= 1);

CREATE TABLE chat_service.conversation_message (
  message_id text PRIMARY KEY,
  thread_id text NOT NULL
    REFERENCES chat_service.conversation_thread(thread_id) ON DELETE CASCADE,
  protocol text NOT NULL CHECK (protocol IN ('openai', 'ag_ui')),
  external_message_id text NOT NULL CHECK (
    char_length(external_message_id) BETWEEN 1 AND 512
  ),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content_text text NOT NULL CHECK (
    char_length(content_text) BETWEEN 1 AND 1000000
  ),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  request_id text CHECK (
    request_id IS NULL OR char_length(request_id) BETWEEN 1 AND 512
  ),
  task_id text CHECK (
    task_id IS NULL OR char_length(task_id) BETWEEN 1 AND 512
  ),
  sequence bigint NOT NULL CHECK (sequence >= 1),
  truncated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (protocol, thread_id, external_message_id),
  UNIQUE (thread_id, sequence)
);

CREATE INDEX conversation_message_thread_recent
  ON chat_service.conversation_message(thread_id, sequence DESC);

CREATE INDEX conversation_message_task
  ON chat_service.conversation_message(thread_id, task_id, sequence)
  WHERE task_id IS NOT NULL;

CREATE TABLE chat_service.conversation_summary (
  thread_id text PRIMARY KEY
    REFERENCES chat_service.conversation_thread(thread_id) ON DELETE CASCADE,
  summary_text text NOT NULL CHECK (
    char_length(summary_text) BETWEEN 1 AND 60000
  ),
  summarized_through_sequence bigint NOT NULL CHECK (
    summarized_through_sequence >= 0
  ),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
