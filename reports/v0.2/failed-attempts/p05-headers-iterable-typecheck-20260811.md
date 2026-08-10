# P05 Failed Attempt - Headers iterable typecheck

- Attempted at: 2026-08-11
- Command: `pnpm typecheck` followed by the exact AG-UI contract test.
- Result: `FAILED_REQUIRED` typecheck; the five runtime contract tests passed.
- Failure: the test used `Headers.entries()`, but the project intentionally
  compiles with `DOM` and not the broader `DOM.Iterable` lib.
- Remediation: collect request headers through standard `Headers.forEach()`
  without widening compiler libraries, then rerun typecheck and the official
  `HttpAgent` test.
