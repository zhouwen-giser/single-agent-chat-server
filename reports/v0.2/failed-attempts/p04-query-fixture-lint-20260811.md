# P04 Failed Attempt - query no-mutation fixture lint

- Attempted at: 2026-08-11
- Command: `pnpm lint && pnpm build`
- Result: `FAILED_REQUIRED` in the new test fixture.
- Failure: an unused `jest` import and an async generator used only to throw on
  prohibited Task submission violated unused-symbol and `require-yield` rules.
- Remediation: remove the unused import and make the zero-event generator
  explicit before throwing. Production query behavior was unchanged; the full
  lint, typecheck, unit, and build gates then passed.
