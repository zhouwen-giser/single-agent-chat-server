# Phase 0 baseline report

Generated: 2026-07-18T19:36:16+08:00

## Result

Phase 0 implementation passed repository verification and is ready for publication.
No production chat or SDAR client behavior exists in this phase.

## Repository

- Repository: `zhouwen-giser/single-agent-chat-server`
- Branch: `feature/single-sdar-chat-entry-v0.1`
- Main baseline: `3e5be7150e959006d4d152ba6d0d32ebc93ab419`
- Phase commit, push, and Draft PR: pending publication step

## Task package integrity

All 12 task-package files were read. The 11 entries in `SHA256SUMS.txt` match
their current files. The checksum manifest intentionally does not list itself.

## Maintained template

- Official CLI: `create-langgraph@1.1.5`
- Template: `new-langgraph-project-js`
- Template repository commit:
  `4e5f3cd20895663f43d77b91074fbab9d7d05476`
- Node: `22.14.0`; pnpm: `11.13.1`
- Unmodified baseline results:
  - Yarn install with declared Yarn 1.22.22: passed
  - unit test: 1 suite / 1 test passed
  - TypeScript build: passed
  - ESLint: passed with upstream deprecation warnings
  - `langgraph.json` path/export check: passed

The upstream CLI's final Git-init prompt failed in the non-interactive terminal
with `uv_tty_init ... EBADF` after extraction. This did not invalidate template
content or test results.

## SDAR A2A evidence

- Exact source commit: `667146a3639eefdfed9b89c2417c08e1ac50e9a9`
- Commit tree: `8c65d182ce8beeecd92b382e6722a8535a1683df`
- SDK: `@a2a-js/sdk@1.0.0-beta.0`
- Spec patch: `1.0.1`; wire: `1.0`; binding: `HTTP+JSON`
- Agent Card URL: `http://127.0.0.1:9999/.well-known/agent-card.json`
- Agent Card HTTP status: 200; response bytes: 506
- Agent Card SHA-256:
  `9c5227962711fb1defbf5bc1f438315d46749fd0164487b3c46b8986b9a9d99c`
- Selected interface: `http://127.0.0.1:9999/a2a`
- Streaming true; push notifications false
- Authentication: empty security schemes/requirements and
  `UserBuilder.noAuthentication` in exact source
- Application `version` is `0.0.0` and is not used for compatibility.

The live card came from an isolated temporary server built from the exact
commit. Temporary SDAR process, Postgres, Redis, network, and volumes were
removed after capture. Source construction proves that binding to `0.0.0.0`
publishes that host, so the explicit endpoint override policy is required.

## Open WebUI evidence

- Installation: pip package `open-webui`
- Version: `0.10.2`
- Process: present
- `GET http://127.0.0.1:8080/health`: 200, `{"status":true}`
- Topology: host process, not Docker. Connection guidance must use the actual
  host route while retaining backend connection, service key, and signed user
  forwarding requirements.

## Environment and cleanup

- Docker Desktop 4.81.0 / Engine 29.6.1 was healthy.
- No pre-existing SDAR Agent was listening on 9999.
- Temporary `sacs-phase0` containers, network, and volumes were deleted.
- Existing containers and the upstream worktree were not modified.

## Repository verification

- `pnpm install --frozen-lockfile`: passed
- `pnpm peers check`: passed, no peer dependency issues
- `pnpm verify:phase0`: passed
  - format check, ESLint, graph path/export check, and typecheck passed
  - unit: 1 suite / 1 test passed
  - integration: 1 suite / 1 test passed
  - TypeScript build passed

The first repository test run revealed that Jest was traversing the ignored
`.tmp` evidence checkout. The configuration now fixes `roots` to this
repository's `tests` directory, and the complete gate passed afterward.

## Remaining publication gates

1. Commit with `docs: establish single SDAR chat server goal baseline`.
2. Push the feature branch and create the required Draft PR.
3. Append exact publication evidence and advance sync state to Phase 1.
