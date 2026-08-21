# P02 local gate retries

## Test-default mismatch

The first new model unit run failed because its expected object reused the
100ms/zero-retry timeout fixture rather than the documented production defaults
of 30 seconds and one retry. The production parser was unchanged; the assertion
was corrected, and 83 unit tests passed.

## Removed fallback dependencies in predecessor tests

The first contract run found that the predecessor regression suite still
depended implicitly on the deleted production fallback. It returned HTTP 500
for model-dependent turns. The suite now injects an explicit test-only
`StructuredChatModel`; no production fallback was restored. All 64 contract
tests passed in the required loopback-capable environment.

The first integration run similarly found that `graph.int.test.ts` invoked the
default graph and therefore relied on the old fallback. It now injects a test
fixture model. The default production/Studio graph remains fail-closed when no
model is configured.

## PostgreSQL database safety name

The first PostgreSQL-backed run used an isolated database named `sacs`. Existing
tests intentionally require `single_agent_chat_phase4` and rejected all 50
database cases before migration. The required database was created in the same
disposable PostgreSQL 16.9 container and the unchanged tests then passed 51/51.

## Sandbox capabilities

An in-sandbox A2A contract attempt could not bind its loopback fixture and did
not complete. The authorized loopback-capable run passed all seven contract
suites and 64 tests. The first license attempt likewise lacked access to pnpm's
user-level store; the authorized rerun passed 89 production entries.

## Integrity

All failed or incomplete attempts remain failures. No test, database-name
guard, architecture boundary, license allowlist, or timeout was weakened to
obtain a pass.

## Exact-head container CI

CI run `32476128883` passed quality but failed container job `96753033481` at
`verify:compose`. P02 correctly made the model variables mandatory in Compose,
while the hermetic Compose verifier still supplied only PostgreSQL and service
credentials. The verifier now starts a short-lived host-side Chat Completions
readiness fixture, injects its fixed internal address into the disposable
Compose project, and closes it during cleanup. This fixture proves container
configuration/readiness wiring only and is not represented as the P13 real
model gate.
