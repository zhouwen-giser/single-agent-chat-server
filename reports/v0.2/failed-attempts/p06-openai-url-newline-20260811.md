# P06 failed attempt: OpenAI URL fallback newline

- Date: 2026-08-11
- Gate: `prettier --write`
- Result: failed as required

A narrow PowerShell replacement inserted literal `` `n `` tokens into the
OpenAI Artifact URL fallback expression. Prettier rejected the invalid
TypeScript before typecheck. The expression was replaced with real line breaks
and the formatting gate subsequently passed.
