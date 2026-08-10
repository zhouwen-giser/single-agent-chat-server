# P01 completion

Status: `PASSED`

SACS now pins official `@ag-ui/core`, `@ag-ui/client`, and
`@ag-ui/encoder` at exactly `0.0.57`. The protocol contract directly compiles
and parses official `RunAgentInput`, `AGUIEvent`, `Interrupt`, and `ResumeEntry`
types and uses the official event encoder.

ADR 0002 freezes two northbound protocols over one interaction core, Run not
Task semantics, `POST /ag-ui` HTTP/SSE negotiation, capability discovery,
existing service/principal authentication, RFC 6902 state deltas, and
deny-by-default RAW/reasoning/inferred tool events.

The architecture gate pins all three AG-UI packages, rejects any production
AG-UI package outside core/encoder, forbids `@ag-ui/a2a`, confines official
AG-UI imports to protocol adapters, and preserves the single frozen A2A SDK
adapter.

Verification passed: frozen install, formatting, lint, LangGraph paths,
typecheck, unit 31/31, contract 30/30, PostgreSQL integration 36/36, architecture
43 production files, and build. The first aggregate lockfile-format failure is
retained and not relabeled.
