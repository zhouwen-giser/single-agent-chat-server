# P07 failed attempt: current Task revalidation fixtures

- Date: 2026-08-11
- Gate: `pnpm typecheck` and `pnpm test:unit`
- Result: failed as required

Adding frozen-contract `getTask()` revalidation first exposed a missing
`NormalizedTask` type import, then correctly rejected fake Tasks that remained
`WORKING`. The import and fixtures were updated to publish the durable
`INPUT_REQUIRED` phase/input request. A separate negative test proves phase
drift is rejected before claim or Follow-up.
