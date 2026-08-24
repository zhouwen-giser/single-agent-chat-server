# P11 local gate retries

Status: `NON_EVIDENCE_FAILED_ATTEMPTS`

## Initial shared-observer regression run

- Result: lint and seven AG-UI/Interrupt suites passed; two existing OpenAI
  Task-resolution assertions failed on mock call arity.
- Cause: the shared service always supplied a third Coordinator observer
  argument, including `undefined`, changing the predecessor two-argument call
  shape.
- Resolution: preserve the two-argument Coordinator calls when no observer is
  present and supply the third argument only for the AG-UI typed-event path.
  The failed run is not acceptance evidence.

## Initial cross-protocol test type check

- Result: formatting and lint passed, then TypeScript rejected two test-only
  callback inference shapes before the targeted suites ran.
- Cause: the new model mock left its production input as `unknown`, and the
  official client `onEvent` callback returned `Array.push`'s numeric result.
- Resolution: type the model input from `StructuredChatModel.answer` and use a
  block callback with no return value. The failed run is not acceptance
  evidence.

## Initial architecture boundary check

- Result: formatting and TypeScript compilation passed, then the architecture
  gate rejected the new route code before targeted tests.
- Cause: the HTTP route imported `EventType` directly from `@ag-ui/core`, while
  the repository boundary permits official AG-UI dependencies only inside the
  protocol contract/adapter packages.
- Resolution: compare the already validated contract event's public type
  literals in the route and keep the official dependency isolated. The failed
  run is not acceptance evidence.

## Initial multi-Task interrupt test lint

- Result: lint rejected the test double before type checking.
- Cause: its deliberately unused async-generator implementation threw without
  containing a `yield`, violating the repository `require-yield` rule.
- Resolution: keep the method an explicit empty generator before the defensive
  throw. The failed run is not acceptance evidence.

## First authoritative Phase 11 gate

- Result: unit 99/99 and contract 78/78 passed; PostgreSQL integration passed
  88/89 before the gate stopped.
- Cause: one predecessor persistence assertion still required separate internal
  Threads for OpenAI and AG-UI bindings with the same principal and external
  thread ID. P11 intentionally requires those bindings to share one durable
  Conversation; the same test continued to prove cross-principal isolation.
- Resolution: update that obsolete assertion and test name to the P11 contract.
  The failed run is not acceptance evidence.
