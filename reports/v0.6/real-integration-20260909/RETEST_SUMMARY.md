# 120-second real integration retest

SACS source: commit `60fc858`; see each receipt's full `sourceSha` and
`entrypointHash`. The rebuilt planners send 120000 ms,
verified at the actual POST boundary. All analyses used real WSGS at the
authorized development endpoint and separate temporary local PostgreSQL/SACS
instances. No upstream state was edited and no device actions were executed.

## Results

- `deadline-120s-retest`: basic request accepted (HTTP 202), polled to PARTIAL,
  public result and durable SACS projection observed; 0 findings and 0 choices.
- `deadline-120s-scenarios`: BASIC returned PARTIAL; HISTORICAL_TRACE,
  ROAD_ASSOCIATION, TEMPORAL_EVENT, CROSS and METRIC_RANKING returned UNRESOLVED.
  Advanced requests reported TASK_CONTEXT_REQUIRED. No model-budget error in
  this six-case run. These are not successful advanced-result assertions.
- `explicit-real-task`: after authorized read-only database discovery, a request
  naming a real task/reference/device still returned FAILED with
  MODEL_BUDGET_EXCEEDED under the 120000 ms policy. Increasing the default fixed
  the unconditional 30-second restriction but does not guarantee model success.

All listed attempts report cleanup PASS. The harness deliberately returns
exit code 2 / INCOMPLETE; OBSERVED denotes a transport/projection observation,
not acceptance PASS. No S08/S09 or overall completion marker is emitted.

## Remaining prerequisites and limitations

Authorized context discovery found four task identifiers and one enabled device,
but zero effective task intervals and zero effective historical trajectories in
the selected database views. See `AUTHORIZED_CONTEXT_DISCOVERY.md`. This is a
point-in-time observation, not proof all upstream data sources are empty.

Further qualification needs a task with usable authorized historical data and
model execution that completes within the public deadline. No additional budget
increase, upstream repair, data initialization or device execution is authorized
by this report. Cancellation, process-restart recovery, detailed business
semantics and full runtime network-boundary qualification remain unqualified.

Evidence bodies contain hashes and allowlisted metadata, not raw request text,
coordinates or credentials. The harness entrypoint remains a diagnostic tool,
not the complete S08 acceptance runner. Early attempts are retained as diagnostic
history; their evidence does not supersede frozen development receipts.

Harness admission regression: 3 tests passed (explicit opt-in, credential URL
rejection, existing-receipt preservation). TypeScript and changed-file lint and
format checks passed. No complete CI rerun is claimed for these uncommitted
diagnostic artifacts.
