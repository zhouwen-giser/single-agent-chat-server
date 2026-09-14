# qwen3.8-flash real retest — 2026-09-09

Outcome: **BLOCKED_EXTERNAL for the tested business result**, not S08/S09
acceptance. Read-only container inspection confirmed API and Worker advertise
`qwen3.8-flash` and `MODEL_TIMEOUT_MS=120000`. No shared deployment was changed.

## Attempts retained separately

- `flash-explicit-task`: three capability preflights exceeded the diagnostic
  45-second timeout. No task or temporary database was created; exit 1.
- `flash-http120-explicit-task`: 1.2 preflight passed in 46749 ms. SACS's own
  capability request took 118146 ms; POST returned 202/ACCEPTED with an actual
  `executionPolicy.deadlineMs=120000`. The diagnostic client's 150-second
  observation window expired while polling RUNNING. Case FAIL/TimeoutError,
  exit 2, cleanup PASS. This attempt has no terminal-state evidence and does
  not establish cancellation or recovery.
- `flash-http120-observation270`: preflight passed in 91662 ms; SACS capability
  lookup took 83668 ms. POST returned 202/ACCEPTED in 1695 ms, sending a 120000 ms
  task deadline. Subsequent polling reached **FAILED / MODEL_BUDGET_EXCEEDED**.
  AG-UI returned HTTP 200, valid durable state, RUN_FINISHED and no RUN_ERROR;
  its world explanation correctly reported FAILED. OBSERVED is not business
  PASS. Exit 2 / INCOMPLETE; cleanup PASS.

Final attempt ran 2026-09-09T04:51:28.322Z–04:56:00.617Z. Its Grounding ID hash:
`sha256:d548902b4a6c4e4976a94cb6dcdf7c3def357aaec513dc59cc470dcbbeee58ac`.
See the sibling attempt's `INTEGRATION_EVIDENCE.json` for source identity,
entrypoint hash, negotiated headers, response hashes and projection hash.

## Diagnostic entrypoint changes

The private configuration now permits bounded HTTP/preflight waits up to
120000 ms and optional 1.2-only preflight. Default preflight still checks all
three versions. No frozen protocol bytes or production HTTP defaults changed.
Client observation time is HTTP-operation budget + 120000 ms polling budget +
30000 ms allowance (270000 ms in this run); it is not the WSGS business deadline.
This corrects a diagnostic early timeout, not the upstream model-budget error.

Invocation (configuration contains authorized task references, not committed):

```sh
SACS_V06_INTEGRATION_ENV=/tmp/sacs-v06-real-task-20260909.env SACS_V06_EVIDENCE_DIR=reports/v0.6/real-integration-20260909/flash-http120-observation270 node scripts/v06-real-integration.mjs
```

## Local checks and limits

- Typecheck: exit 0.
- Harness admission regression: 5/5, exit 0.
- Unit regression: 56 suites / 502 tests passed with local listening permitted,
  exit 0. Initial sandbox run failed 9 tests with `listen EPERM`; retained here
  as an environment failure, not a passing run.
- Changed-file formatting and script syntax: exit 0. TypeScript test lint:
  exit 0. Explicit ESLint invocation on the `.mjs` entrypoint fails because the
  existing ESLint TypeScript project excludes that file; full lint/CI is not
  claimed.

No successful historical trajectory result, road/temporal/metric result,
Choice, cancellation or restart recovery is established by this run. The
earlier authorized discovery's empty effective-history views remain a separate
data prerequisite, not an explanation proven for this model error. Further
upstream diagnosis should correlate the final hashed task and UTC interval
without removing deadline safeguards. No raw trajectories, credentials,
upstream database writes or device execution were used. These diagnostic
artifacts remain uncommitted; no new PR or full CI completion is claimed.
