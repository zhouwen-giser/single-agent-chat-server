# Requirement traceability

All required acceptance items were rerun at Phase 13 source commit
`085e456c9802462c5d0c2a8c2310cadbfa760a96`. `Passed real` means the
Open WebUI-to-SDAR scenario used live HTTP/SSE, the official SDK adapter, real
PostgreSQL, and the exact frozen SDAR; it is not a fixture-only label.

| Acceptance                          | Primary executable evidence                     | Final evidence               |
| ----------------------------------- | ----------------------------------------------- | ---------------------------- |
| AC-01 model discovery               | OpenAI contract; live Open WebUI proxy          | Passed real                  |
| AC-02 normal chat                   | graph/unit; OpenAI contract; chat DB audit      | Passed real; no Task binding |
| AC-03 single A2A submission         | adapter contract; PostgreSQL audit              | Passed real; one Task        |
| AC-04 status and phase SSE          | OpenAI SSE; published-event audit               | Passed real                  |
| AC-05 bounded stream and `getTask`  | coordinator integration; event audit            | Passed real                  |
| AC-06 status query isolation        | graph/unit; live status query                   | Passed real                  |
| AC-07 plan actions                  | live confirm/reject/revise branches             | Passed real                  |
| AC-08 `provide_input` identity      | adapter contract; distinct phase audit          | Passed real                  |
| AC-09 top-level cancellation        | live `cancelTask()` branch                      | Passed real                  |
| AC-10 result artifacts              | completed text+JSON Artifact audit              | Passed real                  |
| AC-11 failure versus Capability Gap | safe publication; live gap branch               | Passed real                  |
| AC-12 retry idempotency             | PostgreSQL idempotency claim audit              | Passed real                  |
| AC-13 restart recovery              | process restart plus persisted binding          | Passed real                  |
| AC-14 disconnect recovery           | bounded stream and `getTask` enrichment         | Passed real                  |
| AC-15 utility isolation             | Open WebUI utility plus DB audit                | Passed real; no Task         |
| AC-16 cross-user isolation          | two signed Open WebUI users                     | Passed real                  |
| AC-17 signed identity               | forged JWT live request; security matrix        | Passed real                  |
| AC-18 SDAR outage                   | stopped frozen runtime; readiness/binding audit | Passed real                  |
| AC-19 no management/DB/MCP          | architecture gate across 42 files               | Passed                       |
| AC-20 protocol and SDK pin          | live Agent Card; adapter contracts              | Passed real                  |
| AC-21 explicit endpoint override    | hardened Docker shim route log                  | Passed real                  |
| AC-22 Follow-up allowlist           | adapter/coordinator plus live branches          | Passed real                  |

Detailed evidence is in
[`reports/goal/13-final-acceptance.md`](../reports/goal/13-final-acceptance.md).
