# AGENTS.md — single-agent-chat-server

## Product boundary

This repository owns a single-SDAR conversational entrance service.

It owns:

- an OpenAI-compatible chat API for Open WebUI;
- a small LangGraph chat state machine;
- one isolated SDAR A2A 1.0 HTTP+JSON client adapter;
- user/chat/task binding persistence and request idempotency;
- translation of published A2A Task/status messages and final result artifacts into safe conversational text;
- explicit SDAR Follow-up actions, top-level cancellation, bounded-stream recovery, security and observability.

It does not own:

- Open WebUI source code;
- SDAR Goal, Skill, Plan, Workflow, MCP Task, Provider or Evidence state;
- Agent Mesh, Registry, multi-agent routing or capability discovery;
- MCP Client/Provider or resource execution;
- ClickHouse, evaluation or AG-UI implementation.

## Frozen A2A baseline

```text
spec patch: 1.0.1
wire: 1.0
binding: HTTP+JSON
sdk: @a2a-js/sdk@1.0.0-beta.0
```

Use `sendMessageStream`, `sendMessage`, `getTask`, and `cancelTask`. Do not implement old `tasks/*` names, v0.3-first compatibility, JSON-RPC or gRPC endpoints.

## Architecture rules

1. All SDAR business interaction uses the isolated A2A adapter.
2. No direct SDAR database, management API or MCP access.
3. The LangGraph graph is thin; it cannot become a second SDAR.
4. Open WebUI is an OpenAI-compatible client, not the source of SDAR state.
5. A2A streams are bounded; nonterminal completion falls back to `getTask()` polling.
6. Do not assume an A2A event cursor or arbitrary Task resubscription.
7. Every existing-task Message must carry an allowed `sdar_action` and strict metadata.
8. `INPUT_REQUIRED` must be interpreted with `Task.metadata.internalPhase`.
9. Persist active Task bindings and last observed status in PostgreSQL.
10. Explain only published status messages, approved metadata and final artifacts—never hidden reasoning.
11. Utility/background Open WebUI requests must never create or mutate SDAR Tasks.
12. Current SDAR A2A is unauthenticated and must remain on a trusted isolated network.
13. Dependencies are pinned and licenses recorded. Project license is Apache-2.0.
14. Every phase needs tests, report, commit and push.

## Git rules

- Protected `main`, PR-only changes.
- Feature branch: `feature/single-sdar-chat-entry-v0.1`.
- No rebase or force-push after remote publication.
- Prefer small semantic commits.
- Open a Draft PR after Phase 0 and update it every phase.
- Final merge is user-controlled.
