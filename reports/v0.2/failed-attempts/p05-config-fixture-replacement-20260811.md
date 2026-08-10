# P05 Failed Attempt - config fixture replacement

- Attempted at: 2026-08-11
- Command: `pnpm typecheck`
- Result: `FAILED_REQUIRED` before tests.
- Failure: a mechanical `serviceKey` replacement also changed an unrelated
  secrets array entry into invalid object-property syntax.
- Remediation: repair only the array-context occurrence, format the file, and
  rerun typecheck plus the OpenAI redaction regression. The independent AG-UI
  key remains included in the redaction probe.
