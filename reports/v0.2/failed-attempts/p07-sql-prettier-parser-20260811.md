# P07 failed attempt: SQL passed to Prettier

- Date: 2026-08-11
- Gate: scoped formatting command
- Result: failed as required

The command accidentally included migration `0005_interrupt_resume.sql` in a
Prettier invocation. The repository has no SQL parser, so formatting stopped
before typecheck. SQL was removed from the Prettier target list; the dedicated
migration checksum/transaction gate later passed 5/5 files.
