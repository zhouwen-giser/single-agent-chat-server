# P05 local gate retries

## Sandbox localhost restrictions

The first PostgreSQL and contract-suite attempts ran inside the restricted
sandbox. Node received `EPERM` for localhost TCP connections and local mock
server binding. These attempts timed out or failed and are not acceptance
evidence. The same commands were rerun with the required scoped approval against
an isolated PostgreSQL 16.9 container and local A2A mock servers; both passed.

## Gate fixture typing

The first complete `verify:phase5` attempt stopped during TypeScript checking
because a new no-A2A Jest mock inferred `unknown`. Giving the mock its exact
`Promise<SdarA2aClient>` signature fixed only the fixture type; the complete gate
then passed.

## License inventory

The restricted package-store attempt could not enumerate pnpm license metadata.
The unchanged repository license gate was rerun with scoped package-store access
and passed 89 production dependency entries. No allowlist or dependency data was
changed.
