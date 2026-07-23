# Troubleshooting

| Symptom                             | Likely cause                                                                    | Check                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `401 invalid_api_key`               | missing or wrong connection key                                                 | compare Open WebUI API key with `CHAT_SERVER_SERVICE_KEY`                 |
| `401 invalid_user_identity`         | JWT forwarding disabled, secret mismatch, expired/forged token                  | Open WebUI JWT settings and clock                                         |
| `400 invalid_request`               | missing chat/message IDs or request limit                                       | required custom headers and message sizes                                 |
| `404 model_not_found`               | wrong model ID                                                                  | use `sdar-single-agent` from `/v1/models`                                 |
| `/ready` is 503                     | PostgreSQL unavailable                                                          | `DATABASE_URL`, network, credentials, migration logs                      |
| `/ready` is 200 but Task chat fails | SDAR unavailable or Agent Card rejected                                         | `SDAR_A2A_BASE_URL`, live card, protocol/binding/modes                    |
| endpoint origin rejection           | card/override points to another origin                                          | use a trusted same-origin base/override; do not relax validation          |
| Follow-up not sent                  | action does not match published status/internal phase or mutation lease is busy | published Task state, `internalPhase`, retry after current interaction    |
| output says truncated               | fragment/event/character safety budget reached                                  | inspect SDAR output size; do not raise limits blindly                     |
| integration tests show skips        | no native `TEST_DATABASE_URL`                                                   | start an isolated PostgreSQL 16 database                                  |
| `pnpm verify` stops immediately     | required real environment is absent                                             | supply all variables listed by `require-final-environment.mjs` and Docker |

`test:e2e:fixture` is intentionally not proof of live Open WebUI or SDAR.
`verify:openwebui` actively checks live Open WebUI model/completion traffic, the
live Agent Card, and a current-head evidence matrix. Do not edit evidence to
convert a blocked scenario into a pass.

For incidents, preserve sanitized correlation IDs and timestamps. Never attach
JWTs, service/database credentials, prompts, raw artifacts, or private logs to
a public issue.
