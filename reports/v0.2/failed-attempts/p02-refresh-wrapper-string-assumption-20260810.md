# P02 Failed Attempt — refresh wrapper string assumption

- Attempted at: 2026-08-10
- Command: `pnpm typecheck && pnpm test:unit && pnpm test:contract`
- Result: `FAILED_REQUIRED`
- Failing step: TypeScript rejected `apps/server/src/main.ts` because its
  post-stream persistence refresh wrapper still declared
  `AsyncGenerator<string>` while SACS chat runners may now emit typed
  `SdarInteractionEvent` values.
- Evidence boundary: tests did not start; no test pass is claimed by this run.
- Remediation: define the runner stream as one union-valued async iterable and
  make the refresh wrapper transparently preserve each value. Rendering remains
  the OpenAI adapter's responsibility.
