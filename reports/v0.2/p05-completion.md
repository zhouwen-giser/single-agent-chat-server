# P05 completion

Status: `PASSED`

P05 implements the exact `POST /ag-ui` and `GET /ag-ui/capabilities`
endpoints. Both routes require an independent AG-UI service bearer key and a
verified signed principal JWT; configuration rejects equal AG-UI and OpenAI
service keys. POST requests enforce official `RunAgentInputSchema`, HTTP/SSE
content negotiation, message/identifier bounds, and the no-client-tools
profile before principal/thread resolution.

Official AG-UI types and `EventEncoder` remain isolated in
`packages/ag-ui-interaction-adapter`. The minimal production path emits
official Run/Text/Finish events for general chat or authorized P04 queries.
Handler and event validation failures become bounded `RUN_ERROR` events without
stack or secret disclosure. Browser disconnect aborts only the current
observation and does not synthesize `RUN_FINISHED` or call any A2A cancellation.

AG-UI principals resolve through protocol-neutral PostgreSQL principal and
`client_thread_binding` records with client type `ag_ui`. Capability discovery
is validated by official `AgentCapabilitiesSchema` and explicitly disables
WebSocket, binary HTTP, push, cursor resumption, client tools, Raw, inferred
tools, and multi-agent behavior.

The exact pinned `@ag-ui/client@0.0.57` `HttpAgent` consumed the Fastify SSE
endpoint and reconstructed the assistant message. Final verification passed:
unit 58/58, contract 35/35, PostgreSQL integration 43/43, security 8/8,
format, lint, typecheck, LangGraph paths, build, architecture, migrations,
built-server smoke, and diff checks. Four failed required attempts are retained.
