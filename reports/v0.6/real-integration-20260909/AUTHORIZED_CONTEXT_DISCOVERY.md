# Authorized test-context discovery

> Correction: historical/task-view zero counts in this earlier discovery were
> obtained without the required session data scope. They are not evidence of
> absent upstream history. Scope-aware follow-up is documented in
> `../history-fixed-retest-20260909/README.md`; earlier task IDs and actual
> integration receipts are not changed by this correction.

The user explicitly authorized reading real GOWM task/device identifiers for
integration preparation. This is an operator-only, read-only discovery step;
the SACS process has no upstream database connection or credentials.

Host: `sz-gowm`. Database container:
`gowm-analysis-dev-d2bf0ea98e-postgres-1`; database: `gowm`.
Every metadata query used `BEGIN READ ONLY`, `statement_timeout='5s'`, and
`COMMIT`. No writes, migrations, restarts, trajectory coordinates, task bodies,
model data or credentials were read or exported.

Observed on 2026-09-09:

- `public.operational_task`: 4 tasks.
- `gowm_business_v1.device_catalog`: 1 enabled device returned (limit 3).
- `gowm_history_v1.task_execution_interval_effective`: 0 rows.
- `gowm_history_v1.historical_trajectory_effective`: 0 rows.
- Joining the four task IDs to `gowm_operational_reality_v1.task_snapshot`
  returned no associated state or observation timestamps.

One existing task/reference/device identifier was placed in a private local
0600 test configuration and used as text in a normal SACS→WSGS request. No
time window or trajectory was invented. Raw identifiers are not copied into
this report. The query result belongs to the separate `explicit-real-task`
attempt and must not be inferred from database discovery alone.

These observations describe the selected database/views at query time, not a
claim that every upstream data source is empty. They do not authorize creating
task intervals, ingesting observations or modifying shared GOWM state.
