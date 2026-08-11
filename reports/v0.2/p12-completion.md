# P12 completion

Status: `PASSED`

P12 ran the OpenAI/Open WebUI and official AG-UI northbound paths against the
same fixed SDAR runtime. The SACS implementation commit
`fe2a116e69bc5626046ebe7090ae9cb97dbb8674` was pushed and matched the remote
feature head before the exact-SHA gates. The SDAR checkout was clean at
`a9957c82c17ca01e77528f3817c03d86224aaf88`, package version `1.4.1`, with
`@a2a-js/sdk@1.0.0-beta.0`. Its live Agent Card advertised HTTP+JSON wire 1.0,
streaming, and the explicitly selected `http://127.0.0.1:9999/a2a` endpoint;
the card SHA-256 was
`767ad28a1d0af8e99a19d85ed79cbdf8478d746710a7bfa3671c953b8f696e17`.

Exact-SHA northbound run
`p12-exact-fe2a116-northbound-1786406015578` used the pip-installed Open WebUI
0.10.2 and its official configuration API. It passed model discovery, ordinary
chat, utility isolation, current Agent Card capability rendering, explicit
reject/revise/confirm, phase-specific input, pause/resume, top-level cancel,
capability-gap reporting, retry protection, disconnect recovery, and cross-user
isolation. The same run then used official `@ag-ui/client@0.0.57` HTTP/SSE and
schema validation. AG-UI Task `b2ff860e-15e8-4ae5-be2c-b1c40595ef28`
completed after a real plan-confirmation Interrupt and explicit Resume; Run
idempotency and abort/reconnect passed with no RAW or inferred Tool Call events.
Required skips were zero.

The protocol-consistency gate observed one real SDAR interaction through both
renderers. Task `0d6db617-074d-4005-9c47-bcb9f9cd9607`, context
`2e027e36-d488-4381-9cb6-f88115276b2b`, reached `COMPLETED` with 13 published
history messages and one artifact. OpenAI and AG-UI projections were derived
from the same Task-scoped interaction events and the normalized adapter
`getTask()` result; neither renderer became a second authority.

The exact-SHA short-budget run proved the bounded-stream rule independently.
Task `e4d72c2e-fa2d-407f-9fb8-52a09f25334f` emitted
`observation_ended` while remaining nonterminal. Recovery used `getTask()`
polling and observed `INPUT_REQUIRED` with
`internalPhase=awaiting_plan_confirmation`; cleanup used top-level
`cancelTask()` and returned `CANCELED`. No event cursor, arbitrary Task stream
resubscription, or implicit cancellation was used.

The real local SDAR test composition serializes background Goal/model cleanup.
Running every destructive real scenario immediately back-to-back can make the
next Task fail before SACS receives a binding. P12 therefore keeps the combined
northbound matrix, same-Task consistency gate, and short-budget observation
gate as three explicit zero-skip commands against the same fixed source and
services. The SDAR process alone was restarted before the final long-stream
gate to isolate prior test cleanup; PostgreSQL, Redis, SACS, and Open WebUI were
not rebuilt or substituted.

`pnpm verify:phase12` passed at the exact implementation SHA: format, lint,
LangGraph paths, typecheck, build, unit 77/77, contract 57/57, adversarial
security 9/9, and architecture across 59 production source files. The secret
scan passed across 394 tracked files. GitHub Actions run 31443645287 passed
quality and container jobs at the same implementation SHA.

All material failed attempts remain under `failed-attempts` and are not counted
as passing evidence. No browser screenshot is claimed because the in-app
browser runtime could not start in the Windows sandbox; the Open WebUI evidence
is real HTTP through the installed 0.10.2 service. No PR, merge, tag, release,
deployment, SDAR upstream change, or external cancellation was performed in
P12.
