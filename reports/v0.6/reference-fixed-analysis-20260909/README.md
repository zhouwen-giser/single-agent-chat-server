# History query after unique task-reference acceptance

Reviewed WSGS `reports/task-reference-fix-2026-09-09/README.md` and
`reference-acceptance.json`: two exact mentions each had one candidate and
VALID validation, mapping to one full ReferenceKey. The response-time unique
reference gate is supported; it is not overall business PASS. Expired leases
were not reused.

Submitted one new normal SACS AG-UI historical query using the previously
selected task and observed time window, requesting fresh reference resolution,
actual history and retention of PROVISIONAL/gap semantics. Private input:
`/tmp/sacs-v06-history-after-reference.env` (0600). No trusted reference was
injected, no Provider was called directly, no device action was requested.

The real receipt is `history/INTEGRATION_EVIDENCE.json`. Terminal state PARTIAL,
one reference product, zero unresolved mentions, zero findings and choices,
and no world-analysis gapKinds. Its full-reference hash equals the separately
accepted task reference hash; this alone is not new lease-validation evidence.
No model-budget error was observed. AG-UI HTTP200/RUN_FINISHED and schema-valid
PARTIAL durable projection were observed; no semantic map/timeline PASS is
claimed. Temporary database cleanup PASS; runner exit 2 / INCOMPLETE.

Grounding ID hash:
`sha256:db91c4f43f2fc06676bf03fc924c0e07355617674987bc3c79cc9edc37183c5f`.
Result hash:
`sha256:e7d293a9edb3fd7aa737bfb98c769d941aaa28d0dd65e62be07e7f5070e98677`.

The earlier reference-only request's REQUIREMENT_PLAN/CAPABILITY_GAP must not
be assumed to be this request's exact cause without correlating its own stage
evidence. Requested upstream read-only correlation before further advanced
queries. Ranking, road and temporal cases remain NOT_RUN, not FAIL. No shared
deployment changes, full CI result or overall v0.6 completion is claimed.
