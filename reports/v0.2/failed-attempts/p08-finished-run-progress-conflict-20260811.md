# P08 failed attempt: finished Run progress conflict

- Date: 2026-08-11
- Gate: P08 PostgreSQL integration
- Result: failed as required

A second same-hash query correctly avoided Task resubmission, but initially
tried to update `last_sequence` on an already `FINISHED` Run. Recovery is now
read-only for finished Runs; only a durable `RUNNING` Run accepts monotonic
progress and completion updates. Duplicate query and recovery tests then passed.
