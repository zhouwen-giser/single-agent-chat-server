# Local baseline verification

Generated: 2026-07-23T20:44:33+09:00

## Frozen install

- Isolated Node.js `22.14.0`: passed
- pnpm `11.13.1`: passed
- `pnpm install --frozen-lockfile`: passed; 698 packages installed from the
  unchanged lockfile
- `pnpm peers check`: passed

## Baseline commands before any source fix

| Command                 | Result  | Evidence                                                         |
| ----------------------- | ------- | ---------------------------------------------------------------- |
| `pnpm format:check`     | FAILED  | Only `reports/goal/11-real-sdar-openwebui-e2e.json` was reported |
| `pnpm lint`             | PASSED  | zero errors                                                      |
| `pnpm typecheck`        | PASSED  | zero errors                                                      |
| `pnpm test:unit`        | PASSED  | 5 suites, 31 tests                                               |
| `pnpm test:contract`    | PASSED  | 2 suites, 25 tests                                               |
| `pnpm test:integration` | PARTIAL | graph suite passed; 2 PostgreSQL suites / 35 tests skipped       |
| `pnpm build`            | PASSED  | TypeScript build completed                                       |

The integration command's zero exit code is not recorded as a complete pass
because `TEST_DATABASE_URL` was unavailable.

## PostgreSQL compatibility probe

An isolated PGlite socket probe used the expected database name and allowed 33
of the 35 database-backed tests to progress successfully. Two persistence
tests failed with a PGlite socket prepared-statement protocol mismatch. This
probe neither modifies the project nor satisfies the required real PostgreSQL
gate.

## Environment-blocked checks

- native PostgreSQL integration
- Docker build and container metadata
- Compose clean-database startup and cleanup
- real Open WebUI + real SDAR final-head E2E
- real Redis and MCP transport

These checks are not represented as passed.
