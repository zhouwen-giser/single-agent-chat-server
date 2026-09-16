# Data-selected real-service retest

> Correction from subsequent scope-aware inspection: the zero-row effective
> history/task-view counts below were obtained without `gowm.data_scope_key`.
> Those views filter by session scope, so these counts do NOT prove missing
> data. See `../history-fixed-retest-20260909/README.md`. The original live
> reference-probe result remains valid and unchanged.

## Selection evidence (2026-09-09)

Operator-only GOWM discovery used SSH and PostgreSQL `BEGIN READ ONLY` with
`statement_timeout='5s'`. All discovery commands exited 0. SACS has no GOWM
database connection. No upstream writes or raw coordinates were used.

At selection time, 67,612 measurements joined to both observations and time
solutions; all had subject identifiers and source record/revision metadata.
14,336 joined position measurements. These are point-in-time counts in an
actively changing database, not the earlier planning snapshot.

Candidate selection required projected (not superseded) observations, a
nonempty subject, observation-time estimate, non-null position and source
record/revision. Grouping used data scope, subject type/ID, source and tracker
session; ordering was sample count descending, then latest observation time
descending; limit 3. Exactly one group qualified, with 11,478 position samples
and 11,478 distinct source records. Within that group's fixed observed time
window, 27,995 SPEED measurements had numeric values. Raw identifiers and the
precise window are retained only in mode-0600 operator configuration
`/tmp/sacs-v06-data-selected.env`.

The source label identifies an existing simulator-origin feed. This run tests
real deployed services against existing business-database records; it is not
evidence of physical-device observations or production data fidelity. Declared
subject binding in storage is not proof of unique public reference resolution.

Effective task intervals, historical trajectories and tracklet versions each
still had 0 rows. Source measurements therefore exist, but eligibility for
historical analysis is unproven. No derived-data backfill was performed.

## Probe and acceptance gate

The first request asks only to resolve the selected device subject and return
its unique public reference/object information. It does not embed an invented
public reference or task identifier, request device execution, or request
advanced analysis. Frozen WSGS 1.2 has no separate reference lookup endpoint;
resolution uses the normal SACS AG-UI to WSGS Grounding Job path.

Worker configuration was read-only verified as `kimi-k3`, model timeout
120000 ms. The entrypoint asserts the actual POST task deadline is 120000 ms.
Each attempt uses a fresh isolated PostgreSQL instance and records cleanup.

```sh
SACS_V06_INTEGRATION_ENV=/tmp/sacs-v06-data-selected.env SACS_V06_EVIDENCE_DIR=reports/v0.6/data-selected-retest-20260909/reference-probe node scripts/v06-real-integration.mjs
```

Advanced requests are gated on successful unique public reference resolution
and the required publicly consumable history/road/region context. An unresolved
or ambiguous reference stops this single-candidate run, rather than triggering
repeated requests with equivalent identifiers. HTTP success, RUN_FINISHED and
OBSERVED are not semantic acceptance PASS.

## Result

Probe UTC interval: 2026-09-09T06:14:06.467Z–06:15:10.539Z. POST returned
202/ACCEPTED in 1640 ms with the asserted 120000 ms deadline. Polling reached
PARTIAL with `REFERENCE_AMBIGUOUS`, 0 findings, 0 choices, 1 reference product
and 0 unresolved mentions. A single reference product does not override the
explicit ambiguity gap or prove unique successful resolution. The response
summary alone does not establish which internal resolution stage caused it.

Grounding ID hash:
`sha256:3b16a208601d5125cd540645b7d29b2660e3c72c029586be19da5fed4b2a43f0`.
Result hash:
`sha256:734d330fc98e8bd0aa7b539b700b1e709e7ecc6e846ca90f23c1fb265665eb8f`.

AG-UI HTTP 200, RUN_FINISHED, no RUN_ERROR and schema-valid durable PARTIAL
projection were observed. This is transport/projection evidence, not a positive
semantic or map/timeline consistency assertion. Isolated database migration
and cleanup report PASS. The diagnostic runner exited 2 / INCOMPLETE.

Decision: **BLOCKED — public reference resolution prerequisite**. History,
speed ranking, road, parking and crossing positive cases are **NOT_RUN** because
the prerequisite was not satisfied. Source-data existence is demonstrated;
neither a SACS defect nor a WSGS internal root cause is proven. Effective
history remains a separate missing prerequisite. No equivalent-candidate retry
or data repair was attempted.

Build, 5 harness admission tests, changed-entrypoint syntax and changed-file
format checks exited 0. No full CI or overall v0.6 completion is claimed.
