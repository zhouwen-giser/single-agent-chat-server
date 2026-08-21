# P03 local gate retries

## Occupied PostgreSQL port

The first disposable PostgreSQL container could not bind loopback port `55432`
because another existing service owned it. The non-running exact test container
was removed, listeners were inspected read-only, and the P03 database was
started on free port `55433`. No existing service was stopped or changed.

## Formatting gate

The first `pnpm verify:phase3` stopped immediately at `prettier --check` because
the updated traceability table needed mechanical formatting. No later gate ran
and no pass was claimed. Prettier corrected the table; the complete phase gate
then passed 83 unit, 64 contract, and 62 PostgreSQL integration tests plus the
build.

## Integrity

Both attempts remain recorded as failed/incomplete. No migration checksum,
database-name safety guard, test, role constraint, optimistic lock, or
authorization boundary was weakened.
