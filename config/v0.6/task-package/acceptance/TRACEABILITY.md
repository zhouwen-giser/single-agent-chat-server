# Acceptance Traceability

## Counts

```text
Total acceptance rows: 135
DEVELOPMENT: 105
REAL_WSGS_INTEGRATION: 18
RELEASE: 12

E2E cases: 30
Phases: 10
```

## Per phase

| Phase | Rows | Track | Completion marker |
|---|---:|---|---|
| S00 | 10 | DEVELOPMENT | `SACS_V06_S00_BASELINE_READY` |
| S01 | 12 | DEVELOPMENT | `SACS_V06_ANALYSIS_SOURCE_READY` |
| S02 | 14 | DEVELOPMENT | `SACS_V06_WSGS_GROUNDING_JOB_ADAPTER_READY` |
| S03 | 13 | DEVELOPMENT | `SACS_V06_OBSERVED_GROUNDING_RUNTIME_READY` |
| S04 | 14 | DEVELOPMENT | `SACS_V06_WORLD_ANALYSIS_VIEW_READY` |
| S05 | 15 | DEVELOPMENT | `SACS_V06_WORLD_ANALYSIS_PRESENTATION_READY` |
| S06 | 14 | DEVELOPMENT | `SACS_V06_WORLD_ANALYSIS_MULTITURN_READY` |
| S07 | 13 | DEVELOPMENT | `SACS_V06_RUNTIME_WIRED` |
| S08 | 18 | REAL_WSGS_INTEGRATION | `SACS_WSGS_GROUNDING_JOB_REAL_INTEGRATION_READY` |
| S09 | 12 | RELEASE | `SACS_V06_FINAL_EVIDENCE_READY` |

## Conditional acceptance

A conditional row is not optional. Its status rule is:

```text
capability present and testable → PASS or FAIL
capability absent in locked WSGS source/contract → BLOCKED_EXTERNAL
not inspected or merely inconvenient → NOT_RUN, never BLOCKED_EXTERNAL
```

`BLOCKED_EXTERNAL` is permitted as a completion-compatible state only for conditional rows in the real-integration track. Development rows must not use external blockers to excuse missing SACS-owned implementation; where the upstream schema is absent, the SACS-owned safe unsupported path must still PASS.

## Evidence mapping

Every ledger PASS must reference at least one source-bound evidence item. A command covering many rows may be referenced by multiple rows, but each row must still explain which assertion from that command supports it.
