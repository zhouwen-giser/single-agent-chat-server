# P04 Failed Attempt - Agent Card contract fixture

- Attempted at: 2026-08-11
- Command: `pnpm test:contract`
- Result: `FAILED_REQUIRED` with 25/30 passing.
- Failure: the predecessor mock Agent Card omitted the A2A 1.0 required
  `skills` array, so the new bounded safe projection rejected it before client
  construction.
- Remediation: update the contract fixture with a complete published skill and
  Task `history`, assert the normalized safe Agent Card, and rerun all contract
  tests. Production normalization remains fail-closed.
