# P06 failed attempt: unused context helper

- Date: 2026-08-11
- Gate: `pnpm typecheck`
- Result: failed as required

After Custom event fields were tightened to the frozen catalog, the previous
`requiredContextId` helper had no callers. `noUnusedLocals` rejected the dead
code. The helper was removed; context identity remains required by the
interaction factory and is included only where the public contract permits it.
