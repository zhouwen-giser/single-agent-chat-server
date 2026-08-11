# P08 failed attempt: Fake Client declaration order

- Date: 2026-08-11
- Gate: P08 crash-after-submission integration
- Result: failed as required

The initial idempotent submission fixture extended a class declared later in
the ESM test module, causing TypeScript and runtime initialization failures.
It is now an independent `SdarA2aClient` implementation. The test proves the
recovered submission reuses the stable A2A message ID and represents one remote
Task creation.
