# ExecPlan — Frozen WSGS Consumer C00–C06

Goal: complete the frozen 1.2 public consumer through the existing normal SACS composition, including structured selections, revisions and non-executing candidates. Only SACS changes. No Docker, live upstream/model/device, release build or deployment gates.

## Verified starting point

- Branch: `codex/sacs-v0.6-wsgs-full-functional-integration` (kept per current AGENTS).
- HEAD: `7838a52c74b0cfb3575f34cb46c13ceb6f7c0ef2`; worktree initially clean.
- Previous goal work made concrete progress (committed lifecycle and tested local integration), but did not complete the old scope. Its missing-live-environment blocker does not apply to this goal.
- Reuse the 1.1 HTTP client, durable Grounding intent, source binding, shared pump, normal factory, AG-UI and geospatial projections. Actual remaining placeholders confirmed in source control.
- Read all entry/spec/review/plan/acceptance/run documents and templates. Task package checksums passed.
- Read-only handoff: `75d14147f72ff27d3e2e1f15194ff6e25ba6e9f5`, freeze provenance `e05e6d4d5ac8de617857edc8e81b935e5efc7daf`; original full handoff offline verification passed (483 files; 20 positive / 24 negative artificial examples).

## Progress

- [x] C00 — byte-identical public import, SACS loader and contract tests, baseline report (52 SACS tests; commands and exit codes in C00.json).
- [x] C01 — exact 1.2 negotiation, stored identity, bounded lifecycle and old-protocol regression (154 tests; 9 additional AC groups evidenced; AC-007/008 full projection remains tracked in C02/C05).
- [x] C02 — validated five-finding mapping, same-source text/map/timeline, wire/view budgets (195-test regression; AC-011–018 evidenced; interactive/entry proofs continue in C04/C05).
- [x] C03 — real source control, all five choices, scope/TTL/idempotency and immutable revisions (358 tests / 23 suites; 31/40 REQUIRED now PASS).
- [x] C04 — interactive choice/requery, explicit LineString preview and three-requirement non-executing candidates (110 tests / 6 suites; 36/40 REQUIRED PASS; initial 20-second test timeouts preserved, bounded 60-second integration rerun passed).
- [x] C05 — shared normal Chat/AG-UI/Control composition through actual local HTTP (116 tests / 9 suites; 39/40 REQUIRED PASS).
- [ ] C06 — repeatable focused regressions, per-AC evidence, docs, Draft PR delivery.

## Persistence decision to verify

Existing `grounding_execution.analysis_intent_json`, `canonical_request_json` and result JSON can retain negotiated identity, full legal source and choice anchors without changing frozen contracts. Existing Analysis command/mutation/revision tables will be reused; any strictly necessary schema extension must include repository-boundary tests. Memory-port restart tests are not PostgreSQL restart evidence; real DB verification is ENV-001 NOT_RUN unless an authorized existing isolated database is available (no deployment requested).

## C03 integration decisions

The planner substep was recorded independently in C03-planner without claiming source-control completion. The subsequent integrated implementation now includes:

- A source-specific proposal DTO and existing fenced `analysis_control_command` extension (migration 0020), not fabricated native Plan nodes. Pre-HTTP canonical intent lives in the existing Grounding row; completed response remains completion-only.
- Atomic parent revision/run CAS, durable command claims, immutable next-source binding, completed replay and actual observation receipts. Old late results can update only their historical run/audit.
- Per-revision shared pump generations and complete source Choice interventions, resolved by the actual Control route.
- Shared normal Chat/AG-UI/Control request planning, stored 1.2 identity, original TTL and offset semantics. Internal database principal and external SDAR user identities remain distinct.
- Normal-entry HTTP coverage of display-only actions, expiry, hidden choices, concurrent clicks, projection-crash recovery and zero A2A execution for historical candidates. No separate fake Analysis application.

Final C03–C05 verification passed with stable source-tree digests. C04 added an explicit public LineString-preview assertion to the point/trace/clipping/non-navigation coverage. C05 separately reconciled the normal-entry acceptance groups. C06 will run the delivered source CLI and the full affected legacy suite, then audit all 40 rows. No readiness flag before those actual executions.

## Evidence rules

Use a new 40-AC ledger; do not rewrite historical S00–S09 claims. Import verification alone is not SACS functional evidence. Each phase has tested code, report and semantic commit/push. Keep the full C00–C06 objective active until all REQUIRED assertions are proved.
