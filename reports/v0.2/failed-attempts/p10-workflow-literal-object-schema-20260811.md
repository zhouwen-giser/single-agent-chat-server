# P10 failed attempt: object literal outside Workflow DSL

- Date: 2026-08-11
- Gate: Workflow schema validation
- Result: failed as required

An object was placed directly inside a Workflow literal and was rejected with
`WORKFLOW_SCHEMA_INVALID` at `nodes.1.value.value`. The corrected Workflow uses
the formal `ref` expression to the MCP node's governed `structuredContent`.
