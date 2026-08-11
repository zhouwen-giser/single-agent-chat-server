# P07 failed attempt: service type exports

- Date: 2026-08-11
- Gate: `pnpm typecheck`
- Result: failed as required

The initial Resume service imported the frozen action constant through an
adapter entry that did not export it, and passed a typed interface directly to
the canonical JSON hash. The adapter now explicitly exports the pinned action
constant, and resolution payloads are explicitly converted to bounded JSON
before hashing.
