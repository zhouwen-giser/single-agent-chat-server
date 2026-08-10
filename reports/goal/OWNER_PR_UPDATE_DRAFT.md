## Summary

- Adds an OpenAI-compatible chat entrance for exactly one configured SDAR.
- Keeps LangGraph thin and isolates the pinned
  `@a2a-js/sdk@1.0.0-beta.0` HTTP+JSON adapter.
- Persists Open WebUI identity, chat/task binding, idempotency, bounded
  observations, and restart recovery in PostgreSQL.
- Supports explicit plan/input/pause/resume Follow-up metadata and top-level
  `cancelTask()` without accessing SDAR internals.
- Includes hardened Docker/Compose, CI, licenses, SBOM, operations, and release
  evidence.

## Frozen compatibility

- SDAR commit: `667146a3639eefdfed9b89c2417c08e1ac50e9a9`
- A2A spec patch: `1.0.1`
- wire/binding: `1.0` / `HTTP+JSON`
- SDK: `@a2a-js/sdk@1.0.0-beta.0`

## Final verification

- unit 31/31; contract 26/26; PostgreSQL integration 36/36;
- fixture E2E 1/1; required real Open WebUI-to-SDAR scenarios 26/26;
- security 8/8; OpenAI 19/19; A2A 7/7; architecture 42 files;
- real pip Open WebUI 0.10.2, exact frozen SDAR, Redis, and real MCP transport;
- real outage, restart, idempotency, user/utility isolation, and explicit Docker
  endpoint-override evidence;
- hardened production image, clean Compose startup/cleanup, 84-entry license
  gate, 178-file secret scan, and current CycloneDX SBOM;
- `pnpm verify` passed with strict real-environment preflight.

## Publication boundary

- Phase 13 report: `reports/goal/13-final-acceptance.md`
- PR may leave Draft only after the final documentation commit's exact
  `quality` and `container` checks pass.
- Do not auto-merge. Merge, tag, and GitHub Release remain user-controlled.
