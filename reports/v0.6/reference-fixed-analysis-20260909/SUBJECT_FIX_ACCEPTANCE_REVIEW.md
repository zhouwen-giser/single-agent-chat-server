# Review: task-only historical Finding subject fix

Reviewed WSGS `reports/historical-subject-fix-2026-09-09/README.md` and
`acceptance/semantic-acceptance.json`. All 16 recorded semantic checks are
true. Accept the bounded upstream gate
`TASK_ONLY_HISTORICAL_TRACE_SUBJECT_REFERENCE=PASS`, not overall v0.6 PASS.
This is evidence review, not an independent replay of the business request.

The single normal SACS AG-UI run occurred
2026-09-09T12:42:18.506Z–12:43:30.350Z. It produced one HISTORICAL_TRACE and four
reference products, with the Finding linked to a freshly validated subject
product. Recorded subject and Finding leases were valid at response time;
later requests must revalidate. Historical subject version is preserved.
No unresolved mentions or blocking public gaps were recorded.

The trajectory retains PROVISIONAL, 9806 samples and one actual gap. Overall
PARTIAL is consistent with this bounded successful Finding assertion; it does
not mean a sealed or gap-free trajectory. Source harness INCOMPLETE/OBSERVED,
exit 2, is preserved rather than overwritten by the independent assertion.
SACS completion, durable snapshot validation and temporary DB cleanup passed
according to the upstream report.

Grounding ID hash:
`sha256:49870c823bb25fbab500cbb5871f862ee760dd569bfe2d662618da62a0f7807c`.
Result hash:
`sha256:e4c127fbba3ed52da40d953a806a6ab4210530ea1c61a8fbf1295c8c75d20fea`.

This later run resolves the specific subject-product blocker documented in
`UPSTREAM_FINAL_HISTORY_REVIEW.md`; that earlier run remains unchanged.
No new business request was submitted by this review. Further ranking, road,
temporal, Choice, recovery and cancellation acceptance is not established.
Free start/end windows are not implemented by this evidence: the historical
path remains LATEST + EXECUTION_ENVELOPE. Further live testing requires
coordination to avoid duplicate submissions. No original ledger rows or
overall completion markers are promoted by this bounded review.
