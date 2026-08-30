# SACS Geospatial Explanation Phase Report — S24

## Phase

S24: **BLOCKED**

## Source SHAs

See `reports/v0.4/geospatial/S13-source-lock.json`; source, runtime, and deployment identities remain distinct.

## Upstream profile/lock hashes

The checked-in consumer lock is explicitly provisional and `BLOCKED`. It is not an authoritative WSGS handoff.

## Changes

See the phase-scoped source and test evidence mapped in `acceptance-ledger.json`.

## Tests actually run

| command                                                               | result                                                               | evidence                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| pnpm test                                                             | PASS 60 suites / 456 tests; 15 suites / 109 tests skipped; 565 total | full current worktree regression; prior 411-case baseline preserved             |
| pnpm docker:build                                                     | PASS; single-agent-chat-server:0.4.0 built                           | local container candidate build                                                 |
| pnpm verify:container                                                 | PASS; version=0.4.0, user=node, healthcheck present                  | local container metadata verification                                           |
| pnpm test:v04:s24:preflight                                           | PASS 2 suites / 24 tests                                             | strict readiness/capability preflight plus per-row acceptance evidence contract |
| pnpm preflight:v04:s24                                                | BLOCKED safely; 0 read-only requests; 0 business POSTs               | reports/v0.4/geospatial/S24-real-e2e.json                                       |
| pnpm verify:migrations; pnpm verify:architecture; pnpm verify:secrets | PASS; PASS; PASS                                                     | reports/v0.4/geospatial/S24-closure-gates.json                                  |

Fixture or unit evidence is supplementary wherever the matrix requires REAL_WSGS.

## Acceptance IDs

Summary: 0 PASS, 0 FAIL, 3 NOT_RUN, 35 BLOCKED (38 total).

| ID      | status  | scenario                                            | decision                                                                                                                                                                        |
| ------- | ------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-R001 | BLOCKED | E2E-01: 2号车当前位置的坡度是多少？                 | BLOCKED: E2E-01: 2号车当前位置的坡度是多少？ cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.                 |
| AC-R002 | BLOCKED | E2E-02: A区内坡度15到30度的区域有哪些？             | BLOCKED: E2E-02: A区内坡度15到30度的区域有哪些？ cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.             |
| AC-R003 | BLOCKED | E2E-03: A区内有哪些洪水高风险区域？                 | BLOCKED: E2E-03: A区内有哪些洪水高风险区域？ cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.                 |
| AC-R004 | BLOCKED | E2E-04: 2号车附近500米有哪些排水沟？                | BLOCKED: E2E-04: 2号车附近500米有哪些排水沟？ cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.                |
| AC-R005 | BLOCKED | E2E-05: A区内有哪些高地？                           | BLOCKED: E2E-05: A区内有哪些高地？ cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.                           |
| AC-R006 | BLOCKED | E2E-06: A区内有哪些湿地？                           | BLOCKED: E2E-06: A区内有哪些湿地？ cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.                           |
| AC-R007 | BLOCKED | E2E-07: 2号车当前位置是什么地表覆盖？               | BLOCKED: E2E-07: 2号车当前位置是什么地表覆盖？ cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.               |
| AC-R008 | BLOCKED | E2E-08: 2号车当前位置为什么属于该通行性等级？       | BLOCKED: E2E-08: 2号车当前位置为什么属于该通行性等级？ cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.       |
| AC-R009 | BLOCKED | E2E-09: 使用当前指定的坡度产品查询A区15到30度坡地。 | BLOCKED: E2E-09: 使用当前指定的坡度产品查询A区15到30度坡地。 cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain. |
| AC-R010 | BLOCKED | E2E-10: 把刚才找到的可引用高地显示出来。            | BLOCKED: E2E-10: 把刚才找到的可引用高地显示出来。 cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.            |
| AC-R011 | BLOCKED | NEG-01: A区有哪些雪崩风险区域？                     | BLOCKED: NEG-01: A区有哪些雪崩风险区域？ cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.                     |
| AC-R012 | BLOCKED | NEG-02: 查询范围超出当前数据覆盖。                  | BLOCKED: NEG-02: 查询范围超出当前数据覆盖。 cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.                  |
| AC-R013 | BLOCKED | NEG-03: 滨河路附近有哪些排水沟？                    | BLOCKED: NEG-03: 滨河路附近有哪些排水沟？ cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.                    |
| AC-R014 | BLOCKED | NEG-04: 返回前100项但实际结果更多。                 | BLOCKED: NEG-04: 返回前100项但实际结果更多。 cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.                 |
| AC-R015 | BLOCKED | NEG-05: 上游返回未知Finding Schema。                | BLOCKED: NEG-05: 上游返回未知Finding Schema。 cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.                |
| AC-R016 | BLOCKED | NEG-06: 严格复用已经变化的数据源结果。              | BLOCKED: NEG-06: 严格复用已经变化的数据源结果。 cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.              |
| AC-R017 | BLOCKED | NEG-07: 访问另一数据范围中的地理产品。              | BLOCKED: NEG-07: 访问另一数据范围中的地理产品。 cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.              |
| AC-R018 | BLOCKED | HYBRID-01: 任务计划与当前地理条件是否一致？         | BLOCKED: HYBRID-01: 任务计划与当前地理条件是否一致？ cannot run without the authoritative WSGS geospatial profile and complete live SACS-to-WSGS-to-GOWM-to-GDPS chain.         |
| AC-Z001 | BLOCKED | Real WSGS post count                                | BLOCKED: Real WSGS post count depends on live-chain evidence that is unavailable while the WSGS geospatial consumer lock is BLOCKED.                                            |
| AC-Z002 | BLOCKED | Real Gateway evidence                               | BLOCKED: Real Gateway evidence depends on live-chain evidence that is unavailable while the WSGS geospatial consumer lock is BLOCKED.                                           |
| AC-Z003 | BLOCKED | Real GDPS source                                    | BLOCKED: Real GDPS source depends on live-chain evidence that is unavailable while the WSGS geospatial consumer lock is BLOCKED.                                                |
| AC-Z004 | BLOCKED | Real PostgreSQL                                     | BLOCKED: Real PostgreSQL depends on live-chain evidence that is unavailable while the WSGS geospatial consumer lock is BLOCKED.                                                 |
| AC-Z005 | BLOCKED | OpenAI HTTP path                                    | BLOCKED: OpenAI HTTP path depends on live-chain evidence that is unavailable while the WSGS geospatial consumer lock is BLOCKED.                                                |
| AC-Z006 | BLOCKED | AGUI HTTP/SSE path                                  | BLOCKED: AGUI HTTP/SSE path depends on live-chain evidence that is unavailable while the WSGS geospatial consumer lock is BLOCKED.                                              |
| AC-Z007 | BLOCKED | Configured model routing                            | BLOCKED: Configured model routing depends on live-chain evidence that is unavailable while the WSGS geospatial consumer lock is BLOCKED.                                        |
| AC-Z008 | BLOCKED | No fixture substitution                             | BLOCKED: No fixture substitution depends on live-chain evidence that is unavailable while the WSGS geospatial consumer lock is BLOCKED.                                         |
| AC-Z009 | BLOCKED | Base 411 regression                                 | BLOCKED: Base 411 regression passed its available local/report gate, but required exact-head CI and GIT evidence is absent because publication was not authorized.              |
| AC-Z010 | BLOCKED | Migration gate                                      | BLOCKED: Migration gate passed its available local/report gate, but required exact-head CI and GIT evidence is absent because publication was not authorized.                   |
| AC-Z011 | BLOCKED | Architecture gate                                   | BLOCKED: Architecture gate passed its available local/report gate, but required exact-head CI and GIT evidence is absent because publication was not authorized.                |
| AC-Z012 | BLOCKED | Secret gate                                         | BLOCKED: Secret gate passed its available local/report gate, but required exact-head CI and GIT evidence is absent because publication was not authorized.                      |
| AC-Z013 | BLOCKED | Container build                                     | BLOCKED: Container build passed its available local/report gate, but required exact-head CI and GIT evidence is absent because publication was not authorized.                  |
| AC-Z014 | BLOCKED | Compose health                                      | BLOCKED: Compose health depends on live-chain evidence that is unavailable while the WSGS geospatial consumer lock is BLOCKED.                                                  |
| AC-Z015 | NOT_RUN | Restart                                             | NOT_RUN: Restart was not executed in this local evidence pass.                                                                                                                  |
| AC-Z016 | NOT_RUN | WSGS outage                                         | NOT_RUN: WSGS outage was not executed in this local evidence pass.                                                                                                              |
| AC-Z017 | BLOCKED | Evidence map                                        | BLOCKED: Evidence map passed its available local/report gate, but required exact-head CI and GIT evidence is absent because publication was not authorized.                     |
| AC-Z018 | BLOCKED | No aggregate pass                                   | BLOCKED: No aggregate pass passed its available local/report gate, but required exact-head CI and GIT evidence is absent because publication was not authorized.                |
| AC-Z019 | NOT_RUN | Draft PR                                            | NOT_RUN: Draft PR was not executed in this local evidence pass.                                                                                                                 |
| AC-Z020 | BLOCKED | No protected action                                 | BLOCKED: No protected action passed its available local/report gate, but required exact-head CI and GIT evidence is absent because publication was not authorized.              |

## Regressions

No row is bulk-passed. The full 565-case accounting and the 0.4.0 container candidate pass locally; required exact-head CI/GIT, compose, live-chain, SACS-runtime recovery, and PR evidence retains explicit BLOCKED/NOT_RUN status.

## Commit / Push / Draft PR

Local implementation evidence may reference local commits. This report does not claim a push, PR update, merge, tag, release, or deployment.

## Marker

`SACS_GEOSPATIAL_REAL_E2E_READY`: **WITHHELD**

## Blockers

Authoritative WSGS geospatial consumer handoff/live-chain evidence is unavailable.
