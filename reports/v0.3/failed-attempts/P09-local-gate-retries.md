# P09 local gate retries

Status: `NON_EVIDENCE_FAILED_ATTEMPTS`

## Direct Jest invocation omitted the repository ESM launcher

- Command: `pnpm exec jest --runInBand ...`
- Result: the three selected TypeScript ESM suites failed during loading with
  `Cannot use import statement outside a module`; zero tests ran.
- Cause: the direct invocation omitted the repository's required
  `node --experimental-vm-modules node_modules/jest/bin/jest.js` launcher.
- Resolution: rerun with that exact launcher and use only the successful rerun
  plus complete phase gates as evidence.

## Sandboxed loopback contract run stalled

- Command: standard ESM Jest launcher for the three P09 targeted suites.
- Result: after typecheck and architecture passed, the adapter suite produced no
  test output while opening its loopback HTTP fixture; the run was interrupted.
- Cause: the filesystem/network sandbox did not permit the local binding used by
  the official HTTP+JSON contract fixture.
- Resolution: rerun the same bounded test command outside the network sandbox.
  The interrupted run is not acceptance evidence.

## Eager rejected-Promise test fixture

- Result: two suites passed; the adapter suite reported the correct typed error
  but failed because four rejecting Promises were created eagerly and only
  awaited sequentially, producing `PromiseRejectionHandledWarning` for the last
  two operations.
- Resolution: store operation thunks and create each Promise immediately before
  its rejection assertion. The failed run is not acceptance evidence.

## Interrupt assertion used a non-existent table name

- Result: 33 Coordinator PostgreSQL tests passed; the new auth-required test
  reached its post-error database assertion but queried `interaction_interrupt`.
- Cause: the durable schema table is named `agui_interrupt_binding`.
- Resolution: correct the assertion to the published migration/table name and
  rerun the suite. The failed run is not acceptance evidence.

## Throw-only async generator lint

- Result: ESLint rejected the auth-required test client under `require-yield`.
- Cause: its async generator intentionally threw before any event and contained
  no syntactic `yield`.
- Resolution: retain the deterministic first-call throw and add a type-valid
  unreachable fallback event path so the fixture satisfies the generator rule.

## Traceability table formatting

- Result: the first complete `verify:phase9` attempt stopped at
  `format:check`; no tests ran.
- Cause: the longer local-pending status changed Markdown table column widths
  after the previous formatting pass.
- Resolution: run the repository formatter and restart the complete phase gate.

## Compose candidate image absent

- Result: `pnpm verify:compose` created its isolated resources but could not
  start the server because local image `single-agent-chat-server:0.1.0` did not
  exist; the script's `finally` cleanup ran.
- Resolution: build the current candidate image with the repository Docker gate
  and rerun the same self-cleaning Compose verification. The failed attempt is
  not acceptance evidence.
