# ADR-0001: One SDAR and the frozen A2A baseline

- Status: accepted
- Date: 2026-07-18

## Context

Open WebUI needs one conversational entrance to one configured SDAR Agent. The
chat service must not become an agent mesh, a second workflow runtime, or a
client of SDAR internal management, database, or MCP surfaces.

## Decision

The service exposes an OpenAI-compatible API, routes a thin LangGraph state
machine, and delegates all SDAR business operations through one isolated
official SDK adapter.

Compatibility is frozen to SDAR commit
`667146a3639eefdfed9b89c2417c08e1ac50e9a9`, A2A specification patch `1.0.1`,
wire version `1.0`, HTTP+JSON, and `@a2a-js/sdk@1.0.0-beta.0`.

Only `sendMessageStream`, `sendMessage`, `getTask`, and `cancelTask` may operate
on tasks. Existing-task messages use the strict SDAR action and metadata
allowlists. `INPUT_REQUIRED` is interpreted with `internalPhase`. A nonterminal
bounded stream end falls back to `getTask()` polling; cursors or arbitrary task
resubscription are not assumed.

Agent Cards are validated. A selected HTTP+JSON interface URL may be replaced
only when `SDAR_A2A_ENDPOINT_OVERRIDE` is explicitly configured, and only on a
copied validated card.

## Consequences

- SDK/domain types cannot cross the adapter boundary.
- PostgreSQL persists local continuity and observations, not SDAR goals, plans,
  skills, workflows, provider tasks, or evidence.
- Current unauthenticated SDAR A2A traffic is restricted to loopback or a
  trusted isolated network.
- Protocol drift fails closed and requires a new ADR, fixtures, and real E2E.
- Multi-agent routing, Mesh, Registry, capability discovery, MCP, and custom UI
  remain outside v0.1.
