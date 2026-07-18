# Security Policy

## Supported versions

Security fixes are provided for the latest code on `main` and the active
`v0.1` feature branch until the first stable release.

## Reporting a vulnerability

Use GitHub private vulnerability reporting. Do not open a public issue
containing credentials, prompts, artifacts, user identifiers, or exploit
details.

## Open WebUI identity

All `/v1/*` requests require the connection bearer key and a short-lived HS256
Open WebUI user JWT. The server validates issuer, subject, role, issued-at,
expiry, lifetime, and signature. Plain user headers never establish identity.
Task authorization is scoped by signed user ID, Open WebUI Chat ID, and the
locally persisted Task binding. Do not log either shared secret or JWT values.

## SDAR network boundary

The current SDAR A2A endpoint has no authentication. Deploy it and this chat
server only on a trusted isolated network. Never expose SDAR port 9999 directly
to the public internet.
