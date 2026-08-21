# P01 local gate retries

## Lockfile formatting

The first `pnpm verify:phase1` stopped at `prettier --check` because the pnpm
lockfile changed by the pinned Ajv addition had not yet been formatted. No test
ran and no success was claimed. `pnpm exec prettier --write pnpm-lock.yaml`
corrected the mechanical format; the complete gate then passed.

## License sandbox

The first sandboxed `pnpm verify:licenses` could not enumerate pnpm's user-level
store and exited 1. The loopback-capable rerun passed with 89 production package
entries and the unchanged allowed SPDX set. Ajv is development-only and is not
included in the production inventory.

## Integrity

Both failed attempts remain classified as failed. Neither is counted as a pass,
and no assertion, license allowlist, or production dependency boundary was
weakened.
