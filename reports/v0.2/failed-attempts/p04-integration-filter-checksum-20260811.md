# P04 Failed Attempt - integration filter and stale test checksum

- Attempted at: 2026-08-11
- Command: `pnpm test:integration -- --runTestsByPath tests/interaction-persistence.postgres.int.test.ts`
- Result: `FAILED_REQUIRED`; the new P04 persistence suite passed, but the
  script's existing path regex caused all integration suites to run.
- Failure: the isolated test database initially held an older stored checksum
  for migration `0004_interaction_gateway.sql`, so the task-coordinator suite
  failed closed before its tests ran.
- Remediation: run the target through Jest's exact file entry, rebuild only the
  dedicated `single_agent_chat_phase4` test schema from current migration
  bytes, then rerun the full integration gate. Final result: 43/43 passed.
