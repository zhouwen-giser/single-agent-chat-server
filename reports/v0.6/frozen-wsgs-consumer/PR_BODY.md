## Scope

Continue the existing v0.6 branch with the Frozen WSGS Consumer C00–C06 goal. Only SACS changes; upstream public bytes are immutable. Reuse existing Grounding Job/Analysis/pump/AG-UI composition. Source execution; no Docker, real upstream/model/device, release or deployment gates. Existing historical reports remain historical.

## Progress

- C00: imported 117 exact public files; real SACS loader ran all 44 official examples plus tamper/hash/boundary cases (52 tests). Commit e870717.
- C01: exact 1.2 HTTP decoding/negotiation and budgets; stored contract identity and scoped restore; cancellation intent/uncertainty/terminal-race handling. Local HTTP and memory/SQL-driver boundaries, old 1.0/1.1 regressions. See generated C01.json and logs for final verified outcomes.
- Remaining: five-finding mapping, real source proposal/selection revisions, UI interactions, normal two-turn Chat/AG-UI/Control closure and all-40 acceptance reconciliation. This PR is still Draft, not development-ready or release-ready.

## Evidence and limits

`reports/v0.6/frozen-wsgs-consumer/ACCEPTANCE_LEDGER.json` is generated from actual executed tests, not the upstream verification report alone. Core tests call the real HTTP adapter against a loopback wire fixture. Real PostgreSQL restart is ENV-001 NOT_RUN; no claim of real upstream integration or real model quality. No merge or force-push; final merge remains user-controlled.
