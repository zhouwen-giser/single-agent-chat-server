# v0.6 CI formatting fix

## Failure and correction

GitHub Actions [quality job 101629949770](https://github.com/zhouwen-giser/single-agent-chat-server/actions/runs/34085967167/job/101629949770)
failed in `pnpm format:check`, before business tests ran. Prettier reported
10 generated verification receipt and acceptance evidence JSON files.

Added exact `.prettierignore` entries for those 10 files, preserving their
generator-owned bytes and historical evidence. No source, workflow, dependency,
receipt, or historical ledger content was changed. Other JSON files and
hand-written reports remain subject to formatting checks.

Added `tests/format-policy.unit.test.ts`: 10 positive exclusion cases and
8 negative cases covering source, scripts, tests, hand-written reports,
the frozen acceptance ledger, and a future report path.

## Local validation

All commands below passed on 2026-09-08:

- `pnpm format:check`
- `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/format-policy.unit.test.ts` — 18/18 tests
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/eslint/bin/eslint.js tests/format-policy.unit.test.ts`
- `git diff --check`

These targeted checks do not claim a rerun of the complete integration or
container workflow. GitHub Actions remains the authority for the new PR run.
