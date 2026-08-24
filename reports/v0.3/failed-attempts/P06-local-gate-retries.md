# P06 local gate retries

## Restricted local fixture binding

The first aggregate contract attempt was run in the restricted sandbox. Four
HTTP-independent suites passed, while the A2A adapter contract could not finish
because its local fixture server was not permitted to bind. The attempt was
interrupted and is not acceptance evidence. The complete suite was rerun with
scoped local-service permission and passed.

## PostgreSQL environment variable

The first complete test invocation used production `DATABASE_URL`; repository
tests intentionally key their opt-in on `TEST_DATABASE_URL`, so seven
PostgreSQL suites were reported as skipped. That run is not PostgreSQL
acceptance evidence. The same exact worktree was rerun against the isolated
PostgreSQL container with `TEST_DATABASE_URL`; all 34 suites and all 245 tests
passed with zero skips.
