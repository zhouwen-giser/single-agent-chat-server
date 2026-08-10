# P07 failed attempt: Resume unit fixture types

- Date: 2026-08-11
- Gate: `pnpm typecheck`
- Result: failed as required

Resume fixtures widened `status` to `string`, Jest 29 rejected readonly tuple
typing for `it.each`, and a helper/import became unused. Fixtures now use exact
official literals, the phase matrix runs in an explicit loop, and dead test
code was removed. Production code was unchanged by these corrections.
