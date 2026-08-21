# P04 failed attempt: sandboxed PostgreSQL connection

- Observed: 2026-08-21
- Command: the P04 conversation-persistence PostgreSQL suite against the
  isolated local PostgreSQL 16.9 container.
- Result: all tests failed in `beforeAll` with
  `connect EPERM 127.0.0.1:55433`; no test assertion ran.
- Classification: execution sandbox denied localhost networking, not a product
  or database failure.
- Recovery: reran the identical suite with approved localhost access. The suite
  passed 12/12 tests, including restart context equality.
- Integrity: the denied run is not counted as acceptance evidence.
