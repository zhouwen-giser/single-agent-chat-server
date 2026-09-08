-- Reuse the existing fenced command/session mutation machinery for source
-- queries. Their pre-HTTP payload is the existing immutable Grounding intent.
ALTER TABLE chat_service.analysis_control_command
  DROP CONSTRAINT analysis_control_command_command_kind_check,
  DROP CONSTRAINT analysis_control_command_check3,
  ADD CONSTRAINT analysis_control_command_command_kind_check CHECK (
    command_kind IN ('CANCEL', 'INTERVENTION_RESOLUTION', 'SOURCE_REVISION')
  ),
  ADD CONSTRAINT analysis_control_command_intervention_kind_check CHECK (
    (command_kind IN ('CANCEL', 'SOURCE_REVISION') AND intervention_id IS NULL)
    OR (command_kind = 'INTERVENTION_RESOLUTION' AND intervention_id IS NOT NULL)
  );

ALTER TABLE chat_service.analysis_session
  DROP CONSTRAINT analysis_session_mutation_claim_kind_check,
  ADD CONSTRAINT analysis_session_mutation_claim_kind_check CHECK (
    mutation_claim_kind IS NULL OR mutation_claim_kind IN (
      'PROPOSAL', 'CANCEL', 'INTERVENTION_RESOLUTION', 'SOURCE_REVISION'
    )
  );

CREATE UNIQUE INDEX analysis_one_claimed_source_revision
  ON chat_service.analysis_control_command(analysis_id)
  WHERE command_kind = 'SOURCE_REVISION' AND status = 'CLAIMED';
