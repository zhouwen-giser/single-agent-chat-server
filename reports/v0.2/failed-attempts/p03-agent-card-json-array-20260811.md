# P03 Failed Attempt — Agent Card JSON array binding

- Attempted at: 2026-08-11
- Command: `pnpm test:integration`
- Result: `FAILED_REQUIRED` with 40/41 passing.
- Passed: fresh migration, complete v0.1 upgrade with binding preservation,
  request idempotency, restart/open interrupt recovery, principal isolation,
  predecessor task coordination, predecessor persistence, and graph tests.
- Failure: `pg` encoded the safe Agent Card skills array as a PostgreSQL array,
  which JSONB rejected as invalid JSON.
- Remediation: serialize the already-bounded `JsonValue` at the SQL parameter
  boundary and rerun all integration tests. No broader Agent Card content is
  added to persistence.
