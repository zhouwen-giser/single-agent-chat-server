ALTER TABLE chat_service.agui_interrupt_binding
  ADD COLUMN reason text,
  ADD COLUMN response_schema_json jsonb,
  ADD COLUMN response_schema_hash text,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN resolution_claimed_at timestamptz;

UPDATE chat_service.agui_interrupt_binding
SET reason = CASE internal_phase
  WHEN 'awaiting_plan_confirmation' THEN 'sdar.plan_confirmation'
  WHEN 'awaiting_user_input' THEN 'sdar.input_required'
  WHEN 'paused' THEN 'sdar.paused'
END,
expires_at = created_at + interval '24 hours'
WHERE reason IS NULL OR expires_at IS NULL;

ALTER TABLE chat_service.agui_interrupt_binding
  ALTER COLUMN reason SET NOT NULL,
  ALTER COLUMN expires_at SET NOT NULL,
  ADD CONSTRAINT agui_interrupt_reason_check CHECK (
    reason IN ('sdar.plan_confirmation', 'sdar.input_required', 'sdar.paused')
  ),
  ADD CONSTRAINT agui_interrupt_response_schema_pair_check CHECK (
    (response_schema_json IS NULL AND response_schema_hash IS NULL)
    OR
    (response_schema_json IS NOT NULL AND response_schema_hash IS NOT NULL)
  );

ALTER TABLE chat_service.agui_interrupt_binding
  DROP CONSTRAINT agui_interrupt_binding_status_check,
  ADD CONSTRAINT agui_interrupt_binding_status_check CHECK (
    status IN ('OPEN', 'RESOLVING', 'RESOLVED', 'CANCELLED')
  );

DROP INDEX chat_service.agui_one_open_interrupt_per_task;

CREATE UNIQUE INDEX agui_one_unfinished_interrupt_per_task
  ON chat_service.agui_interrupt_binding(principal_id, task_id)
  WHERE status IN ('OPEN', 'RESOLVING');

CREATE INDEX agui_interrupt_expiry
  ON chat_service.agui_interrupt_binding(expires_at)
  WHERE status = 'OPEN';
