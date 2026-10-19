# Grounding Activity Contract

Proposed public shape:

```json
{
  "schemaVersion": "io.sacs/grounding-activity/v1",
  "groundingId": "g-...",
  "analysisId": "a-...",
  "revisionId": "r-...",
  "status": "RUNNING",
  "phase": "optional-authoritative-phase",
  "message": "optional safe public message",
  "progress": {"completed": 2, "total": 5},
  "meta": {"activityRevision": 3}
}
```

Allowed UI status:
`QUEUED, RUNNING, WAITING_SELECTION, COMPLETED, PARTIAL, FAILED, CANCEL_REQUESTED, CANCELLED`.

`phase/message/progress` must be omitted when not authoritative.

Activity deltas are revision guarded exactly like existing v0.3 Activity semantics.
