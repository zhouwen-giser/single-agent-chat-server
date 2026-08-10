# P08 completion

Status: `PASSED`

P08 connects ordinary authenticated AG-UI Runs to the thin LangGraph graph and
the existing single-SDAR A2A coordinator through a protocol-neutral repository
adapter. The outer validated `runId` claim protects the Run; a possible Task
submission uses the stable `${runId}:task` A2A message ID and an atomic
principal/thread submission lease. Local Runs replay their bounded public
outcome. Task Runs recover through the persisted authorized Task/context
binding and `getTask()` only.

Migration `0006_durable_agui_runs.sql` adds protocol-neutral submission leases
and recovery indexes append-only. Run sequence updates are monotonic and
Task/context identity cannot change after binding. Browser disconnect aborts
only the current observation. Tests prove one Task identity across duplicate
Runs, crash-before and crash-after submission recovery, disconnect/repository
restart recovery, and zero `cancelTask()` calls.

A real restart of the dedicated PostgreSQL container preserved the exact probe
`p08-restart-run|RUNNING|p08-restart-task|p08-restart-context|4`. Docker
reassigned the dynamic host port; after discovering the new authoritative port,
all four P08 PostgreSQL tests passed again. This is persistence/recovery
evidence, not real SDAR or Open WebUI E2E evidence; those remain P11/P12 work.

Implementation commit `559794783f88a84fd9b8dee97aaa1b43978c62d4` was pushed
and matched the remote feature head before this evidence commit. Final P08
verification passed: unit 70/70, contract 37/37, PostgreSQL/graph integration
49/49, security 8/8, local fixture E2E 1/1, format, lint, LangGraph paths,
typecheck, build, architecture over 58 source files, 6 migrations,
built-server smoke, and diff checks. Seven failed required attempts are
retained.
