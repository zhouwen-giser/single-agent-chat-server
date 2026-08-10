# P00 Failed Attempt — AG-UI full checkout on Windows

- Attempted at: 2026-08-10
- Required source: `ag-ui-protocol/ag-ui` release `release/2026-08-07`
- Exact object reached: `338708ca8b57deda9c82d0329f30944ab4b0dea6`
- Result: `FAILED_REQUIRED_SOURCE_INTAKE_ATTEMPT`
- Failure: the full Windows checkout could not materialize repository paths
  exceeding the platform checkout limit.
- Evidence boundary: this attempt is not claimed as a clean source checkout.
- Recovery: an exact-SHA detached sparse checkout materialized the required
  core, client, encoder, interrupt, and experimental A2A reference files.
- Final source-intake decision: sparse inspected source accepted; experimental
  A2A package remains reference-only.
