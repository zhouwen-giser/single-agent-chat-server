ALTER TABLE chat_service.chat_thread_binding
  ADD COLUMN submission_lease_owner text,
  ADD COLUMN submission_lease_until timestamptz;

CREATE INDEX chat_thread_expired_submission_lease
  ON chat_service.chat_thread_binding(submission_lease_until)
  WHERE submission_lease_until IS NOT NULL;
