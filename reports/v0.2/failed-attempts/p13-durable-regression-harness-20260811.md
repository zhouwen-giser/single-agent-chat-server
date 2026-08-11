# Failed Attempt

- Phase: P13
- Timestamp: 2026-08-11
- Candidate SHA: `40e7ae4e2346bb932ccd7e6b89aea3793cc08c42`
- Command/scenario: focused durable AG-UI lint and PostgreSQL regression setup
- Result: harness-level failures before the final 5/5 pass

## Failure

The first test generator had no `yield` and failed `require-yield`. A subsequent
manual Jest invocation named a nonexistent config file. The first database URL
used an obsolete placeholder password, and the first successful database run
exposed a Jest distinction between an absent `taskId` property and an explicit
`taskId: undefined`.

## Root cause

The new failure stub and ad-hoc focused command did not follow the repository's
existing generator/test-script conventions; the assertion also over-specified
object shape beyond the behavior being tested.

## Fix/disposition

Keep the stub a legal empty async generator, invoke the repository's ESM Jest
entry, use a fresh isolated PostgreSQL 16 container with known one-time
credentials, and assert `ERROR` status separately from an absent Task binding.

## Retest evidence

Focused durable PostgreSQL tests passed 5/5. Full `verify:ci` and the exact
`pnpm verify` passed 78 unit, 57 contract, 9 security, and 51 integration tests.
