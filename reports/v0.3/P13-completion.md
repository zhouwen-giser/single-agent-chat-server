# P13 completion

Status: `PASSED` for qualification candidate `9cb0db08c8f2e3ba89757f07ffb9ecaf2c5f84cb`.
Observed UTC: `2026-08-26T03:03:29.416Z`.

## Complete gate

Both commands completed successfully with zero required skips:

```sh
pnpm verify:v03:real-sdar
P13_REUSE_EXACT_REAL_SDAR_EVIDENCE=true \
CONVERSATION_MODEL_TIMEOUT_MS=30000 \
CONVERSATION_MODEL_MAX_OUTPUT_TOKENS=2048 pnpm verify:v03
```

The first command performed genuine model-to-SACS-to-SDAR interaction immediately
after the operator's authority refresh. The full command strictly validated that
same clean, published candidate's real-SDAR evidence and ran every other gate.
No evidence from a different commit was accepted. Environment values were loaded
from the ignored local configuration; the two ordinary model tuning overrides
apply only to the verification process, not the user's file or production limits.

## Results and evidence boundaries

- Genuine OpenAI-compatible model `qwen3.7-plus` passed durable two-turn memory,
  strict Turn Decision, explicit Task candidates, ambiguous mutation clarification,
  and SDAR-domain classification. No key or prompt is published.
- Genuine A2A 1.0 HTTP+JSON created two concurrent active Tasks in one Chat. Both
  remained `INPUT_REQUIRED`. Listing, explicit Task B status, Focus/explanation,
  Task A isolation, ambiguous-cancel clarification, bounded recovery and client
  disconnect behavior passed. No plan confirmation or device execution was sent.
- Safe operation mode is `READ_ONLY_CURRENT_SDAR_PLUS_CONTRACT_FIXTURE`.
  Effectful Follow-up/cancellation behavior is covered by official-adapter
  contracts and real PostgreSQL tests, not claimed as live device execution.
- The isolated PostgreSQL 16.9 gate seeded the v0.2 schema (0001–0006), upgraded
  through 0009, restarted SACS and PostgreSQL, and recovered messages, summary,
  two Task bindings, Focus, legacy TASK replay, exact MESSAGE replay and AG-UI Run.
- Architecture and Compose inspection proved the fixed single-client construction
  and absence of direct SMPP/MCP/Provider configuration. This is configuration and
  source-boundary evidence, not a claim of packet capture or upstream DB inspection.
- Unit 103, contract 78, PostgreSQL 89 twice, predecessor 22, security 12,
  AG-UI 35, security/acceptance 147, fixture E2E 1, OpenAI API 24 and A2A 11 passed.
  These overlapping suites are reported separately, not added as distinct tests.
- Build, format, lint, typecheck, migration, workflow, license, secrets, smoke,
  Docker, container metadata and isolated Compose/cleanup passed. Compose uses an
  explicit readiness fixture; real model acceptance comes only from the real gate.
- CycloneDX 1.7 has 3,718 components; SHA-256 `a99e6e9bf5e16513b47e3d5c79800f9a908e748ea41ea158dc04bb9add8d2f02`.

The sanitized acceptance record contains exact evidence hashes and timestamps.
Raw local evidence and the full log remain ignored below `.tmp`. Full-log SHA-256:
`c822beb670242869fb00826f856b26e5f874132d056cb483dc118f9aa4af3861`.

## Source and operator disclosure

Latest remote mains remained SACS `9734ba2`, SDAR `1d5aafd`, SMPP `b6f0f64`.
The previously observed SDAR process commit `68e05ea` and locked remote-main
`1d5aafd` have identical tree `fca281f87b1aeba6e391fdc1013be7acc600891a`.
The user explicitly waived that commit-identity discrepancy. The current public
Card does not attest a running commit, so this report does not claim exact
process-SHA identity. The operator reported refreshed health with Binding
revision 1 and unchanged Catalog/snapshot; SACS verified only published A2A.

## Publication

Qualification candidate Push CI `32811104940` and PR CI `32811108114` passed.
Replacement PR #14 remains Draft until P14's final-head gate and publication CI.
The user previously merged PR #13; Codex did not merge it or any other PR.
No tag, GitHub Release, upstream modification or production deployment occurred.
