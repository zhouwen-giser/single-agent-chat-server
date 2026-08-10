# P09 failed attempt: Windows regex and `.env` formatting

- Date: 2026-08-11
- Gate: selected format and typecheck
- Result: failed as required

The first edit lost regex backslashes in `a2a-mapper.ts`, producing an
unterminated expression, while an explicit Prettier invocation for
`.env.example` had no parser. The source was repaired with syntax that avoids
fragile escaping and only supported files were passed to the targeted formatter.
Repository-level `format:check` and typecheck subsequently passed.
