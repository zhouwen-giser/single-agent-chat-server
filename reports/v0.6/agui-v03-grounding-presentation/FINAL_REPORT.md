# Grounding presentation closure — working report

Status: **DEVELOPMENT PASS; REAL_WSGS positive/selection acceptance BLOCKED_EXTERNAL**. The complete thread goal remains unachieved.

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

S03 CI correction and S04 full CI are confirmed successful, including quality and container jobs; see `CI_S03_FOLLOWUP.json` and `CI_S04.json` for exact commits and runs.

S05 passed at `43b0785`: validated local query scopes now submit explicitly through normal Source Query/Control into a new Revision/Grounding, with exact public MapSelection geometry/hash, CONTINUE/REPLACE, generation/Revision fences and idempotency conflict checks. G06 is directly verified. The phase gate passed 602 frozen tests, 14 PostgreSQL tests and 10 HTTP/SSE E2E tests. See `S05.md` and the reference-client API guide; schema acceptance of opaque geometry is not a claim of live spatial operation support.

S06 passed at `1c627ee`: stale State/Activity and disconnected observer guards, explicit full-snapshot recovery, duplicate suppression and authoritative cancellation. G08–G10 are directly verified at the development scope described in `S06.md`. Nine gates passed with 623 frozen tests, 14 PostgreSQL tests and 10 older HTTP/SSE E2E tests. S05 full remote CI also passed; see `CI_S05.json`.

S07 development closure at `6ec97bd` adds normal/PARTIAL source-to-view fidelity, historical action safety, gap preservation and a frozen 1.2 real local TCP/PostgreSQL choice + map-query + repository-reopen test. All nine local gates passed (626 frozen, 14 PostgreSQL, 11 HTTP/SSE E2E tests). G01–G12 now have direct development evidence. See `S07_DEVELOPMENT.md` for scope and corrected fixture assertions. S06 full CI is also successful (`CI_S06.json`).

S07 local source full CI passed at `c7ecd4e` (`CI_S07_LOCAL.json`). A separate bounded live-runner and a tested shared observation oracle were added at `26eb1c8`, which also passed all nine local gates and full CI (`CI_S07_RUNNER.json`). Local-runner startup defects and their precise evidence/limits are preserved in `REAL_RUNNER_PREFLIGHT.md`; no production auth rule was relaxed and those unsuccessful startup attempts submitted zero upstream business requests.

At `e6b76bb`, the strengthened local startup/authentication check passed, followed by exactly one real read-only WSGS request. Its result was UNRESOLVED with zero Findings and Choices. The complete normal AG-UI stream, source-observed Activity, source/result/projection identity and terminal persistence reopen passed assertions; reconnect made no upstream request. Local resources were cleaned up. R01 positive Finding and R02 real selection remain context-specifically BLOCKED_EXTERNAL; this is not a claim that all upstream data/selection is unavailable or a proven SACS feature defect. See `REAL_OBSERVATION.md` and the immutable receipt.

Final current-source verification at `e6b76bb` passed 48 suites / 629 frozen tests, 14 PostgreSQL tests, 11 HTTP/SSE E2E tests and all nine local gates. Full quality/container CI passed in run 35118182072 (`CI_S07_FINAL_SOURCE.json`). `REQUIREMENT_AUDIT.md` maps every mandatory decision to direct assertions; package/frozen-byte integrity also reverified. The DEVELOPMENT marker is now justified:

`SACS_AGUI_V03_GROUNDING_PRESENTATION_DEV_READY`

Remaining: a current resolvable positive/ambiguity context for R01/R02. The prior temporary private context file `/tmp/sacs-v06-history-after-reference.env` is no longer present; historical reports and reference-acceptance metadata retain hashes rather than reusable concrete private inputs. A replacement file path was requested, and no business query was automatically retried. The REAL_WSGS completion marker is withheld. Deployment and device execution remain outside this goal.
