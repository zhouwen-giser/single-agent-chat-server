# Grounding presentation closure — working report

Status: **IN_PROGRESS**. Neither DEVELOPMENT nor REAL_WSGS completion is claimed.

The baseline is the user-approved local fast-forward merge at `4916a92bebbdb1d83dfe35c070cdedf711e54da2`, on `codex/sacs-v0.6-wsgs-full-functional-integration`. The old deployment branch remains intact. This work does not deploy to the existing shared services.

S00 imports the immutable task package, inventories implementation gaps and reruns existing development checks. An initial PostgreSQL attempt did not reach tests because the floating image was absent and its pull timed out; the isolated rerun uses the already present fixed PostgreSQL 17 image via the harness's supported override.

S00 baseline verification passed: 522 frozen regression tests, 14 PostgreSQL tests, 2 normal HTTP/SSE E2E tests, typecheck, 20-migration integrity, architecture, lint (0 errors; existing warnings) and build. The receipt records each command, exit code, source SHA and output digest. This does not establish any new G01–G12 acceptance case.

See `GAP_MATRIX.md`, `PROGRESSIVE_STATUS.json` and `ACCEPTANCE_LEDGER.json` for scope and unfulfilled requirements. New-case statuses remain NOT_RUN until direct assertions are executed. Existing reports and receipts are not overwritten.

S01 passed at `7a1a7a1`: truthful revision-scoped Grounding Activity is implemented and durable, including pending cancellation and read compatibility. The regression now has 534 frozen tests, plus 14 PostgreSQL and 2 HTTP/SSE tests. See `S01.md` for the frozen schema hash and precise assertion scope. Full scenario acceptance and real WSGS validation remain pending.

Draft PR: https://github.com/zhouwen-giser/single-agent-chat-server/pull/25, targeting the existing v0.5 integration line. GitHub recognized PR #24 as merged by ancestry after the user-authorized fast-forward was normally pushed; no PR merge command, main update or branch deletion was performed.

S02 passed at `f30420f`: stable typed public identity links now connect the frozen view's findings, features, timeline, evidence, products and choices. Period/feature array order is no longer navigation identity; geometry and execution safety remain intact. The phase gate passed 541 frozen tests plus 14 PostgreSQL and 2 HTTP/SSE tests. See `S02.md` for exact scope and the tree-equivalent squash ancestry reconciliation needed to make the Draft PR mergeable.

S03 passed at `82e46be`: all 17 local map/draft actions, authoritative versus rendered scene separation, input validation and zero implicit transport. The phase gate passed 573 frozen tests plus 14 PostgreSQL and 2 HTTP/SSE tests. G07 is directly verified. S02 full remote CI (quality and container) also passed at `76d449c`; see `CI_S02.json`.

S03 full CI exposed an old v0.5 E2E assertion expecting local pins in shared state. It was corrected to verify rendered pins and unchanged authoritative state, with all 8 older E2E tests passing. See `S03_CI_FOLLOWUP.md`; the scoped S03 receipt was not full CI evidence.

S04 passed at `445a111`: explicit local candidate inspection/confirmation now closes through Analysis Control, a new Revision/Grounding, and authoritative Snapshot. G04 and G05 are directly verified. The gate passed 585 frozen tests, 14 PostgreSQL tests and 10 v0.5/v0.6 HTTP/SSE E2E tests. See `S04.md` for precise scope, validation failures encountered and observer-reconnect correction.

Remaining: S05 validated geometry requery, S06 recovery/concurrency hardening, S07 complete local and real-source acceptance. No final completion marker is emitted.
