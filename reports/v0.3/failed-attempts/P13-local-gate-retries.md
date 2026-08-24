# P13 local gate retries

## Sandboxed loopback attempt

The first `pnpm verify:phase12` attempt ran inside a network-isolated sandbox.
The unit suite passed, but nine A2A contract cases could not bind
`127.0.0.1` (`EPERM`) and timed out. This was classified as an execution
environment failure, not a product defect. The authorized loopback rerun passed
all 78 contract tests.

## pnpm license metadata attempt

The authorized regression command inherited a workspace-specific
`PNPM_CONFIG_STORE_DIR` whose metadata lacked the package index for
`@a2a-js/sdk@1.0.0-beta.0`; `verify:licenses` stopped after all preceding code
and PostgreSQL suites had passed. A frozen-lockfile install confirmed no
dependency changes. Rerunning `pnpm verify:licenses` against pnpm's normal local
metadata database passed 89 production entries. No lockfile or dependency
version changed.

## Docker dependency metadata retry

The exact-head Docker build encountered transient registry metadata retries for
`@babel/compat-data`. BuildKit completed from the pinned lockfile and cache,
then produced image manifest
`bebdae2d4006cfcb776e7c366699dcacee507c342c0fc3d391848b0938a3202a`.

None of these retries is counted as real-model or real-SDAR evidence.

## Continuation endpoint-discovery attempt

A continuation audit found `http://127.0.0.1:10999` listening and returning an
A2A 1.0 Agent Card. The card exposes only `embodied.move` with a
`confirmation_required` limitation. The endpoint was not exercised: no two
operator-reviewed safe requests were supplied, no genuine model endpoint was
configured, and the running service could not be tied to a clean locked SDAR
and SMPP source pair. The nearby SDAR checkout also contains substantial
pre-existing user changes, which were preserved. This discovery is blocker
diagnosis only and is not counted as real evidence.

## Source-lock candidate CI interrupt expiry

After the SDAR source-lock refresh, exact-head push CI run `32703576086`
passed 100 unit and 78 contract tests, then failed one of 89 PostgreSQL
integration tests. `agui-multitask-interrupt.postgres.int.test.ts` injected an
absolute service clock of `2026-08-22T00:00:00.000Z`; once wall-clock time moved
past that date, the database correctly treated the newly persisted Interrupt
as expired. The test now uses the service's production default current clock.
The focused rerun passed 1/1 and the complete isolated PostgreSQL rerun passed
89/89. Production expiry semantics were not changed, and the failed CI is not
counted as release evidence.
