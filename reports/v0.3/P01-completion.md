# P01 completion

Status: `LOCAL_COMPLETE_PUBLICATION_PENDING`

## Identity

- Phase: P01
- Base SHA: `25c923524bcddc5fffd37513766cf28c9f9c2cf4`
- Start SHA: `9bc5f3718a0492d852d3b38328aa5bd7772faa13`
- Timestamp UTC: `2026-08-21T10:44:12.819Z`

## Scope completed

- Accepted ADR 0003 for the configured real conversation model,
  server-authoritative durable context, one-Chat-to-many-Tasks, deterministic
  selector/Focus, `TASK | MESSAGE` completion, and trusted single-SDAR A2A with
  no internal `AUTH_REQUIRED` workflow.
- Added strict TypeScript/Zod contracts for `ConversationModel`,
  `ConversationContext`, `TurnDecision`, `TaskSelector`, Task Directory, and
  `CompletedRequestResult`.
- Added repository-owned draft 2020-12 JSON Schemas and Ajv contract tests.
- Added the v0.3 architecture and acceptance-traceability drafts.
- Strengthened architecture checks against new fallback/single-Task use,
  production test-fixture imports, multi-SDAR routing types, and direct
  management/MCP/Provider/Resource/Action endpoint paths.
- Reserved network `fetch()` only for the isolated A2A adapter and the dedicated
  conversation-model adapter that P02 will implement.

The architecture checker temporarily enumerates the exact pre-v0.3 fallback and
implicit single-Task source files. It rejects new use immediately; P02 and P05
must eliminate these explicit legacy allowlists rather than expanding them.

## Database migration

No migration is introduced in P01. Existing `0001` through `0006` remain byte
unchanged. The append-only compatibility strategy is frozen by ADR 0003.

## Tests

| Command                                    | Environment              | Result                                                                                       | Required skips |
| ------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------- | -------------: |
| `pnpm verify:v03:contract`                 | local                    | 1 suite / 6 tests passed                                                                     |              0 |
| `pnpm verify:phase1`                       | isolated PostgreSQL 16.9 | format, lint, LangGraph paths, typecheck, 78 unit, 63 contract, 51 integration, build passed |              0 |
| `pnpm verify:architecture`                 | local                    | 63 production source files passed                                                            |              0 |
| `pnpm verify:licenses`                     | loopback-capable rerun   | 89 production entries, allowed SPDX set                                                      |              0 |
| `pnpm verify:secrets`                      | local                    | passed                                                                                       |              0 |
| `pnpm install --frozen-lockfile --offline` | local cache              | passed                                                                                       |              0 |

## Acceptance criteria

- AC-003: locally passed by ADR 0003, contracts, architecture gate, and tests.
- AC-017 contract portion: locally passed; extra fields, illegal action, and
  multi-strategy selector are rejected by both JSON Schema and Zod.

## Security and privacy review

- Model interfaces expose no tool, endpoint, credential, database, A2A, MCP,
  SMPP, Provider, URL-fetch, or shell capability.
- Endpoint fields are absent from all model and selector contracts.
- Task Directory entries require explicit local binding identity.
- Only bounded published text is represented in the completed Message result.
- Ajv is pinned and development-only; production dependencies are unchanged.

## Blockers / follow-up

- P02 removes the production regex/fixed-text fallback and its exact allowlist.
- P05 removes implicit single-Task APIs and their exact allowlist.
- Real model and current SDAR gates remain P13 work and are not claimed here.
