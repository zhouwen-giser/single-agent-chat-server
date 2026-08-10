# Source Intake — SACS

- Source: merged v0.1 repository baseline
- Repository: `zhouwen-giser/single-agent-chat-server`
- Release/branch: `main`
- Exact SHA: `6a159aa87883568c96f7190c211150843a4d8ad4`
- Retrieved at: 2026-08-10
- License: Apache-2.0
- Purpose: predecessor OpenAI/Open WebUI service and frozen A2A adapter

## Files inspected

Package and lock files, migrations, OpenAI routes, task coordinator, A2A adapter,
persistence repository, test inventory, architecture and Phase 13 reports.

## Contract facts

The predecessor exposes `/v1/models` and `/v1/chat/completions`, uses a thin
LangGraph graph, persists task bindings in PostgreSQL, and confines SDAR calls
to its A2A adapter. A2A streams are bounded with `getTask()` recovery.

## Exact version pins

Node 22.14.x contract, pnpm 11.13.1, and `@a2a-js/sdk@1.0.0-beta.0`.

## Compatibility with SACS

This is the product baseline to preserve. The prior accepted source tree and
merged main tree are identical.

## Risks

The historical status file predates the completed squash merge; live GitHub
state is authoritative for merge/publication state.

## Decision

`ACCEPTED`
