# SACS v0.2 requirement traceability

Phase 13 evidence is bound to candidate
`40e7ae4e2346bb932ccd7e6b89aea3793cc08c42`. `Passed real` means live HTTP/SSE
through the installed Open WebUI or official AG-UI client, the isolated official
A2A adapter, a real PostgreSQL database, and the locked SDAR checkout. It is not
a fixture-only label.

| Acceptance | Required scenario                              | P13 evidence                             | Status                   |
| ---------- | ---------------------------------------------- | ---------------------------------------- | ------------------------ |
| AC-01      | Phase 13 merged-main gate prevents early start | P00 merge proof and retained history     | Passed                   |
| AC-02      | OpenWebUI new SDAR Task                        | real Open WebUI matrix                   | Passed real              |
| AC-03      | OpenWebUI status/result/history                | real status, history, text+JSON result   | Passed real              |
| AC-04      | AG-UI Run lifecycle                            | official client typed SSE                | Passed real              |
| AC-05      | A2A status to AG-UI state                      | Task-scoped interaction mapping          | Passed real              |
| AC-06      | Artifact text/JSON mapping                     | same-Task artifact projection            | Passed real              |
| AC-07      | plan confirmation Interrupt/Resume             | official client real interrupt           | Passed real              |
| AC-08      | `provide_input` Interrupt/Resume               | phase-specific Open WebUI branch         | Passed real              |
| AC-09      | paused Interrupt/Resume                        | explicit pause/resume branch             | Passed real              |
| AC-10      | disconnect does not cancel Task                | abort/reconnect plus `getTask()`         | Passed real              |
| AC-11      | duplicate Run does not duplicate Task          | durable PostgreSQL idempotency           | Passed native PostgreSQL |
| AC-12      | unbound taskId denied                          | query/security tests                     | Passed                   |
| AC-13      | current Agent Card capabilities                | locked live card and safe projection     | Passed real              |
| AC-14      | Capability Gap safe projection                 | real gap branch                          | Passed real              |
| AC-15      | no internal MCP as Tool Call                   | negative contracts and real event audit  | Passed, zero Tool Calls  |
| AC-16      | OpenAI and AG-UI same semantics                | Task `42d1b564...` consistency gate      | Passed real              |
| AC-17      | PostgreSQL restart restores bindings           | P08 restart integration                  | Passed native PostgreSQL |
| AC-18      | v0.1 upgrade preserves bindings                | append-only migration/upgrade gate       | Passed                   |
| AC-19      | real AG-UI client to SACS to SDAR              | official `@ag-ui/client@0.0.57`          | Passed real              |
| AC-20      | candidate Docker/Compose/SBOM exact HEAD       | image, hardened Compose, CycloneDX 1.7   | Passed exact head        |
| AC-21      | feature contains latest main                   | main `6a159aa8...` is candidate ancestor | Passed                   |
| AC-22      | final candidate ancestor of origin/main        | protected PR post-merge proof            | Pending user merge       |

Detailed P13 evidence is in
[`reports/v0.2/p13-completion.md`](../reports/v0.2/p13-completion.md) and
[`reports/v0.2/p13-acceptance.json`](../reports/v0.2/p13-acceptance.json).
