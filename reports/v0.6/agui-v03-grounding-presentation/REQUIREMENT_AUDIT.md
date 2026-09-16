# Required-decision audit — development PASS, real acceptance incomplete

Scope: the immutable `CODEX_GOAL_PROMPT.md` decisions 1–15, the three package
interaction contracts and acceptance G01–G12/R01–R02. Evidence must be read with
its recorded source SHA; a fixture result is never a live WSGS result.

| Decision                                                                  | Implementation / direct assertion                                                                                                                                               | Current evidence                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1, 3, 4, 15: official events; no fabricated tool/DAG/phase; SACS boundary | `grounding-activity.ts`, normal v0.3 handler; G01/G02/G12 event stream, forbidden SDAR port, existing DAG compatibility assertion                                               | S01/S07 receipts; architecture gate; frozen upstream files unchanged                    |
| 2: dedicated Activity schema and all public UI states                     | `groundingJobActivityV1Schema`, `createGroundingJobActivity`; exhaustive `analysisSourceStatuses` table, cancel uncertainty, strict field rejection                             | `v06-frozen-grounding-activity.contract.test.ts`, S01/S07 receipts                      |
| 5: stable Finding/Map/Timeline/Evidence/Choice identity                   | `frozen-focus-links.ts`; changed labels and equal coordinates do not change linkage; typed collision, period reorder and clipping tests                                         | `v06-frozen-focus-links.unit.test.ts`, S02/S07 receipts                                 |
| 6: local navigation, focus and layer visibility                           | All local actions assert zero network and unchanged shared Revision/hash; rendered pins/visibility survive snapshots                                                            | `v06-frozen-local-map.unit.test.ts`, v0.5 E2E regression, S03/S07 receipts              |
| 7: geometry is a local draft until explicit commit                        | Draw/replace/clear generation and Revision fences; valid and malformed geometry; normal Control -> exact MapSelection/hash -> new source                                        | G06 normal entry tests and frozen 1.2 PostgreSQL/TCP E2E, S05/S07 receipts              |
| 8: exact selector with explicit confirmation                              | Local inspection has no request; boolean confirmation, five-field identity, active Revision/intervention, TTL and complete persisted source are revalidated                     | G04/G05, AC-024/025/026/036 normal entries; S04/S07 receipts                            |
| 9: query edits create a new Revision/Grounding, not Native compile        | Existing Grounding Source Control; CONTINUE/REPLACE and query-scope hash; durable idempotent replay                                                                             | G06 and frozen PostgreSQL/TCP sequence, S05/S07 receipts                                |
| 10: guarded snapshots/deltas                                              | Counter/hash and semantic Revision/source/attempt fences; invalid post-patch Activity schema/status; valid skipped full snapshot counters                                       | `v06-frozen-recovery.unit.test.ts`, S06/S07 receipts                                    |
| 11: disconnect != cancel; reconnect != rerun                              | G09 captures RUNNING before disconnect and proves source continues; full Snapshot after rebuild; new DB pools/repositories restore exact projection without calls               | S06 normal entry + S07 frozen PostgreSQL/TCP E2E; not an OS crash experiment            |
| 12: preserve incompleteness/uncertainty distinctions                      | Manifest-driven official public result normalization compares exact Findings/gaps; sourceStatus remains distinct from UI status; PARTIAL positive Finding survives normal entry | `v06-frozen-view.unit.test.ts`, Activity contract, G02 and recovery tests; S07 receipt  |
| 13: no bridge across trajectory gaps                                      | G03 exact gap period -> DATA_GAP and no synthesized line; sparse published road previews remain MultiPoint                                                                      | G03 normal entry, AC-013/014 view tests and reordered-period linkage tests; S07 receipt |
| 14: historical candidates are non-executing                               | Exact current-validation, route and confirmation requirements with executionAuthorized=false; deictic/explicit vehicle language intercepted before SDAR route                   | G11 + AC-038 normal entries; S07 receipt                                                |

The directly asserted development cases are mapped in `ACCEPTANCE_LEDGER.json`.
S07 local source `6ec97bd` passed nine gates; its report-only descendant `c7ecd4e`
passed full quality/container CI. The later live-harness code requires its own
checks and cannot inherit that CI result unqualified.

Required reporting artifacts exist in this directory: baseline, immutable task
package identity, gap matrix, progressive status, acceptance ledger, development
verification, real evidence and final working report. Historical receipts were
not overwritten. `GAP_MATRIX.md` is explicitly the S00 inventory; later phase
reports and this audit track closures without rewriting the historical baseline.

Final implementation/live-runner source `e6b76bb` passed the nine local gates
(`receipts/S07-b449eae8-f52b-4bbe-8243-e2645ff64c97.json`) and full quality/container
CI (`CI_S07_FINAL_SOURCE.json`). Runtime tests include the added real-route auth
check, while live startup, exact negotiation, normal source lifecycle and
terminal persistent reopen also ran. A final read-only integrity command verified
all 21 package-manifest files and 115 frozen WSGS artifacts; exit 0. The Git diff
from the merged baseline contains no changed frozen WSGS dependency files.

DEVELOPMENT completion is supported, with marker
`SACS_AGUI_V03_GROUNDING_PRESENTATION_DEV_READY`. The real query returned
UNRESOLVED, zero Findings and zero Choices. Its truthful presentation assertions
passed but R01 positive result and R02 selection are context-specifically blocked
as described in `REAL_OBSERVATION.md`; the REAL_WSGS marker is withheld. The full
thread goal remains unachieved pending usable authorized public context.

No merge, tag, release, deployment, upstream repository/database modification or
real device test was performed. The Draft PR remains open on the same v0.6
branch. Earlier failed attempts and their limitations remain in immutable
receipts rather than being reclassified as successful.
