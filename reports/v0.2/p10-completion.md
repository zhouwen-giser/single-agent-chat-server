# P10 completion

Status: `PASSED`

P10 preserves the OpenAI-compatible `/v1/models` and
`/v1/chat/completions` surface while adding executable predecessor regression
coverage for query, status, result, history, Follow-up, cancellation, utility,
and streaming behavior. The 20-scenario predecessor suite enters through the
actual OpenAI HTTP routes and proves that read-only queries do not mutate SDAR,
while each permitted mutation is routed exactly once.

The exact implementation candidate
`397fff8f43f0ecd41187e3bdc4289218efe18f32` was pushed and matched the remote
feature head before evidence capture. A real installed pip Open WebUI 0.10.2
instance discovered `sdar-single-agent`, forwarded its signed user identity and
configured message identifiers, and drove live HTTP/SSE requests through SACS
to the exact clean SDAR checkout
`a9957c82c17ca01e77528f3817c03d86224aaf88`. The advertised interface was
`HTTP+JSON` protocol `1.0` with streaming enabled, and the production dependency
remained `@a2a-js/sdk@1.0.0-beta.0`.

The exact-SHA real run covered ordinary chat, utility isolation, one streamed
Task submission with exactly one `[DONE]`, plan confirm/reject/revise,
`provide_input`, distinct plan-confirmation and paused phases, pause/resume,
top-level `cancelTask`, completion artifacts, safe Capability Gap rendering,
disconnect recovery through later status polling, process-restart recovery,
retry idempotency, and two signed Open WebUI users. A second exact-SHA run
explicitly verified new Task, status, result, and history queries.

PostgreSQL audit for run `p10-head-1786397637491` found zero Task bindings for
ordinary and utility chats, one distinct Task for every mutating chat, one
request-idempotency row and one result Task for the duplicated user message,
one persisted binding after browser disconnect, and zero Task bindings when the
second signed user queried the first user's chat. The normal completion run
`p10-v6-1786397800323` had exactly one `COMPLETED` Task binding.

The full repository gate passed on the final implementation bytes: unit 76/76,
contract 57/57, real PostgreSQL integration 50/50, predecessor regression
20/20, adversarial security 9/9, deterministic local E2E 1/1, format, lint,
LangGraph paths, typecheck, build, 6 migration checks, architecture across 59
production source files, licenses across 89 production entries, secret scan,
and built-server smoke. Required skips were zero.

The real SDAR was composed from its exact locked `startServerRuntime` entry with
a deterministic embedding hook because that commit's ordinary server main does
not compose `skillSelection`. The model and MCP provider were deterministic E2E
fixtures, while Goal, Skill selection, Workflow execution, A2A state, pause,
resume, cancellation, result, and Capability Gap behavior were the real locked
SDAR runtime. No SDAR upstream file was modified, and no production SACS path
used an SDAR management API, SDAR database, or MCP client.

All material failed attempts are retained under `failed-attempts`; none are
relabeled as passing evidence. P11 remains responsible for the AG-UI official
client E2E, and P12 will rerun the combined acceptance matrix.
