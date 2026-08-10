# P07 failed attempt: readonly JSON record narrowing

- Date: 2026-08-11
- Gate: `pnpm typecheck`
- Result: failed as required

TypeScript did not narrow a readonly JSON array away from the public record
union after `Array.isArray`. The helper already checked non-null object and
non-array at runtime; an explicit record cast was added only in that verified
branch. Typecheck passed afterward.
