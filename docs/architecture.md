# Architecture

## Product boundary

The service presents one configured SDAR as one OpenAI-compatible model. A
signed Open WebUI user and Chat ID map to an isolated local thread and, at most,
one active SDAR Task. LangGraph performs deterministic chat routing only. SDAR
remains authoritative for goals, plans, skills, workflows, providers, tools,
and evidence.

| Component   | Owns                                                                    | Must not own                       |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------- |
| Open WebUI  | UI, connection configuration, signed user context                       | SDAR protocol or local persistence |
| API server  | OpenAI contracts, auth, limits, SSE, health                             | planning, tools, hidden reasoning  |
| Thin graph  | utility/general/task/follow-up route selection                          | a second workflow runtime          |
| A2A adapter | Agent Card validation and four permitted SDK operations                 | management APIs, database, MCP     |
| PostgreSQL  | user/chat mapping, Task binding, idempotency, observations, checkpoints | SDAR domain state                  |
| SDAR        | all agent planning and execution semantics                              | Open WebUI identity                |

## Request path

1. Verify the connection bearer key.
2. Verify the short-lived HS256 Open WebUI JWT and bind `sub` to the Chat ID.
3. Enforce body, message, rate, timeout, and output limits.
4. Route utility/general requests locally or a Task operation through the
   isolated A2A adapter.
5. Persist authorization, leases, idempotency, and monotonic observations.
6. Render only bounded published status, allowed metadata, and Result Artifact
   content as OpenAI JSON or terminated SSE.

Existing Task mutations are serialized per chat. An A2A event that changes Task
or context identity fails closed. A stale observation that persistence rejects
is not rendered.

## Network and trust

Open WebUI reaches only the `/v1` entrance. The chat server and SDAR share a
trusted backend path; SDAR port 9999 is not public. PostgreSQL is private to the
server. Agent Card discovery and operations must share the configured SDAR
origin unless an operator explicitly supplies a same-origin endpoint override.

Detailed decisions and component designs:

- [ADR-0001](adr/0001-single-sdar-and-a2a-baseline.md)
- [Thin chat graph](architecture/thin-chat-graph.md)
- [PostgreSQL persistence](architecture/postgresql-persistence.md)
