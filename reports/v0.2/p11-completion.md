# P11 completion

Status: `PASSED`

P11 connects the production AG-UI run source to the existing normalized A2A to
`SdarInteractionEvent` mapper. Accepted coordinator observations now drive
State, Activity, Custom, Text, Task, artifact, allowed-action, observation, and
Interrupt events while the OpenAI-compatible text path remains unchanged. The
production run and authorized recovery paths persist `input.required` before
projection, and the persistence boundary explicitly separates the public
external AG-UI `threadId` from the internal authorized conversation thread.

The implementation commit
`0abc0aa9c04e783832203db5adcd6d4ccfef5aab` was pushed and matched the remote
feature head before exact-SHA verification. The exact pinned official
`@ag-ui/client@0.0.57` `HttpAgent` then performed real HTTP POST/SSE requests
against the built SACS service and the fixed clean SDAR checkout
`a9957c82c17ca01e77528f3817c03d86224aaf88`. Official
`AgentCapabilitiesSchema` and `EventSchemas` from AG-UI 0.0.57 validated the
capability response and every received event.

Exact-SHA run `p11-head-1786400457717` observed `RUN_STARTED`, Text, State
snapshot/delta, Activity snapshot/delta, Custom, and `RUN_FINISHED`. A real SDAR
plan-confirmation boundary produced an official `sdar.plan_confirmation`
Interrupt with the four published allowed actions. A new official client Run
resolved it with explicit `confirm_plan`; later status observation reported the
same Task as `COMPLETED`.

The same driver proved durable run idempotency: identical `(principal, thread,
runId, input)` replayed the same Task, changed input with the same runId returned
`run_id_conflict`, and the SACS PostgreSQL audit found exactly one Task binding.
It also called the official client's `abortRun()` immediately after the
published Task binding, reconnected with the same runId and input, recovered the
same Task through authorized `getTask()`, created no second binding, and did not
cancel the SDAR Task. The persisted Interrupt row was `RESOLVED` for the exact
Task.

No RAW event, inferred Tool Call, event cursor, Task stream resubscription,
multi-agent routing, SDAR management API, SDAR database, or MCP client was added
to SACS. The model and MCP fixture remain test-only composition around the real
locked SDAR runtime; no SDAR upstream file was modified.

`pnpm verify:phase11` passed twice, including once at the exact pushed
implementation SHA: unit 77/77, contract 57/57, PostgreSQL integration 50/50,
OpenAI predecessor 20/20, adversarial security 9/9, local fixture E2E 1/1,
format, lint, LangGraph paths, typecheck, build, 6 migration checks,
architecture across 59 production source files, licenses across 89 production
entries, secret scan, smoke, and the real official-client E2E. Required skips
were zero. GitHub Actions run 31437862565 also passed both quality and container
jobs at the exact implementation SHA.

All material failed attempts remain under `failed-attempts` and are not
relabeled as passing evidence. P12 remains responsible for the combined
OpenAI/Open WebUI and AG-UI acceptance run against one fixed SDAR.
