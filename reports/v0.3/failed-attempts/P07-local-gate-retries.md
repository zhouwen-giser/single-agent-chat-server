# P07 local gate retries

## Traceability formatting

The first complete phase gate stopped at `format:check` because the new P07
traceability table row had not been rewritten after its final content change.
Prettier changed only table spacing; no implementation or assertion was
altered.

## Contract fixture generator lint

The next phase gate stopped at lint because the deliberately unused A2A submit
fixture was an async generator with no `yield`. It was changed to a rejecting
yield expression, preserving the fail-fast behavior if that forbidden path is
ever invoked while satisfying the generator contract. Neither failed attempt
is acceptance evidence.

## Targeted runner mismatch

A targeted rerun initially used `pnpm exec vitest`, but this repository uses
Jest and does not expose a Vitest binary. The command stopped before loading any
test. The same test files were rerun with the repository's pinned Jest runner;
the failed launcher invocation is not acceptance evidence.

## License enumeration sandbox

The license gate could not enumerate pnpm production licenses inside the
restricted command sandbox. It was rerun unchanged with the approved workspace
dependency environment. An initial retry pointed at the Codex app's pnpm store
instead of the `storeDir` recorded in this workspace's `.modules.yaml`, so it
also failed before policy evaluation. The unchanged gate passed against the
workspace's actual store; neither environment failure is acceptance evidence.
