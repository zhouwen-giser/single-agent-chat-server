# P10 failed attempt: direct model probe omitted signed user identity

- Date: 2026-08-11
- Gate: OpenAI model discovery
- Result: failed closed as required

A direct `/v1/models` request supplied only the service bearer and received
`401 invalid_user_identity`. The real Open WebUI proxy supplied its signed user
JWT and discovered `sdar-single-agent`, proving both trust layers were active.
