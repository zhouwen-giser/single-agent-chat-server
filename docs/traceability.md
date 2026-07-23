# Requirement traceability

This table maps the acceptance matrix to executable evidence. `Passed local`
means the named check ran at or after the Phase 12 functional commit. `Inherited`
means the repository retains evidence from the cited remote phase, but the real
environment was not available for a final-head rerun.

| Acceptance                          | Primary executable evidence                                             | Current evidence                                     |
| ----------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| AC-01 model discovery               | `openai-api.contract.test.ts`; Phase 11 report                          | Passed local contract; inherited real E2E            |
| AC-02 normal chat                   | unit graph tests; OpenAI contract; Phase 11 report                      | Passed local; inherited real E2E                     |
| AC-03 single A2A submission         | `sdar-a2a-adapter.contract.test.ts`; coordinator PostgreSQL integration | Passed local adapter; inherited database/real E2E    |
| AC-04 status and phase SSE          | OpenAI contract; coordinator integration                                | Passed local contract; inherited database/real E2E   |
| AC-05 bounded stream and `getTask`  | coordinator integration and Phase 11 report                             | Inherited; final-head real rerun required            |
| AC-06 status query isolation        | graph/unit and coordinator integration                                  | Passed local unit; inherited database                |
| AC-07 plan actions                  | coordinator integration                                                 | Inherited; Phase 12 action gate reviewed             |
| AC-08 `provide_input` identity      | adapter contract and coordinator integration                            | Passed local adapter; inherited database             |
| AC-09 top-level cancellation        | coordinator integration                                                 | Inherited; Phase 12 mutation lease reviewed          |
| AC-10 result artifacts              | coordinator integration; adversarial Artifact validation                | Passed local security validation; inherited real E2E |
| AC-11 failure versus Capability Gap | coordinator integration; safe-publication security test                 | Passed local security; inherited real E2E            |
| AC-12 retry idempotency             | persistence PostgreSQL integration                                      | Inherited; native PostgreSQL rerun blocked           |
| AC-13 restart recovery              | recovery unit and PostgreSQL integration                                | Passed local unit; inherited real restart            |
| AC-14 disconnect recovery           | adapter/coordinator integration                                         | Passed local adapter; inherited database/real E2E    |
| AC-15 utility isolation             | unit graph and OpenAI contract                                          | Passed local                                         |
| AC-16 cross-user isolation          | OpenAI contract and PostgreSQL integration                              | Passed local contract; inherited database            |
| AC-17 signed identity               | `adversarial.security.test.ts`; OpenAI contract                         | Passed local                                         |
| AC-18 SDAR outage                   | recovery unit and Phase 11 report                                       | Passed local unit; inherited real outage             |
| AC-19 no management/DB/MCP          | `verify:architecture`                                                   | Passed local across 42 production files              |
| AC-20 protocol and SDK pin          | adapter contract; `verify:architecture`                                 | Passed local                                         |
| AC-21 explicit endpoint override    | adapter contract                                                        | Passed local, including same-origin rejection        |
| AC-22 Follow-up allowlist           | adapter contract and coordinator integration                            | Passed local adapter; inherited database             |

Phase 12 details are in
[`reports/goal/12-adversarial-hardening.md`](../reports/goal/12-adversarial-hardening.md).
Final-head real Open WebUI, SDAR, PostgreSQL, and container evidence remains a
required Phase 13 gate.
