# Phase 3 official A2A SDAR client adapter report

Generated: 2026-07-18T20:55:45+08:00

## Result

Phase 3 implementation, verification, commit, push, and Draft PR update are
complete.

## Delivered

- exact production pin @a2a-js/sdk 1.0.0-beta.0, Apache-2.0
- isolated packages/sdar-a2a-adapter boundary
- Agent Card discovery at /.well-known/agent-card.json
- exact HTTP+JSON and protocol 1.0 interface validation
- required streaming capability validation
- explicit SDAR_A2A_ENDPOINT_OVERRIDE with copied validated card
- RestTransportFactory-only ClientFactory; no compatibility transport
- official sendMessageStream, sendMessage, getTask, and cancelTask calls
- strict initial Message metadata and Follow-up metadata allowlists
- provide_input text plus at most one JSON Data Part
- discovery and operation AbortSignal timeouts
- stable normalized Task, Message, status, artifact, error, and Capability Gap DTOs
- environment parser and Docker endpoint policy documentation
- SDK types absent from the adapter public declaration surface

## Verification actually run

- pnpm install --frozen-lockfile: passed
- pnpm peers check: passed, no issues
- pnpm verify:phase3: passed
  - format check: passed
  - ESLint: passed
  - langgraph.json paths/exports: passed
  - typecheck: passed
  - unit: 3 suites, 16 tests passed
  - contract: 2 suites, 14 tests passed
  - integration: 1 suite, 1 test passed
  - build: passed
- git diff --check: passed
- exact package audit: @a2a-js/sdk 1.0.0-beta.0
- SDK import isolation scan: passed
- forbidden SDK surface scan: passed
  - no compat/v0_3
  - no JsonRpcTransportFactory or gRPC
  - no resubscribeTask or listTasks
- generated public declaration audit: passed

## Official SDK HTTP+JSON mock evidence

The adapter contract test starts a real local HTTP server and calls it through
the installed official SDK. It does not replace the SDK Client with a fake.

Verified:

- Agent Card binding/version acceptance and rejection
- 0.0.0.0 advertised URL corrected only by explicit override
- A2A-Version 1.0 request header
- /message:stream bounded SSE ending while Task remains WORKING
- strict initial user_id and structured_input metadata
- /message:send Follow-up with exact metadata keys
- provide_input text and one application/json Data Part
- local rejection of extra metadata fields and illegal Data Parts
- /tasks/task-1 getTask polling primitive
- /tasks/task-1:cancel top-level cancellation
- completed result Artifact text and JSON normalization
- Agent Card discovery timeout

## Boundaries and honest E2E state

Phase 3 verifies the official SDK against a real local HTTP+JSON mock as required
by the phase. It does not claim the final real SDAR or Open WebUI vertical-slice
E2E; that remains Phase 11. The adapter is not yet wired to task persistence or
the chat graph, which belong to Phases 4 and 6.

## Publication state

- Phase commit: 34641c6d0a5d67667f6f1dc8b632ecde4119b3bf
- Feature push: succeeded
- Draft PR #1 update: succeeded
- PR remains open and draft
- Merge state at capture: CLEAN
- PR checks at capture: none configured/reported
- Blockers: none
- Next phase: Phase 4, PostgreSQL persistence
