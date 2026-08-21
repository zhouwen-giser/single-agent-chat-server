# P12 completion

Status: `PASSED_PUBLISHED`

## Identity

- Phase: P12
- Start SHA: `da560ad8746fcabad56302f501494e43327cde62`
- Timestamp UTC: `2026-08-21T17:27:52.683Z`
- Functional SHA: `928a56e7b9f77bb30dc7bd93a30787d79b65129c`
- Exact-head CI: run `32507942371`; quality job `96852231590` passed;
  container job `96852849256` passed.

## Scope completed

- Preserved user, client-history, model-output, Task-summary, and A2A content
  as bounded untrusted data. Fixed system instructions are separated from the
  JSON `untrustedData` envelope; strict TurnDecision schemas reject endpoint or
  tool-call fields.
- Strengthened secret-like published-content handling for authentication,
  proxy-authentication, cookies, API keys, bearer values, and database URL
  credentials. Expanded logger redaction for keys, connection strings,
  prompts, responses, messages, user text, structured content, and bodies.
- Added low-cardinality model-outcome, durable result-kind, exact replay, and
  cross-protocol message-dedup counters at the real model/persistence
  boundaries. Observer failures cannot alter a completed durable operation.
- Strengthened the architecture gate to reject production SMPP/MCP
  dependencies/imports and require exactly one SDAR client construction site.
  Removed the lazy helper's second default construction path.
- Updated the cumulative P12 gate, operations/security documentation, pinned
  license inventory, secret scan, application image, and CycloneDX 1.7 SBOM.

## Tests

| Command / gate                        | Environment              | Result                                       | Required skips |
| ------------------------------------- | ------------------------ | -------------------------------------------- | -------------: |
| `pnpm verify:phase12`                 | isolated PostgreSQL 16.9 | 100 unit, 78 contract, 89 integration, build |              0 |
| `pnpm verify:v03:security`            | isolated PostgreSQL 16.9 | 11 suites / 146 tests passed                 |              0 |
| OpenAI predecessor regression         | local                    | 1 suite / 22 tests passed                    |              0 |
| dedicated AG-UI cumulative gate       | isolated PostgreSQL 16.9 | 10 suites / 35 tests passed                  |              0 |
| `pnpm test:security`                  | local                    | 1 suite / 12 tests passed                    |              0 |
| `pnpm test:e2e:fixture`               | local fixture            | 1 suite / 1 test passed                      |              0 |
| migration/architecture/license/secret | local                    | passed; 9 files / 75 sources / 89 entries    |              0 |
| image/container/SBOM                  | Docker                   | passed; 3718 CycloneDX components            |              0 |

## Acceptance criteria

- AC-037: endpoint injection, A2A/user prompt injection, unauthorized and
  ambiguous Task targeting, model failure, bounds, concurrency, auth-required,
  idempotency conflict, secret-like Message Result, and disconnect scenarios
  are rejected or safely contained without unauthorized A2A mutation.
- AC-038: logs and telemetry expose only bounded low-cardinality outcome data;
  tests prove prompt, response, identity, Task, URL, credential, and message
  content are not metric attributes or default logs.

## Security review

- Unresolved Critical findings: 0.
- Unresolved Major findings: 0.
- Explicit Task IDs remain locally authorized before any A2A acquisition. A
  missing or unauthorized binding has one non-enumerating response.
- Browser disconnect is observation-only; same-Task mutations serialize and
  different-Task mutations remain independent.
- No production fallback, second SDAR, direct SMPP/MCP, old A2A operation,
  legacy single-Task API, or internal `AUTH_REQUIRED` state passed the gate.

## Follow-up

- P13 must collect exact-head real model and current SDAR evidence. Those
  environment-dependent gates remain pending and cannot be replaced by the
  fixture suite.
