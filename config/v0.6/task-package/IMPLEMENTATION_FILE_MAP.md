# Implementation File Map

Codex must confirm actual paths at S00. The likely modification areas are listed to prevent parallel-stack creation.

## Extend

```text
packages/wsgs-http-adapter/
  explicit 1.0/1.1 selection, headers, response validation, capabilities

packages/wsgs-geospatial-consumer/
  authoritative lock intake and schema verification

packages/world-grounding-contract/
  contract selection/presentation-mode additions where necessary

packages/world-grounding-runtime/
  begin/observe/complete split and compatibility wrapper

packages/analysis-contract/
  truthful source identity, view state additions

packages/analysis-runtime/
  source-agnostic coordinator/reducer/pump contracts

packages/analysis-development-runtime/
  either generalize and rename safely or delegate to generic runtime;
  do not duplicate its persistence/event-pump logic

packages/wsgs-analysis-adapter/
  adapt existing Native/Fixture implementations to AnalysisSourceAdapter

packages/ag-ui-analysis-adapter/
  Grounding Job production handler and truthful coarse events

packages/analysis-map/
packages/analysis-timeline/
packages/analysis-client/
  map/timeline/reconnect projection refinements

packages/persistence/
migrations/
  source identity, pump/recovery and scoped repository changes

apps/server/src/main.ts
apps/server/src/bootstrap.ts
apps/server/src/config.ts
apps/server/src/api/
  production composition, configuration, analysis capabilities

tests/
scripts/
reports/v0.6/wsgs-full-functional-integration/
  focused verification and evidence
```

## Preserve

```text
existing SDAR A2A adapter
task coordinator and interaction runtime
OpenAI-compatible API
AG-UI v0.2
conversation persistence/history
world focus
authority fusion
existing append-only migrations
v0.5 Native analysis verifier
```

## Avoid

Do not introduce a second:

```text
WSGS HTTP client
PostgreSQL pool
Analysis Session table family
AG-UI event contract
map state model
timeline state model
grounding lifecycle repository
```

A new package is justified only when it creates a clear dependency boundary rather than duplicating an existing one.
