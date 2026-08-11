# P06 failed attempt: public JSON state type

- Date: 2026-08-11
- Gate: `pnpm typecheck`
- Result: failed as required

The first mapper typecheck passed a `PublicJsonValue` Task state directly to a
`Set<string>`. TypeScript rejected the nullable/structured union before tests
could run. The projection now converts the already allowlisted state value to
a string at the membership boundary. The subsequent typecheck passed.
