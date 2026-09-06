-- A negotiated source result may arrive before the Analysis binding/projection
-- transaction. Retain/reclaim its lease through that crash window. Legacy and
-- finalized lifecycles retain the original lease prohibition.
ALTER TABLE chat_service.grounding_execution
 DROP CONSTRAINT grounding_execution_check10,
 ADD CONSTRAINT grounding_execution_completion_lease CHECK (
   state NOT IN ('GROUNDING_READY','SDAR_SUBMITTED','COMPLETED','FAILED','CANCELLED')
   OR (lease_owner IS NULL AND lease_until IS NULL)
   OR (state='GROUNDING_READY' AND canonical_request_json IS NOT NULL AND
       last_source_status IN ('COMPLETED','PARTIAL','AMBIGUOUS','UNRESOLVED','FAILED','CANCELLED'))
 );
