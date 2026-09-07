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
- [ ] C01 — exact 1.2 negotiation, stored identity, bounded lifecycle and old-protocol regression.
- [ ] C02 — validated five-finding mapping, same-source text/map/timeline, wire/view budgets.
- [ ] C03 — real source control, all five choices, scope/TTL/idempotency and immutable revisions.
- [ ] C04 — interactive choice/requery and three-requirement non-executing candidates.
- [ ] C05 — shared normal Chat/AG-UI/Control composition through actual local HTTP.
- [ ] C06 — repeatable focused regressions, per-AC evidence, docs, Draft PR delivery.

## Persistence decision to verify

Existing `grounding_execution.analysis_intent_json`, `canonical_request_json` and result JSON can retain negotiated identity, full legal source and choice anchors without changing frozen contracts. Existing Analysis command/mutation/revision tables will be reused; any strictly necessary schema extension must include repository-boundary tests. Memory-port restart tests are not PostgreSQL restart evidence; real DB verification is ENV-001 NOT_RUN unless an authorized existing isolated database is available (no deployment requested).

## Evidence rules

Use a new 40-AC ledger; do not rewrite historical S00–S09 claims. Import verification alone is not SACS functional evidence. Each phase has tested code, report and semantic commit/push. Keep the full C00–C06 objective active until all REQUIRED assertions are proved.
