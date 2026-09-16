# Implementation File Map

Codex must inspect before editing; exact paths may evolve.

Primary:
- `packages/ag-ui-api-contract/src/index.ts`
- `packages/ag-ui-analysis-adapter/src/index.ts`
- `packages/analysis-contract/src/index.ts`
- `packages/analysis-client/src/index.ts`
- `packages/analysis-client/src/frozen-world-analysis.ts`
- `packages/analysis-map/**`
- `packages/analysis-timeline/**`
- `packages/analysis-runtime/**`
- `packages/analysis-control-runtime/**`
- Grounding Job / WSGS consumer runtime packages
- `apps/server/src/api/ag-ui-routes.ts`
- `apps/server/src/api/analysis-routes.ts`
- server bootstrap/composition

Tests:
- existing v0.3/v0.5/v0.6 AG-UI tests
- add focused Grounding Activity, Focus linkage, local map action, choice, requery, reconnect and stale-revision tests.

Do not duplicate contracts if an existing package is the correct ownership location.
