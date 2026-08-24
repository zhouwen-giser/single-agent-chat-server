# P00 execution baseline

Status: `LOCAL_BASELINE_COMPLETE`

## Source identity

- SACS `origin/main`: commit `25c923524bcddc5fffd37513766cf28c9f9c2cf4`, tree `51cde785ceed2023ea1a9c7b7b882dfef3847c19`.
- SDAR `origin/main`: initially commit `2275bc52759914bc80113358a9083e6f00d59e6d`, tree `df4520d92f558ff3fa75cf7b86755d148433ceb5`; refreshed before P13 to commit `7fa3ed8f7a7cac6ecff6a16fb8ce72c1d61b1c3e`, tree `0fbf26380cbb9a99857cac441ad107752e051c14`.
- SMPP `origin/main`: commit `f8c37e6a2ecdc859e56910803197ec938b9a807a`, tree `ace835d13c45ee2391e7b7ebcda5edd19566d70b`.
- Feature branch: `feature/sacs-v0.3-general-conversation-multitask`, created directly from the verified SACS `origin/main`.
- Target branch and matching PR did not exist before P00.

The SDAR and SMPP working directories were not changed or switched. Their
`origin/main` objects were inspected read-only because both checkouts belong to
other ongoing work and the SDAR checkout contains user-owned untracked files.

The P13 refresh followed SDAR merge PR #25. Review confirmed that the public
boundary remains A2A 1.0 HTTP+JSON on `/.well-known/agent-card.json` and `/a2a`
with the pinned SDK. The changes add deterministic initial admission,
replay-safe history projection, and optional governed confirmation identity;
the configured Agent Card used by SACS continues to publish empty security
requirements, so the trusted single-SDAR boundary remains applicable.

## Frozen protocol and dependency baseline

- A2A specification patch `1.0.1`, wire `1.0`, `HTTP+JSON`.
- Official SDK `@a2a-js/sdk@1.0.0-beta.0`.
- SDAR publishes `/.well-known/agent-card.json` and `/a2a`, advertises streaming,
  and currently uses `UserBuilder.noAuthentication` with empty Agent Card
  security requirements.
- SACS remains limited to `sendMessageStream`, `sendMessage`, `getTask`, and
  `cancelTask` through its isolated adapter.
- SMPP is a read-only semantic reference and is not a SACS dependency.
- `pnpm-lock.yaml` SHA-256:
  `6980e48560508ee474ef9c86a5b3ddef3cea0bc29f4adf438ade79ee3e79f7c1`.
- Published migrations remain `0001` through `0006`; their checksums are in
  `P00-source-lock.json` and will not be edited.

## Baseline commands

| Command                                              | Result               | Classification                                                                          |
| ---------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| task-package `scripts/preflight.sh`                  | passed               | clean `main`, expected remote and toolchain                                             |
| task-package `validate_task_package.py`              | passed               | 46 manifest entries verified                                                            |
| `git fetch origin --prune` in all three repositories | passed               | execution-time refs refreshed                                                           |
| `pnpm install --frozen-lockfile`                     | passed               | 711 packages; lockfile unchanged                                                        |
| sandboxed `pnpm verify:ci`                           | failed               | environment-only: loopback bind denied with `listen EPERM 127.0.0.1`                    |
| unsandboxed `pnpm verify:ci`                         | passed               | authoritative baseline rerun                                                            |
| `pnpm verify`                                        | blocked before tests | `TEST_DATABASE_URL` and the remaining P13 real-evidence environment were not configured |

The authoritative `verify:ci` result passed formatting, lint, LangGraph path
validation, typecheck, 78 unit tests, 57 contract tests, 9 security tests,
architecture, build, fixture E2E, smoke, migrations, OpenAI, A2A, workflow,
license, and secret gates. PostgreSQL suites reported 50 skipped tests because
`TEST_DATABASE_URL` was absent; this is baseline evidence only and does not
satisfy any v0.3 real/PostgreSQL release gate.

The first exact-head Draft PR run and its failed-job rerun exposed a deterministic
pre-existing test-fixture time bomb: `interaction-persistence.postgres.int.test.ts`
created an allegedly open Interrupt with an absolute expiry of
`2026-08-12T00:00:00.000Z`. Main CI last passed on 2026-08-11, but any real
PostgreSQL run after that expiry correctly returned no open Interrupt. P00 changes
only the test fixture to the already-established non-expiring test value
`2099-01-01T00:00:00.000Z`; production semantics are unchanged. Evidence is
retained under `reports/v0.3/failed-attempts/P00-expired-interrupt-fixture.md`.

## GitHub baseline

- Main CI workflow run `31453095580` completed successfully at exact main SHA
  `25c923524bcddc5fffd37513766cf28c9f9c2cf4`.
- Nine open PRs existed, all Dependabot PRs `#2` through `#10`.
- No PR or remote branch existed for this v0.3 feature.

## Integrity statement

No fixture result is represented as real-model, real-SDAR, PostgreSQL, or
release evidence. No upstream repository was modified. No user change was
stashed, deleted, reset, or overwritten.
