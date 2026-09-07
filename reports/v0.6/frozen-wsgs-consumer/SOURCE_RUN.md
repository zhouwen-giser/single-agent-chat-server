# Frozen WSGS consumer — source execution

This is a SACS consumer development delivery, not a production deployment or a real upstream/model validation.

## Local acceptance, no services required

Use the pinned Node 22 / pnpm 11 toolchain and installed workspace dependencies. Tests load TypeScript source through the existing Jest transform; no `dist/` or release build is required.

```sh
pnpm typecheck
pnpm test:v06:frozen-wsgs:contracts
pnpm test:v06:frozen-wsgs:unit
pnpm test:v06:frozen-wsgs:http
pnpm test:v06:frozen-wsgs
node scripts/v06-frozen-tests.mjs all --list
node scripts/v06-frozen-phase-verify.mjs C03
node scripts/v06-frozen-phase-verify.mjs C04
node scripts/v06-frozen-phase-verify.mjs C05
node scripts/v06-frozen-phase-verify.mjs C06
```

These explicit phase commands run the frozen public contracts, real loopback HTTP peer, normal Chat/AG-UI/Control routes, affected compatibility regressions and repository driver-boundary tests. The loopback peer uses derived official public fixtures, validates every query, assigns a distinct Grounding identity to each logical query and recomputes official hashes. It does not implement GSAP/Provider algorithms. The controlled clock preserves original example TTL semantics.

The focused groups have direct equivalent commands `node scripts/v06-frozen-tests.mjs contracts|unit|http|all` (choose one mode). `--list` prints the explicit test plan without running it. The runner bypasses local `.env` loading and removes inherited real endpoint/credential configuration. C06 executes this same delivered `all` entry. The phase verifier records command exit codes, output hashes and the source-tree digest, and refuses to advance the ledger if source files change during a run.

Tests require permission to listen on `127.0.0.1`. A sandbox `listen EPERM` is a test-host permission failure, not an application acceptance result; rerun with local loopback permission. No real upstream address or credential is needed for these tests.

## Source service configuration

The normal server entry remains `apps/server/src/main.ts`; both it and the acceptance tests call `createV06GroundingAnalysis` in `apps/server/src/v06-grounding-analysis.ts`.

For a separately authorized, existing service environment, start source with `pnpm dev:server` (watch mode), or `pnpm exec tsx apps/server/src/main.ts`, after configuring the normal service authentication and PostgreSQL settings. No such environment was provisioned or called in this task. Migration 0020 is append-only and extends the existing command machinery; it must be applied by the normal migration runner when that environment is available.

Frozen consumer configuration:

```dotenv
SACS_WSGS_ANALYSIS_ENABLED=true
SACS_WSGS_ANALYSIS_TRANSPORT=GROUNDING_JOB
SACS_WSGS_ANALYSIS_CONTRACT_VERSION=sacs-wsgs-grounding/1.2
SACS_WSGS_ANALYSIS_RESULT_PROFILE=wsgs-world-analysis-findings/1.0
```

Use the repository's actual WSGS URL/auth configuration names from `.env.example`; keep secrets in an authorized environment/config file, not reports or PR text. Both negotiation headers are exact, wire schemaVersion remains `1.0`, and each saved Source retains its own version/profile. Changing defaults does not upgrade stored 1.1 results. Unknown saved combinations fail safely. Supported capabilities and currently available capabilities are separate.

## Controls and semantics

`POST /api/v1/analyses/:analysisId/proposals` accepts a source command with `kind: GROUNDING_SOURCE_QUERY`, stable command/idempotency IDs, expected Revision ID/number, `originalText`, `contextMode: CONTINUE | REPLACE`, and optional `analysisSelections` (maximum eight). Native node-patch commands are a separate supported legacy DTO, never fabricated for a source query.

Saved source Choice interventions use `POST /api/v1/analyses/:analysisId/interventions/:interventionId:resolve`. The response contains expected Revision ID/number, originalText and exact five-field `analysisSelections`. The server loads the authorized complete raw result; the display list, rank, coordinates or hash alone are not authority. Only real ReferenceProduct IDs enter `selectedProductIds`.

“展开卡片 / 聚焦地图” reuse the returned view. Changed task/object/phase/metric/unit/series/target conditions produce a new semantic request and Revision. `REPLACE` drops old derived selectors and anchors. Expired choices remain readable, but require a new query; GET, replay and reconnect never extend upstream TTL.

Historical MOVE_TO_LOCATION candidates are descriptions only: current validation, route planning and execution confirmation remain required; executionAuthorized is false. This path has no World→SDAR execution binding or MCP/device port. Existing ordinary SDAR behavior is regression-tested separately, not globally disabled.

## Explicit limits

- ENV-001: real PostgreSQL migration/restart is NOT_RUN. Memory restoration and scripted-driver assertions are not real DB evidence.
- EX-001–EX-004 remain outside the consumer development gate: no real upstream/model/device calls, container infrastructure, production/release readiness or upstream changes.
- Public bytes under `dependencies/wsgs-world-analysis-v1/public` remain unchanged. The local wrapper validates the complete source before clipping display content.
- The 40-row ledger and phase command logs are the acceptance record. A phase summary or imported upstream verification alone does not establish DEV_READY.
