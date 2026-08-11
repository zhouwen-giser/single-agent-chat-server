# P08 failed attempt: finally and generator lint

- Date: 2026-08-11
- Gate: `pnpm verify:phase8`
- Result: failed as required

The first full lint found a `return` inside `finally`, a no-yield negative-test
generator, and later one unused test type import. Disconnect state is now
recorded inside `finally` and returned afterward; the negative recovery source
is a throwing function, and the unused import was removed. Lint and typecheck
then passed without warnings.
