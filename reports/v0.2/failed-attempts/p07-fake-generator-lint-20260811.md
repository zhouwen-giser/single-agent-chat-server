# P07 failed attempt: empty fake generator

- Date: 2026-08-11
- Gate: `pnpm lint`
- Result: failed as required

The fake A2A client used an empty async generator body. ESLint rejected it as
an empty function. The fake now explicitly yields an empty iterable, preserving
zero-event behavior while satisfying the repository lint policy.
