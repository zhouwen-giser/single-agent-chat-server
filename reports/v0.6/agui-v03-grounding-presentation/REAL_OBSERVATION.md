# Real WSGS observation — positive context still required

Source: `e6b76bbb942d54fe8ad6a6dbc37485903ec67475`.
Command: `SACS_AGUI_REAL_ENV=/tmp/sacs-agui-real-h7o4oQ/case.env node scripts/agui-grounding-real.mjs`; exit 2 (required positive evidence incomplete, not an assertion failure).
Receipt: `real/fb09aedd-9b2a-4b7e-aea4-c677174122c6/EVIDENCE.json`.

This used the real anonymous development WSGS at `http://17.26.1.20:18082`, an isolated local SACS and dedicated temporary PostgreSQL 17.10. No upstream database, provider, shared SDAR or deployment was accessed/modified. All 115 frozen artifacts verified; both request and HTTP waiting budgets were 120 seconds. Preflight returned exact 1.2/profile, readiness=true and all six advanced capabilities AVAILABLE.

Exactly one read-only Grounding was submitted, asking WSGS through normal SACS AG-UI to resolve the most recent task's historical trajectory and return choices if ambiguous. Submission returned HTTP 202. Normal source polling reached **UNRESOLVED**, with **0 Findings, 1 gap, 0 Choices**. Both initial and reconnect AG-UI requests returned HTTP 200. The published business status remains UNRESOLVED; Activity rendering follows its documented UI mapping without replacing the original sourceStatus.

Runtime assertions passed for source result identity/hash, exact Findings/gaps, map/timeline projection, reference-client State hydration, final text/summary, revision-scoped Activity and source-observed lifecycle; no synthetic tool events or execution authorization occurred. These prove truthful handling of this unresolved request. They do **not** establish a useful historical trajectory or successful real candidate selection.

The local composition, HTTP listener and DB pools were closed and reopened against the same dedicated database. Authoritative projection hash stayed `sha256:5269ae2e97c26b2fd6e7253d3af6c0e75a22ccc0f3f5ed4851b54d757cbdd97a`; the Revision and Grounding identity hashes remained equal. Reconnect made **zero additional upstream requests** and did not rerun analysis. This is terminal persistence/reopen evidence, not an OS crash or nonterminal cancellation experiment.

R01 retains BLOCKED_EXTERNAL for a positive normal Finding; its lifecycle/presentation subchecks passed. R02 retains BLOCKED_EXTERNAL because this authorized context returned no public unexpired Choice. This is a context-specific limitation, **not** proof that WSGS globally lacks data or choice support and not evidence of a SACS feature defect. Availability advertising alone does not supply a concrete resolvable task or ambiguity.

No automatic business retry was made. No alternate task identifier, geometry or time window was invented. A current authorized private case file (or public resolvable context obtained normally) is needed before a meaningfully different positive/selection test. The previously referenced temporary private file no longer exists. A non-blocking request for an updated file path was sent to the user.

Cleanup PASS: only this invocation's local processes, DB connections and named temporary PostgreSQL container were removed. The one real upstream job reached its normal terminal lifecycle. No shared task cancellation or upstream data deletion was performed. Raw source data, trajectories, identifiers and credentials were not written into this report; bounded hashes and statuses are in the receipt.
