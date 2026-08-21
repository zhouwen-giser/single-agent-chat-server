# P10 local gate retries

Status: `NON_EVIDENCE_FAILED_ATTEMPTS`

## Initial static type check

- Result: the first formatting/typecheck/lint sequence stopped at TypeScript
  compilation in the new PostgreSQL vertical test.
- Cause: an inline Jest mock inferred an incompatible call signature and left
  one callback parameter implicitly typed as `any`.
- Resolution: declare the mock functions separately with explicit production
  interface-compatible types. The failed run is not acceptance evidence.

## Initial OpenAI/PostgreSQL vertical test assertions

- Result: the new route contract and PostgreSQL suite ran, with 22 existing/new
  assertions passing and three new assertions failing.
- Causes: the test queried a fabricated deterministic Thread ID although the
  production repository correctly allocates an opaque internal Thread ID; the
  client-history mapper also treated the immediately preceding array item as
  the parent assistant, which does not hold when a tool message intervenes.
- Resolution: read the authoritative internal Thread through its binding and
  select the most recent assistant before the current user independently of
  intervening ignored tool messages. The failed run is not acceptance evidence.

## Initial architecture guard execution

- Result: formatting, lint, and TypeScript compilation passed, then the new
  architecture guard stopped before evaluating its assertions.
- Cause: the guard referenced an unimported `resolve` helper.
- Resolution: use the already imported repository-root-aware `join` helper.
  The failed run is not acceptance evidence.

## Targeted Jest invocation typo

- Result: format, lint, typecheck, and architecture verification passed; the
  targeted test command then stopped before discovery.
- Cause: the command referenced `jest.config.mjs` while this repository uses
  `jest.config.js`.
- Resolution: rerun the targeted suites with the repository's actual config.
  The failed invocation is not acceptance evidence.
