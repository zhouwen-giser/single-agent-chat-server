# Scope-aware history retest after GOWM update

## Correction and read-only discovery

The earlier zero-row history counts were not valid absence evidence: the
effective views filter by `gowm_history_v1.current_data_scope_key()`, which
reads `current_setting('gowm.data_scope_key', true)`. The earlier operator
sessions had no scope. This was a SACS-side discovery error, not proof that
GOWM lacked the data. Historical live request receipts are preserved unchanged.

This discovery uses `BEGIN READ ONLY`, `statement_timeout='5s'` and
`SET LOCAL gowm.data_scope_key='default'`, matching the previously discovered
authorized candidate scope. Session-local scope selection changes no stored
configuration and does not broaden the service's authorization. All SQL
commands exited 0. No raw coordinates or business payload were exported.

At this snapshot, scoped counts are 13 task intervals, 4 historical
trajectories, 3,877 effective tracklet versions, 36 task events and 14 task
snapshots. Tracklet versions are PROVISIONAL; their sample totals are across
versions and must not be treated as distinct raw observations. The updated
history-auto container is running with zero restarts; its health snapshot is
ok/SCANNED, 13 candidates, 13 pending, 0 completed in that tick. Queue-level
counts are not interchangeable with that tick's counts.

Three candidate trajectories joined existing task intervals, sorted by
sample_count descending and end time descending. Their recorded sample counts
are 1025, 517 and 163; temporal coverage ratios approximately 0.996725,
0.999982 and 0.860766. All are PROVISIONAL. These are published trajectory
counts, not asserted raw sampling counts. The first candidate is selected.
Precise identifiers and time windows are operator-private; the source remains
the existing simulator-origin feed, not verified physical-device data.

The initial test asks WSGS to uniquely resolve the selected task using its
existing task ID and reference, through normal SACS AG-UI. The reference is
still treated as a candidate until WSGS validates it. No advanced request is
submitted before that gate passes. Task budget remains 120000 ms and no
shared deployment is changed.

## Live result and decision

The `reference-probe/INTEGRATION_EVIDENCE.json` receipt records a real task
terminal state UNRESOLVED, 2 unresolved mentions, 0 reference products,
0 findings and 0 choices. AG-UI returned HTTP 200, RUN_FINISHED, no RUN_ERROR
and a schema-valid UNRESOLVED durable projection. No MODEL_BUDGET_EXCEEDED was
observed. The actual response does not establish why the references failed
to resolve; database existence alone does not prove visibility or resolution
through WSGS's current authorized public path.

Grounding ID hash:
`sha256:f1d5893347c206f2f0c94f0247a3cbca5781fda80765ed96acca7d911139ff6d`.
Result hash:
`sha256:63c65a86d4a9f239e5cd252c6a18ee86fdf235fcfdcdfc3bc31d4df148683d0a`.

Runner exit 2 / INCOMPLETE; cleanup PASS. New evidence does not overwrite the
previous requests. The positive unique-reference gate remains BLOCKED; history,
ranking, road, parking and crossing requests are NOT_RUN under the agreed gate.
There is no valid basis to label this failure as absent database history.
Further diagnosis must compare the selected reference identity and authorized
public resolution context, without injecting trusted references or bypassing
the normal consumer path. No deployment, data repair, device action, full CI
completion, semantic PASS or v0.6 completion is claimed.
