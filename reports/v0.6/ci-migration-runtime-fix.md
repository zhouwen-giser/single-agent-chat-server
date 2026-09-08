# CI migration and runtime packaging correction

## Diagnosis

[Failed quality job](https://github.com/zhouwen-giser/single-agent-chat-server/actions/runs/34175781717/job/101904770805)
passed formatting and all 502 unit tests, then failed a historical migration
contract that incorrectly required migration 0016 to remain last.

## Changes

- Anchor historical migration positions and assert contiguous numbering.
- Update five PostgreSQL upgrade tests to expect the appended migrations through
  0020, retaining their legacy-data assertions. SQL and production identity
  validation are unchanged.
- Update lifecycle fixture source metadata and persisted contract identity;
  explicitly select both v1.1 version and profile for the legacy HTTP E2E fixture.
- Copy frozen public runtime assets byte-for-byte after compilation, including
  the Docker build. Include the source lock files in the runtime image.
- Add executable runtime-asset regression coverage.
- Regenerate v0.4 evidence hashes for changed test sources; acceptance counts and
  statuses remain unchanged. Frozen v0.6 receipts are untouched.

## Validation (2026-09-08)

- Contract suite: 38 suites / 370 tests passed.
- PostgreSQL 16.9 integration tests: all 22 suites / 148 tests passed in the
  combined integration/E2E run. That run exposed the legacy E2E profile mismatch;
  after correction, all 3 E2E suites / 11 tests passed on rerun.
- Security suite: 3 suites / 36 tests passed.
- Formatting, TypeScript, build, migration, architecture, license, secret,
  workflow and acceptance-generator checks passed.
- Standard `pnpm lint` passed with 162 existing warnings and no errors.
- Built-server smoke passed (health, models, completion).
- Docker runtime image built successfully; metadata check passed. A non-root,
  network-disabled temporary container imported the compiled consumer and
  verified all 115 frozen public files.

Temporary database and validation containers were removed by their harnesses.
The local test image is retained as `single-agent-chat-server:ci-fix-a7a3405`.
The complete remote workflow must still be confirmed on the pushed commit.
