ALTER TABLE chat_service.conversation_thread
  ADD COLUMN submission_lease_owner text,
  ADD COLUMN submission_lease_until timestamptz;

CREATE INDEX conversation_thread_expired_submission_lease
  ON chat_service.conversation_thread(submission_lease_until)
  WHERE submission_lease_until IS NOT NULL;

CREATE INDEX interaction_request_result_task
  ON chat_service.interaction_request(principal_id, thread_id, result_task_id)
  WHERE result_task_id IS NOT NULL;

CREATE INDEX interaction_run_recovery
  ON chat_service.interaction_run(principal_id, thread_id, status, updated_at DESC);
