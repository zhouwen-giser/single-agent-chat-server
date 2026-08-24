ALTER TABLE chat_service.interaction_request
  ADD COLUMN result_kind text,
  ADD COLUMN result_context_id text,
  ADD COLUMN result_message_id text,
  ADD COLUMN result_related_task_id text,
  ADD COLUMN result_message_json jsonb,
  ADD COLUMN result_rendered_text text,
  ADD COLUMN result_hash text;

UPDATE chat_service.interaction_request request
SET result_kind = 'TASK',
    result_context_id = binding.sdar_context_id,
    result_hash = md5(jsonb_build_object(
      'kind', 'task',
      'taskId', request.result_task_id,
      'contextId', binding.sdar_context_id
    )::text)
FROM chat_service.conversation_task_binding binding
WHERE request.status = 'COMPLETED'
  AND request.result_task_id IS NOT NULL
  AND binding.conversation_thread_id = request.thread_id
  AND binding.sdar_task_id = request.result_task_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM chat_service.interaction_request
    WHERE status = 'COMPLETED'
      AND result_task_id IS NOT NULL
      AND result_kind IS NULL
  ) THEN
    RAISE EXCEPTION 'completed historical Task request has no Task binding';
  END IF;
END
$$;

UPDATE chat_service.interaction_request
SET result_kind = 'MESSAGE',
    result_message_id = 'legacy-' || md5(request_id),
    result_message_json = jsonb_build_object(
      'messageId', 'legacy-' || md5(request_id),
      'role', 'AGENT',
      'parts', jsonb_build_array()
    ),
    result_rendered_text = '',
    result_hash = md5(jsonb_build_object(
      'kind', 'message',
      'messageId', 'legacy-' || md5(request_id),
      'message', jsonb_build_object(
        'messageId', 'legacy-' || md5(request_id),
        'role', 'AGENT',
        'parts', jsonb_build_array()
      ),
      'renderedText', ''
    )::text)
WHERE status = 'COMPLETED'
  AND result_task_id IS NULL;

ALTER TABLE chat_service.interaction_request
  ADD CONSTRAINT interaction_request_completed_result_union CHECK (
    (
      status <> 'COMPLETED'
      AND result_kind IS NULL
      AND result_task_id IS NULL
      AND result_context_id IS NULL
      AND result_message_id IS NULL
      AND result_related_task_id IS NULL
      AND result_message_json IS NULL
      AND result_rendered_text IS NULL
      AND result_hash IS NULL
    )
    OR
    (
      status = 'COMPLETED'
      AND result_kind = 'TASK'
      AND result_task_id IS NOT NULL
      AND char_length(result_task_id) BETWEEN 1 AND 256
      AND result_context_id IS NOT NULL
      AND char_length(result_context_id) BETWEEN 1 AND 256
      AND result_message_id IS NULL
      AND result_related_task_id IS NULL
      AND result_message_json IS NULL
      AND result_rendered_text IS NULL
      AND result_hash IS NOT NULL
    )
    OR
    (
      status = 'COMPLETED'
      AND result_kind = 'MESSAGE'
      AND result_task_id IS NULL
      AND result_message_id IS NOT NULL
      AND char_length(result_message_id) BETWEEN 1 AND 256
      AND (
        result_related_task_id IS NULL
        OR char_length(result_related_task_id) BETWEEN 1 AND 256
      )
      AND (
        result_context_id IS NULL
        OR char_length(result_context_id) BETWEEN 1 AND 256
      )
      AND result_message_json IS NOT NULL
      AND result_rendered_text IS NOT NULL
      AND char_length(result_rendered_text) <= 65536
      AND result_hash IS NOT NULL
    )
  );

CREATE INDEX interaction_request_result_related_task
  ON chat_service.interaction_request(
    principal_id, thread_id, result_related_task_id
  )
  WHERE result_related_task_id IS NOT NULL;
