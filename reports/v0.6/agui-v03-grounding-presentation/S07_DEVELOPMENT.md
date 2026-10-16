# S07 — development closure audit (in progress)

Implementation source: `6ec97bd7ffc6a49cb6e61a5a842fbd65cbc9f6ba`.
This is not a final S07 PASS or a REAL_WSGS completion claim.

New normal-entry assertions in `tests/v06-frozen-entry.integration.test.ts`:

- G01/G11/G12: an asynchronous, completed public action fixture traverses HTTP WSGS, durable memory projection, normal AG-UI SSE, headless client and final text. Source Findings/hash, State, map, timeline, evidence, revision-scoped Grounding Activity and finished Step/Run agree. Historical action targets retain all safety requirements and `executionAuthorized=false`; no SDAR method or synthetic tool event is emitted.
- G02/G12: the official `event-incomplete` fixture contains a valid Finding and an `ANALYSIS_INCOMPLETE` gap. Both survive the same full path with PARTIAL status and final summary. It is not an empty result used as a positive Finding substitute.
- G03: a test-only public historical trace is supplied with a SOURCE_GAP, resealed and passed through the unchanged frozen validator. Exact time precision/bounds survive as DATA_GAP. Since this public trace contains periods but no line geometry, the map remains empty and no bridge is invented. Existing road-preview unit tests separately assert exact published points are kept as MultiPoint rather than connected lines. This synthetic gap is development evidence only.

New `tests/v06-frozen-local.e2e.test.ts` uses real local TCP for both SACS and a frozen WSGS fixture, with real isolated PostgreSQL and all migrations. It covers authenticated AG-UI -> headless local candidate inspection -> explicit Control resolution -> new Revision/Grounding -> reconnect; local point drawing -> explicit Source Query -> another Revision/Grounding -> PARTIAL projection; then closes the SACS composition, HTTP listener and database pools and opens fresh ones against the same dedicated database. Full State/Activity recovery preserves the exact projection and issues no upstream calls. Replaying the saved command after reopening does not create another source. This is component/persistence reopen, not an OS process crash or real WSGS test. The legacy frozen 1.1 HTTP test remains in `test:v06:local-e2e`; the new 1.2 test is additive.

Focused command results before committing the final test source:

- `DOTENV_CONFIG_PATH=/dev/null NODE_ENV=test node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/v06-frozen-entry.integration.test.ts --testNamePattern='G01 G11 G12|G02 G12|G03'`: exit 0, 3 passed (29 unrelated cases deliberately skipped for this focused run).
- `env -u TEST_DATABASE_URL DOTENV_CONFIG_PATH=/dev/null NODE_ENV=test SACS_V05_POSTGRES_IMAGE=postgres:17.10-alpine3.23 node scripts/v05-postgres-test-harness.mjs tests/v06-frozen-local.e2e.test.ts`: exit 0, 1 passed; ephemeral container cleaned by the harness.
- `pnpm format:check && pnpm verify:secrets && pnpm typecheck`: exit 0.

Test development exposed two fixture assertions, not hidden production failures: the rendered map uses `layersById`, not `layers`; PostgreSQL starts Revision numbering at zero whereas the memory helper starts at one. The latter assertion now checks the required increment from the observed prior Revision instead of imposing a hard-coded starting number. Focused reruns above passed; neither production behavior nor frozen contracts were changed to satisfy those assertions.

The fixed-source nine-gate regression passed: `SACS_V05_POSTGRES_IMAGE=postgres:17.10-alpine3.23 node scripts/agui-grounding-baseline.mjs S07`, exit 0; `receipts/S07-459f81d5-5654-49f5-baf8-9d2f40227699.json`. It verified unchanged committed source, 47 suites / 626 frozen tests, 14 PostgreSQL tests, 11 HTTP/SSE E2E tests (3 v0.6 including the new frozen 1.2 case, 8 v0.5), typecheck, 20-migration integrity, architecture, lint (0 errors; 194 warnings) and build. G01–G12 now have direct development assertions; full CI at this new source, the final requirement audit and real R01/R02 evidence remain required. S06 full CI is separately successful, recorded in `CI_S06.json`; it does not certify S07 source.

## Final current-source rerun

At `e6b76bbb942d54fe8ad6a6dbc37485903ec67475`, the same nine-gate command passed again on unchanged source (`receipts/S07-b449eae8-f52b-4bbe-8243-e2645ff64c97.json`, exit 0): 48 suites / 629 frozen tests, 14 PostgreSQL tests, 11 HTTP/SSE E2E tests, typecheck, migration, architecture, lint (0 errors; 194 warnings), build. The additive harness tests verify distinct keys, legal 120-second budgets, normal authentication and expired-token rejection. The live oracle is also exercised against successful/PARTIAL fixtures and rejects wrong source hashes or altered final text.

`CI_S07_LOCAL.json` and `CI_S07_RUNNER.json` record full CI success for the earlier S07 sources; final-source CI is tracked separately. Actual live observation and its positive/selection limitation are recorded in `REAL_OBSERVATION.md`, not inferred from these fixtures.

Machine-generated `real/**/EVIDENCE.json` files are excluded narrowly from formatting, like existing immutable phase receipts. A first format check flagged four raw receipts; none was rewritten. Source and hand-written reports remain under formatting/security checks.
