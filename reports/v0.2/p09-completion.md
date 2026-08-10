# P09 completion

Status: `PASSED`

P09 establishes one deny-by-default northbound security policy for the
OpenAI-compatible and AG-UI surfaces. OpenAI and AG-UI retain independent
service credentials, signed bounded Principal JWTs remain authoritative, and
rate-limit keys are explicitly namespaced by protocol. A strict CORS allowlist
defaults to empty, validates exact HTTP(S) origins, limits methods and headers,
and never enables credentialed cross-origin requests.

Client-provided AG-UI state, context, forwarded properties, Task IDs, and
plaintext identity headers are not authority. PostgreSQL authorization is
checked before constructing an A2A client. Public artifact URL projection does
not fetch URLs and rejects HTTP, credentials, local names, private/reserved IPs,
and IPv4-mapped IPv6 loopback forms. RAW and Tool projections remain disabled;
published content stays bounded and redacted.

Implementation commit `45faac3cbf1102b0171ced4b4b16ae0dc4a7aec9` was pushed
and matched the remote feature head before this evidence commit. Exact-code
verification passed: unit 76/76, contract 37/37, PostgreSQL/graph integration
50/50, adversarial security 9/9, local fixture E2E 1/1, format, lint,
LangGraph paths, typecheck, build, architecture over 59 production source
files, 6 migrations, built-server smoke, secret scan across 354 tracked files,
and diff checks. Four failed verification attempts are retained.

This phase does not claim real SDAR or real Open WebUI E2E evidence; those
remain P11/P12 work.
